const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('Halaman Monitor Admin (T4.3)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let port;
    let adminCookie;
    let guruCookie;
    let siswaCookie;

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));

        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        const indexRouter = require('../routes/index');
        const adminRouter = require('../routes/admin');
        const apiRouter = require('../routes/api');

        app.use('/', indexRouter);
        app.use('/admin', adminRouter);
        app.use('/api', apiRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        // Login Admin
        adminCookie = await loginUser('/login-admin', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });

        // Login Guru
        guruCookie = await loginUser('/login-guru', {
            username: 'guru_uji',
            password: seeded.defaultPin
        });

        // Login Siswa
        siswaCookie = await loginUser('/login-siswa', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: seeded.ujianId
        });
    });

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const payload = body ? JSON.stringify(body) : null;
            const headers = {};
            if (payload) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) {
                headers['Cookie'] = cookie;
            }

            const req = http.request(url, { method, headers }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    let cookieHeader = null;
                    if (setCookie && setCookie.length > 0) {
                        cookieHeader = setCookie[0].split(';')[0];
                    }
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data,
                        cookie: cookieHeader
                    });
                });
            });

            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    async function loginUser(loginPath, credentials) {
        const res = await makeRequest(loginPath, 'POST', credentials);
        return res.cookie;
    }

    test('1. Proteksi akses: non-admin dialihkan ke login admin', async () => {
        const resAnon = await makeRequest(`/admin/monitor/${seeded.ujianId}`, 'GET', null, null);
        assert.strictEqual(resAnon.statusCode, 302);
        assert.ok(resAnon.headers.location.includes('/login-admin'));

        const resGuru = await makeRequest(`/admin/monitor/${seeded.ujianId}`, 'GET', null, guruCookie);
        assert.strictEqual(resGuru.statusCode, 302);
        assert.ok(resGuru.headers.location.includes('/login-admin'));
    });

    test('2. Admin berhasil mengakses halaman monitor dan elemen UI ter-render lengkap', async () => {
        const res = await makeRequest(`/admin/monitor/${seeded.ujianId}`, 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);

        const html = res.body;
        // Memuat elemen ringkasan dan tabel
        assert.ok(html.includes('id="count-total"'), 'Harus memuat id count-total');
        assert.ok(html.includes('id="count-online"'), 'Harus memuat id count-online');
        assert.ok(html.includes('id="count-offline"'), 'Harus memuat id count-offline');
        assert.ok(html.includes('id="count-selesai"'), 'Harus memuat id count-selesai');
        assert.ok(html.includes('id="count-terkunci"'), 'Harus memuat id count-terkunci');
        assert.ok(html.includes('id="count-belum_masuk"'), 'Harus memuat id count-belum_masuk');
        assert.ok(html.includes('id="filter-search"'), 'Harus memuat input search');
        assert.ok(html.includes('id="filter-status"'), 'Harus memuat dropdown filter status');
        assert.ok(html.includes('id="table-monitor"'), 'Harus memuat table-monitor');
        assert.ok(html.includes('socket.emit(\'admin:join\''), 'Harus ada script join socket admin');
    });

    test('3. Tahan render 410 baris siswa tanpa error dan performa cepat', async () => {
        // Buat 410 siswa sintetis di kelas X-A
        const siswaValues = [];
        for (let i = 10; i <= 420; i++) {
            const nis = `T${String(i).padStart(4, '0')}`;
            const nama = `Siswa Massal ${i}`;
            siswaValues.push(`('${nis}', '${nama}', 'X-A', 'hash')`);
        }
        await pool.query(`INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ${siswaValues.join(',')}`);

        const start = Date.now();
        const res = await makeRequest(`/admin/monitor/${seeded.ujianId}`, 'GET', null, adminCookie);
        const duration = Date.now() - start;

        assert.strictEqual(res.statusCode, 200);
        assert.ok(duration < 2000, `Render 410 baris harus di bawah 2 detik (aktual: ${duration}ms)`);

        const html = res.body;
        // Total siswa harus 412 (2 awal + 411 massal)
        assert.ok(html.includes('T0010'), 'Harus memuat siswa massal pertama');
        assert.ok(html.includes('T0420'), 'Harus memuat siswa massal terakhir');
    });
    test('4. Skrip halaman valid secara sintaks dan nama beraposaf/markup tidak masuk ke JS', async () => {
        await pool.query("UPDATE siswa SET nama = ? WHERE nis = 'T0001'", ["Ma'ruf <img src=x>"]);
        const res = await makeRequest(`/admin/monitor/${seeded.ujianId}`, 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);

        const scripts = [...res.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
        assert.ok(scripts.length > 0, 'Harus ada skrip inline');
        for (const src of scripts) {
            assert.doesNotThrow(() => new (require('vm').Script)(src), 'Skrip inline harus dapat dikompilasi');
        }

        assert.ok(!/onclick="(tambahWaktu|paksaSelesai|bukaKunci)/.test(res.body), 'Tombol aksi tidak boleh memakai onclick inline');
        assert.ok(!res.body.includes('<img src=x>'), 'Markup pada nama harus di-escape');
        assert.ok(res.body.includes('data-nama-asli="Ma&#39;ruf &lt;img src=x&gt;"'), 'Nama asli tersimpan ter-escape di atribut data');
    });
});

