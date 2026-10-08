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

describe('Token Ujian Opsional (T5.3)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let adminCookie;

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const headers = {};
            let payload = null;

            if (body && typeof body === 'object') {
                payload = JSON.stringify(body);
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            } else if (typeof body === 'string') {
                payload = body;
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
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

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-token',
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
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        adminCookie = await loginUser('/login-admin', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });
        assert.ok(adminCookie);
    });

    test('1. Ujian tanpa token: Siswa login berhasil tanpa mengirimkan token', async () => {
        const nis = 'T0001';
        // Pastikan token_ujian NULL
        await pool.query('UPDATE ujian SET token_ujian = NULL WHERE id = ?', [seeded.ujianId]);

        const loginBody = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}`;
        const res = await makeRequest('/login-siswa', 'POST', loginBody);

        assert.strictEqual(res.statusCode, 302);
        assert.ok(res.headers.location.includes('/ujian'));
    });

    test('2. Ujian dengan token: Login tanpa token atau token salah ditolak (200 render error)', async () => {
        const nis = 'T0001';
        // Pasang token ujian
        await pool.query("UPDATE ujian SET token_ujian = 'RAHASIA' WHERE id = ?", [seeded.ujianId]);

        // a. Tanpa token
        const loginTanpaToken = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}`;
        const res1 = await makeRequest('/login-siswa', 'POST', loginTanpaToken);
        assert.strictEqual(res1.statusCode, 200);
        assert.match(res1.body, /Token ujian wajib diisi/);

        // b. Token salah
        const loginTokenSalah = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&token_ujian=SALAH1`;
        const res2 = await makeRequest('/login-siswa', 'POST', loginTokenSalah);
        assert.strictEqual(res2.statusCode, 200);
        assert.match(res2.body, /Token ujian salah/);
    });

    test('3. Ujian dengan token: Token benar (case-insensitive) berhasil login dan redirect /ujian', async () => {
        const nis = 'T0001';
        await pool.query("UPDATE ujian SET token_ujian = 'RAHASIA' WHERE id = ?", [seeded.ujianId]);

        const loginBody = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&token_ujian=rahasia`;
        const res = await makeRequest('/login-siswa', 'POST', loginBody);

        assert.strictEqual(res.statusCode, 302);
        assert.ok(res.headers.location.includes('/ujian'));
    });

    test('4. Admin dapat memperbarui token ujian dan tersimpan di database', async () => {
        const editBody = `pengajaran_id=${seeded.pengajaranId}&nama_ujian=Ujian+Dengan+Token&durasi=60&tanggal_mulai=2026-10-01T08:00&tanggal_selesai=2026-10-31T17:00&acak_soal=1&acak_pilihan=1&batas_pelanggaran=3&token_ujian=ABCXYZ`;

        const res = await makeRequest(`/admin/ujian/edit/${seeded.ujianId}`, 'POST', editBody, adminCookie);
        assert.strictEqual(res.statusCode, 302);

        const [rows] = await pool.query('SELECT token_ujian FROM ujian WHERE id = ?', [seeded.ujianId]);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].token_ujian, 'ABCXYZ');
    });
});

