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

describe('Buka Kunci Sesi Tanpa Hapus Data (POST /admin/api/sesi/:id/buka-kunci) (T1.9)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let port;
    let adminCookie;
    let siswaCookie;
    let sesiId;

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

        // 1. Login admin
        const loginAdminRes = await makeRequest('/login-admin', 'POST', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });
        adminCookie = loginAdminRes.cookie;

        // 2. Login siswa
        const loginSiswaRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'laptop'
        });
        siswaCookie = loginSiswaRes.cookie;

        // Ambil ID sesi siswa
        const [sesiRows] = await pool.query(
            'SELECT id FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        sesiId = sesiRows[0].id;

        // Simpan jawaban siswa untuk soalId
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar, client_ts)
             VALUES (?, ?, ?, 'B', 1, NOW())`,
            [seeded.siswa1Id, seeded.ujianId, seeded.soalId]
        );

        // Simulasikan siswa terkena pelanggaran sehingga sesi menjadi keluar_paksa
        await pool.query(
            "UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE id = ?",
            [sesiId]
        );
    });

    async function makeRequest(reqPath, method, body, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(reqPath, baseUrl);
            const headers = {};
            let payload = null;

            if (body) {
                payload = JSON.stringify(body);
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) {
                headers['Cookie'] = cookie;
            }

            const req = http.request(url, { method, headers }, res => {
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

    test('1. Buka kunci mengubah status keluar_paksa ke sedang_ujian dan mempertahankan jawaban', async () => {
        // Sebelum buka kunci: siswa coba akses GET /api/sesi -> ditolak 403
        const resSiswaSebelum = await makeRequest('/api/sesi', 'GET', null, siswaCookie);
        assert.strictEqual(resSiswaSebelum.statusCode, 403);

        // Admin melakukan buka kunci via POST /admin/api/sesi/:id/buka-kunci
        const resBukaKunci = await makeRequest(`/admin/api/sesi/${sesiId}/buka-kunci`, 'POST', {}, adminCookie);
        assert.strictEqual(resBukaKunci.statusCode, 200);
        const jsonBuka = JSON.parse(resBukaKunci.body);
        assert.strictEqual(jsonBuka.success, true);
        assert.strictEqual(jsonBuka.status, 'sedang_ujian');

        // Verifikasi status sesi di DB
        const [sesiAfter] = await pool.query('SELECT status FROM sesi_ujian WHERE id = ?', [sesiId]);
        assert.strictEqual(sesiAfter[0].status, 'sedang_ujian');

        // Verifikasi jawaban siswa TIDAK terhapus
        const [jawabanAfter] = await pool.query(
            'SELECT * FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(jawabanAfter.length, 1);
        assert.strictEqual(jawabanAfter[0].jawaban_dipilih, 'B');

        // Verifikasi audit_admin tercatat
        const [auditRows] = await pool.query(
            "SELECT * FROM audit_admin WHERE sesi_id = ? AND aksi = 'buka-kunci'",
            [sesiId]
        );
        assert.strictEqual(auditRows.length, 1);

        // Setelah buka kunci: siswa dapat mengakses kembali GET /api/sesi
        const resSiswaSetelah = await makeRequest('/api/sesi', 'GET', null, siswaCookie);
        assert.strictEqual(resSiswaSetelah.statusCode, 200);
        const jsonSiswa = JSON.parse(resSiswaSetelah.body);
        assert.strictEqual(jsonSiswa.status, 'sedang_ujian');
    });

    test('2. Buka kunci ditolak jika bukan sesi admin', async () => {
        // Request tanpa admin cookie
        const resAnon = await makeRequest(`/admin/api/sesi/${sesiId}/buka-kunci`, 'POST', {}, null);
        assert.strictEqual(resAnon.statusCode, 302, 'Harus redirect ke login admin');
    });

    test('3. Buka kunci mengembalikan 404 jika ID sesi tidak ditemukan', async () => {
        const resNotFound = await makeRequest('/admin/api/sesi/999999/buka-kunci', 'POST', {}, adminCookie);
        assert.strictEqual(resNotFound.statusCode, 404);
    });

    test('4. Buka kunci ditolak (409) jika sesi bukan keluar_paksa', async () => {
        await pool.query("UPDATE sesi_ujian SET status = 'selesai' WHERE id = ?", [sesiId]);
        const res = await makeRequest(`/admin/api/sesi/${sesiId}/buka-kunci`, 'POST', {}, adminCookie);
        assert.strictEqual(res.statusCode, 409);
        const [rows] = await pool.query('SELECT status FROM sesi_ujian WHERE id = ?', [sesiId]);
        assert.strictEqual(rows[0].status, 'selesai');
    });

    test('5. Hitungan pelanggaran: ambil_alih tidak dihitung dan buka kunci mereset hitungan', async () => {
        const { hitungPelanggaran } = require('../services/sesiService');
        const catat = jenis => pool.query(
            'INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan) VALUES (?, ?, ?)',
            [seeded.siswa1Id, seeded.ujianId, jenis]
        );
        for (let i = 0; i < 5; i++) await catat('ambil_alih_sesi');
        await catat('pindah_tab');
        await catat('copy_paste');
        assert.strictEqual(await hitungPelanggaran(seeded.siswa1Id, seeded.ujianId, pool), 2);

        const res = await makeRequest(`/admin/api/sesi/${sesiId}/buka-kunci`, 'POST', {}, adminCookie);
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(await hitungPelanggaran(seeded.siswa1Id, seeded.ujianId, pool), 0);

        await catat('keluar_fullscreen');
        assert.strictEqual(await hitungPelanggaran(seeded.siswa1Id, seeded.ujianId, pool), 1);

        // Log lama tetap tersimpan (audit)
        const [[{ total }]] = await pool.query(
            'SELECT COUNT(*) AS total FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(total, 5 + 2 + 1 + 1);
    });
});
