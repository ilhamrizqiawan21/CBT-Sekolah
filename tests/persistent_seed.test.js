const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const session = require('express-session');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('Seed Acak Persisten di Database (T1.5)', () => {
    let pool;
    let seeded;

    before(async () => {
        pool = getTestPool();
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        // Aktifkan acak_soal dan acak_pilihan pada ujian
        await pool.query(
            'UPDATE ujian SET acak_soal = 1, acak_pilihan = 1 WHERE id = ?',
            [seeded.ujianId]
        );

        // Tambah beberapa butir soal agar efek pengacakan terlihat jelas
        for (let i = 2; i <= 6; i++) {
            await pool.query(
                `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
                 VALUES (?, 'pg', ?, 2, 'Pilihan 1', 'Pilihan 2', 'Pilihan 3', 'Pilihan 4', 'A')`,
                [seeded.ujianId, `Pertanyaan ke-${i}`]
            );
        }
    });

    // Helper untuk membuat server app baru (mensimulasikan restart server)
    function createServerApp() {
        const app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));
        app.set('views', '/home/ilhamzp/Projects/CBT-Sekolah/views');
        app.set('view engine', 'ejs');

        const authController = require('../controllers/authController');
        const apiRouter = require('../routes/api');

        app.post('/login-siswa', authController.loginSiswa);
        app.use('/api', apiRouter);

        return http.createServer(app);
    }

    async function makeRequest(server, path, method, body, cookie = null) {
        const port = server.address().port;
        const baseUrl = `http://127.0.0.1:${port}`;
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
            const headers = {};
            let payload = null;

            if (body) {
                payload = JSON.stringify(body);
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) headers['Cookie'] = cookie;

            const req = http.request(url, { method, headers }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    resolve({
                        statusCode: res.statusCode,
                        body: data,
                        cookie: setCookie ? setCookie[0].split(';')[0] : cookie
                    });
                });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    test('Urutan soal dan pilihan identik sebelum dan sesudah restart server untuk siswa yang sama, serta berbeda antar siswa', async () => {
        // --- Instance Server 1 (Sebelum restart) ---
        const server1 = createServerApp();
        await new Promise(resolve => server1.listen(0, '127.0.0.1', resolve));

        // 1. Siswa 1 login dan ambil soal
        const loginSiswa1 = await makeRequest(server1, '/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId)
        });
        const resSoal1_Sebelum = await makeRequest(server1, `/api/soal/${seeded.ujianId}`, 'GET', null, loginSiswa1.cookie);
        assert.strictEqual(resSoal1_Sebelum.statusCode, 200);
        const dataSoal1_Sebelum = JSON.parse(resSoal1_Sebelum.body);
        const urutanIdSiswa1_Sebelum = dataSoal1_Sebelum.map(s => s.id);
        const urutanPilihanSiswa1_Sebelum = dataSoal1_Sebelum.map(s => s.pilihan.map(p => p.text));

        // Matikan Server 1 (Simulasi restart server proses mati)
        await new Promise(resolve => server1.close(resolve));

        // --- Instance Server 2 (Sesudah restart) ---
        const server2 = createServerApp();
        await new Promise(resolve => server2.listen(0, '127.0.0.1', resolve));

        try {
            // 2. Siswa 1 login kembali di server baru
            const loginSiswa1_Baru = await makeRequest(server2, '/login-siswa', 'POST', {
                nis: 'T0001',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId)
            });
            const resSoal1_Sesudah = await makeRequest(server2, `/api/soal/${seeded.ujianId}`, 'GET', null, loginSiswa1_Baru.cookie);
            assert.strictEqual(resSoal1_Sesudah.statusCode, 200);
            const dataSoal1_Sesudah = JSON.parse(resSoal1_Sesudah.body);
            const urutanIdSiswa1_Sesudah = dataSoal1_Sesudah.map(s => s.id);
            const urutanPilihanSiswa1_Sesudah = dataSoal1_Sesudah.map(s => s.pilihan.map(p => p.text));

            // Verifikasi konsistensi sebelum vs sesudah restart server
            assert.deepStrictEqual(
                urutanIdSiswa1_Sesudah,
                urutanIdSiswa1_Sebelum,
                'Urutan soal untuk siswa yang sama harus identik sebelum dan sesudah restart server'
            );
            assert.deepStrictEqual(
                urutanPilihanSiswa1_Sesudah,
                urutanPilihanSiswa1_Sebelum,
                'Urutan pilihan untuk siswa yang sama harus identik sebelum dan sesudah restart server'
            );

            // 3. Siswa 2 login di server 2 (Kelas X-A perlu diberikan pengajaran atau ubah kelas siswa 2 ke X-A untuk tes ini)
            await pool.query("UPDATE siswa SET kelas = 'X-A' WHERE id = ?", [seeded.siswa2Id]);
            const loginSiswa2 = await makeRequest(server2, '/login-siswa', 'POST', {
                nis: 'T0002',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId)
            });
            const resSoal2 = await makeRequest(server2, `/api/soal/${seeded.ujianId}`, 'GET', null, loginSiswa2.cookie);
            assert.strictEqual(resSoal2.statusCode, 200);
            const dataSoal2 = JSON.parse(resSoal2.body);
            const urutanIdSiswa2 = dataSoal2.map(s => s.id);

            // Pastikan seed di database untuk siswa 1 dan siswa 2 berbeda
            const [seedRows] = await pool.query(
                'SELECT siswa_id, seed FROM sesi_ujian WHERE ujian_id = ? ORDER BY siswa_id',
                [seeded.ujianId]
            );
            assert.strictEqual(seedRows.length, 2);
            assert.notStrictEqual(seedRows[0].seed, seedRows[1].seed, 'Seed siswa 1 dan siswa 2 harus berbeda');

            // Pengacakan dengan 6 butir soal pada seed berbeda harus menghasilkan urutan yang berbeda
            const urutanSama = JSON.stringify(urutanIdSiswa1_Sesudah) === JSON.stringify(urutanIdSiswa2);
            assert.strictEqual(urutanSama, false, 'Urutan soal siswa 1 dan siswa 2 harus berbeda');

        } finally {
            await new Promise(resolve => server2.close(resolve));
        }
    });
});

