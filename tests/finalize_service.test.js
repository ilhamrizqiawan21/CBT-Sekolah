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
const {
    finalizeSesi,
    tutupSesiKadaluarsa
} = require('../services/finalizeService');

describe('Job Penutupan Otomatis & Finalisasi Sesi (T1.8)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let port;
    let sessionCookie;

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

        const authController = require('../controllers/authController');
        const apiRouter = require('../routes/api');

        app.post('/login-siswa', authController.loginSiswa);
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

        // Login siswa 1
        const loginRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'laptop'
        });
        sessionCookie = loginRes.cookie;
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

    test('1. finalizeSesi menghitung nilai dan mengubah status sesi menjadi selesai', async () => {
        // Simpan 1 jawaban benar untuk soalId (kunci B)
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar, client_ts)
             VALUES (?, ?, ?, 'B', 1, NOW())`,
            [seeded.siswa1Id, seeded.ujianId, seeded.soalId]
        );

        const res = await finalizeSesi(seeded.siswa1Id, seeded.ujianId, pool);
        assert.strictEqual(res.benar, 1);
        assert.strictEqual(res.salah, 0);
        assert.strictEqual(res.kosong, 0);
        assert.strictEqual(res.nilai, 100);

        // Cek tabel nilai_ujian
        const [nilaiRows] = await pool.query(
            'SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(nilaiRows.length, 1);
        assert.strictEqual(nilaiRows[0].nilai, 100);
        assert.ok(nilaiRows[0].selesai_pada);

        // Cek tabel sesi_ujian
        const [sesiRows] = await pool.query(
            'SELECT status, selesai_pada FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesiRows[0].status, 'selesai');
        assert.ok(sesiRows[0].selesai_pada);
    });

    test('2. finalizeSesi berjalan idempoten saat dipanggil berulang kali', async () => {
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar, client_ts)
             VALUES (?, ?, ?, 'B', 1, NOW())`,
            [seeded.siswa1Id, seeded.ujianId, seeded.soalId]
        );

        const res1 = await finalizeSesi(seeded.siswa1Id, seeded.ujianId, pool);
        const res2 = await finalizeSesi(seeded.siswa1Id, seeded.ujianId, pool);

        assert.deepStrictEqual(res1, res2);

        const [nilaiRows] = await pool.query(
            'SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(nilaiRows.length, 1, 'Hanya boleh ada 1 record di nilai_ujian');
    });

    test('3. tutupSesiKadaluarsa otomatis menutup sesi yang melewati batas_waktu + grace', async () => {
        // Atur sesi siswa 1 menjadi kadaluarsa (batas waktu 10 menit yang lalu)
        await pool.query(
            'UPDATE sesi_ujian SET batas_waktu = NOW() - INTERVAL 10 MINUTE WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );

        // Tambah siswa 2 dengan sesi normal yang masih aktif
        const sesiService = require('../services/sesiService');
        await sesiService.mulaiAtauLanjut(seeded.siswa2Id, seeded.ujianId, 'hp', pool);

        // Jalankan auto-finalize
        const hasil = await tutupSesiKadaluarsa(pool, 120);

        // Siswa 1 harus masuk ke hasil penutupan
        assert.strictEqual(hasil.length, 1);
        assert.strictEqual(hasil[0].siswaId, seeded.siswa1Id);

        // Periksa status siswa 1 di DB -> selesai
        const [sesi1] = await pool.query(
            'SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesi1[0].status, 'selesai');

        // Periksa nilai_ujian siswa 1 -> terbuat otomatis
        const [nilai1] = await pool.query(
            'SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(nilai1.length, 1);

        // Periksa status siswa 2 di DB -> tetap sedang_ujian
        const [sesi2] = await pool.query(
            'SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa2Id, seeded.ujianId]
        );
        assert.strictEqual(sesi2[0].status, 'sedang_ujian');
    });

    test('4. POST /api/selesai-ujian memfinalisasi sesi dan merespons hasil nilai', async () => {
        // Siswa menjawab benar soalId
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar, client_ts)
             VALUES (?, ?, ?, 'B', 1, NOW())`,
            [seeded.siswa1Id, seeded.ujianId, seeded.soalId]
        );

        const res = await makeRequest('/api/selesai-ujian', 'POST', {}, sessionCookie);
        assert.strictEqual(res.statusCode, 200);
        const json = JSON.parse(res.body);
        assert.strictEqual(json.nilai, 100);
        assert.strictEqual(json.benar, 1);

        // Verifikasi sesi siswa di DB berubah menjadi selesai
        const [sesi] = await pool.query(
            'SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesi[0].status, 'selesai');
    });
});

