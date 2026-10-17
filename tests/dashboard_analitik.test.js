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

describe('Dashboard Analitik Admin (grafik tren nilai & rata-rata per kelas)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let adminCookie;

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const payload = body ? new URLSearchParams(body).toString() : null;
            const headers = {};
            if (payload) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) headers['Cookie'] = cookie;

            const req = http.request(url, { method, headers }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    const cookieHeader = setCookie && setCookie.length > 0 ? setCookie[0].split(';')[0] : null;
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data, cookie: cookieHeader });
                });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-dashboard',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        app.use('/', require('../routes/index'));
        app.use('/admin', require('../routes/admin'));

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        const loginRes = await makeRequest('/login-admin', 'POST', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });
        adminCookie = loginRes.cookie;
        assert.ok(adminCookie, 'Admin harus menerima cookie session');
    });

    test('1. Dashboard tanpa data nilai menampilkan pesan kosong, bukan error', async () => {
        const res = await makeRequest('/admin/dashboard', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);
        const jumlahPesanKosong = (res.body.match(/Belum ada data nilai untuk ditampilkan/g) || []).length;
        assert.strictEqual(jumlahPesanKosong, 2, 'Kedua grafik (tren & per kelas) harus tampilkan pesan kosong');
    });

    test('2. Dashboard dengan data nilai menghitung rata-rata per kelas dengan benar', async () => {
        await pool.query(
            `INSERT INTO nilai_ujian (siswa_id, ujian_id, poin_otomatis, poin_essay, poin_maks, nilai, status_koreksi, benar, salah, kosong, selesai_pada)
             VALUES (?, ?, 6, 0, 6, 100, 'selesai', 3, 0, 0, NOW())`,
            [seeded.siswa1Id, seeded.ujianId]
        );
        await pool.query(
            `INSERT INTO nilai_ujian (siswa_id, ujian_id, poin_otomatis, poin_essay, poin_maks, nilai, status_koreksi, benar, salah, kosong, selesai_pada)
             VALUES (?, ?, 4, 0, 6, 67, 'selesai', 2, 1, 0, NOW())`,
            [seeded.siswa2Id, seeded.ujianId]
        );

        const res = await makeRequest('/admin/dashboard', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);

        const trenMatch = res.body.match(/const trenNilai = (\[.*?\]);/);
        assert.ok(trenMatch, 'Variabel trenNilai harus ada di halaman');
        const trenNilai = JSON.parse(trenMatch[1].replace(/\\u003c/g, '<'));
        assert.strictEqual(trenNilai.length, 1);
        assert.strictEqual(Math.round(Number(trenNilai[0].rata_rata) * 10) / 10, 83.5);

        const kelasMatch = res.body.match(/const rataPerKelas = (\[.*?\]);/);
        assert.ok(kelasMatch, 'Variabel rataPerKelas harus ada di halaman');
        const rataPerKelas = JSON.parse(kelasMatch[1].replace(/\\u003c/g, '<'));
        // seedSyntheticData: siswa1 di kelas X-A, siswa2 di kelas X-B
        const kelasXA = rataPerKelas.find(k => k.kelas === 'X-A');
        const kelasXB = rataPerKelas.find(k => k.kelas === 'X-B');
        assert.strictEqual(Number(kelasXA.rata_rata), 100);
        assert.strictEqual(Number(kelasXB.rata_rata), 67);
    });

    test('3. Nama ujian yang mengandung "</script>" tidak memutus halaman (escaped)', async () => {
        await pool.query(
            "UPDATE ujian SET nama_ujian = 'Ujian</script><script>alert(1)</script>Jahat' WHERE id = ?",
            [seeded.ujianId]
        );
        await pool.query(
            `INSERT INTO nilai_ujian (siswa_id, ujian_id, poin_otomatis, poin_essay, poin_maks, nilai, status_koreksi, benar, salah, kosong, selesai_pada)
             VALUES (?, ?, 6, 0, 6, 100, 'selesai', 3, 0, 0, NOW())`,
            [seeded.siswa1Id, seeded.ujianId]
        );

        const res = await makeRequest('/admin/dashboard', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);

        const trenMatch = res.body.match(/const trenNilai = (\[.*?\]);/);
        assert.ok(trenMatch);
        assert.ok(!trenMatch[1].includes('</script>'), 'Literal </script> tidak boleh muncul di dalam blok script');
        assert.ok(trenMatch[1].includes('\\u003c/script>'), 'Karakter < harus sudah di-escape menjadi \\u003c');
    });

    test('4. Akses tanpa login admin ditolak', async () => {
        const res = await makeRequest('/admin/dashboard', 'GET', null, null);
        assert.notStrictEqual(res.statusCode, 200);
    });
});
