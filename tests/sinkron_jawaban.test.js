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

describe('Sinkron Jawaban Batch IDEMPOTEN (POST /api/sinkron-jawaban) (T1.6)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let port;
    let sessionCookie;
    let secondUjianId;
    let secondSoalId;

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

        // Tambahkan soal kedua pada ujian seeded.ujianId
        const [resSoal2] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Ibu kota Indonesia?', 2, 'Bandung', 'Jakarta', 'Surabaya', 'Medan', 'B')`,
            [seeded.ujianId]
        );
        seeded.soal2Id = resSoal2.insertId;

        // Buat ujian lain & soal milik ujian lain untuk menguji penolakan soal ujian lain
        const [resUjianLain] = await pool.query(
            `INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai)
             VALUES (?, 'Ujian Lain', 60, NOW() - INTERVAL 10 MINUTE, NOW() + INTERVAL 50 MINUTE)`,
            [seeded.pengajaranId]
        );
        secondUjianId = resUjianLain.insertId;

        const [resSoalLain] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Soal milik ujian lain', 2, 'A', 'B', 'C', 'D', 'A')`,
            [secondUjianId]
        );
        secondSoalId = resSoalLain.insertId;

        // Login siswa 1 untuk mendapatkan cookie sesi aktif
        const loginRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'laptop'
        });
        sessionCookie = loginRes.cookie;
    });

    async function makeRequest(reqPath, method, body, cookie = null, headersExtra = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(reqPath, baseUrl);
            const headers = { ...headersExtra };
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

    test('1. Idempoten: kirim batch yang sama dua kali menghasilkan respons dan data DB yang identik', async () => {
        const batch = {
            jawaban: [
                { soal_id: seeded.soalId, jawaban: 'B', client_ts: '2026-10-07T10:00:00.000Z' },
                { soal_id: seeded.soal2Id, jawaban: 'B', client_ts: '2026-10-07T10:00:05.000Z' }
            ]
        };

        // Kirim pertama
        const res1 = await makeRequest('/api/sinkron-jawaban', 'POST', batch, sessionCookie);
        assert.strictEqual(res1.statusCode, 200);
        const json1 = JSON.parse(res1.body);
        assert.strictEqual(json1.success, true);
        assert.strictEqual(json1.tersinkron, 2);
        assert.strictEqual(json1.diabaikan, 0);

        // Periksa data di DB setelah kirim pertama
        const [rows1] = await pool.query(
            'SELECT soal_id, jawaban_dipilih, is_benar FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ? ORDER BY soal_id ASC',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(rows1.length, 2);
        assert.strictEqual(rows1[0].jawaban_dipilih, 'B');
        assert.strictEqual(rows1[0].is_benar, 1); // Jawaban soal 1 adalah 'B', benar
        assert.strictEqual(rows1[1].jawaban_dipilih, 'B');
        assert.strictEqual(rows1[1].is_benar, 1); // Jawaban soal 2 adalah 'B', benar

        // Kirim kedua dengan payload yang sama persis
        const res2 = await makeRequest('/api/sinkron-jawaban', 'POST', batch, sessionCookie);
        assert.strictEqual(res2.statusCode, 200);
        const json2 = JSON.parse(res2.body);
        assert.strictEqual(json2.success, true);
        assert.strictEqual(json2.tersinkron, 2);

        // Periksa data di DB setelah kirim kedua: tidak ada duplikasi
        const [rows2] = await pool.query(
            'SELECT soal_id, jawaban_dipilih, is_benar FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ? ORDER BY soal_id ASC',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(rows2.length, 2);
        assert.deepStrictEqual(rows2, rows1, 'Data di database harus persis sama dan idempoten');
    });

    test('2. client_ts lebih lama tidak menimpa yang baru', async () => {
        // Simpan jawaban baru terlebih dahulu: jawaban 'B' pada jam 10:10
        const batchBaru = {
            jawaban: [
                { soal_id: seeded.soalId, jawaban: 'B', client_ts: '2026-10-07T10:10:00.000Z' }
            ]
        };
        const resBaru = await makeRequest('/api/sinkron-jawaban', 'POST', batchBaru, sessionCookie);
        assert.strictEqual(resBaru.statusCode, 200);

        // Cek bahwa jawaban di DB adalah 'B'
        const [rowSetelahBaru] = await pool.query(
            'SELECT jawaban_dipilih FROM jawaban_siswa WHERE siswa_id = ? AND soal_id = ?',
            [seeded.siswa1Id, seeded.soalId]
        );
        assert.strictEqual(rowSetelahBaru[0].jawaban_dipilih, 'B');

        // Sekarang kirim jawaban dengan timestamp lebih usang: jawaban 'A' pada jam 10:05
        const batchLama = {
            jawaban: [
                { soal_id: seeded.soalId, jawaban: 'A', client_ts: '2026-10-07T10:05:00.000Z' }
            ]
        };
        const resLama = await makeRequest('/api/sinkron-jawaban', 'POST', batchLama, sessionCookie);
        assert.strictEqual(resLama.statusCode, 200);
        const jsonLama = JSON.parse(resLama.body);
        assert.strictEqual(jsonLama.diabaikan, 1, 'Jawaban usang harus diabaikan');
        assert.strictEqual(jsonLama.tersinkron, 0);

        // Pastikan jawaban di DB TETAP 'B' (tidak tertimpa oleh 'A')
        const [rowFinal] = await pool.query(
            'SELECT jawaban_dipilih FROM jawaban_siswa WHERE siswa_id = ? AND soal_id = ?',
            [seeded.siswa1Id, seeded.soalId]
        );
        assert.strictEqual(rowFinal[0].jawaban_dipilih, 'B', 'Jawaban lama tidak boleh menimpa jawaban baru');
    });

    test('3. Soal ujian lain ditolak', async () => {
        // Kirim jawaban dengan soal_id yang merupakan milik ujian lain (secondSoalId)
        const batchCampuran = {
            jawaban: [
                { soal_id: seeded.soalId, jawaban: 'B' },
                { soal_id: secondSoalId, jawaban: 'A' }
            ]
        };

        const res = await makeRequest('/api/sinkron-jawaban', 'POST', batchCampuran, sessionCookie);
        assert.strictEqual(res.statusCode, 400, 'Harus ditolak 400 Bad Request jika ada soal ujian lain');
        const json = JSON.parse(res.body);
        assert.ok(json.error.includes('tidak ditemukan atau bukan milik ujian ini'));

        // Pastikan tidak ada data yang tersimpan dari request yang gagal tersebut
        const [checkRows] = await pool.query(
            'SELECT * FROM jawaban_siswa WHERE siswa_id = ? AND soal_id = ?',
            [seeded.siswa1Id, secondSoalId]
        );
        assert.strictEqual(checkRows.length, 0);
    });

    test('4. Batasi ukuran batch maksimal 100 item', async () => {
        const batchTerlaluBesar = {
            jawaban: Array.from({ length: 101 }, (_, i) => ({
                soal_id: seeded.soalId,
                jawaban: 'A'
            }))
        };

        const res = await makeRequest('/api/sinkron-jawaban', 'POST', batchTerlaluBesar, sessionCookie);
        assert.strictEqual(res.statusCode, 400);
        const json = JSON.parse(res.body);
        assert.ok(json.error.includes('100'));
    });

    test('5. Hitung is_benar di server dan respons tidak membocorkan kunci jawaban', async () => {
        const batch = {
            jawaban: [
                { soal_id: seeded.soalId, jawaban: 'B' }, // Benar (kunci B)
                { soal_id: seeded.soal2Id, jawaban: 'C' } // Salah (kunci B)
            ]
        };

        const res = await makeRequest('/api/sinkron-jawaban', 'POST', batch, sessionCookie);
        assert.strictEqual(res.statusCode, 200);
        const json = JSON.parse(res.body);

        // Pastikan TIDAK ADA kunci jawaban di response
        assert.strictEqual(json.jawaban_benar, undefined);
        assert.strictEqual(json.kunci, undefined);
        assert.strictEqual(json.is_benar, undefined);

        // Verifikasi perhitungan is_benar di DB
        const [rows] = await pool.query(
            'SELECT soal_id, is_benar FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ? ORDER BY soal_id ASC',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(rows[0].is_benar, 1, 'Soal 1 dijawab B harus bernilai is_benar=1');
        assert.strictEqual(rows[1].is_benar, 0, 'Soal 2 dijawab C harus bernilai is_benar=0');
    });

    test('6. Perangkat lama menerima 409 Conflict jika sesi telah diambil alih', async () => {
        // Siswa login lagi dari perangkat lain (take-over)
        const loginDev2 = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'hp'
        });
        assert.strictEqual(loginDev2.statusCode, 302);
        const cookieDev2 = loginDev2.cookie;

        // Perangkat baru dapat melakukan sinkronisasi
        const resDev2 = await makeRequest('/api/sinkron-jawaban', 'POST', {
            jawaban: [{ soal_id: seeded.soalId, jawaban: 'B' }]
        }, cookieDev2);
        assert.strictEqual(resDev2.statusCode, 200);

        // Perangkat lama (sessionCookie lama) mencoba sinkronisasi -> Ditolak 409 Conflict
        const resDev1Conflict = await makeRequest('/api/sinkron-jawaban', 'POST', {
            jawaban: [{ soal_id: seeded.soalId, jawaban: 'C' }]
        }, sessionCookie);
        assert.strictEqual(resDev1Conflict.statusCode, 409);
        const jsonConflict = JSON.parse(resDev1Conflict.body);
        assert.strictEqual(jsonConflict.code, 409);
    });

    test('7. Menolak sinkronisasi jika waktu telah melewati batas_waktu + grace period', async () => {
        // Atur batas_waktu sesi ke waktu lampau yang melewati grace period (misal 5 menit lalu)
        await pool.query(
            'UPDATE sesi_ujian SET batas_waktu = NOW() - INTERVAL 10 MINUTE WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );

        const res = await makeRequest('/api/sinkron-jawaban', 'POST', {
            jawaban: [{ soal_id: seeded.soalId, jawaban: 'B' }]
        }, sessionCookie);

        assert.strictEqual(res.statusCode, 403);
        const json = JSON.parse(res.body);
        assert.strictEqual(json.code, 'waktu_habis');
    });

    test('8. client_ts di masa depan dibatasi ke waktu server sehingga tidak mengunci jawaban berikutnya', async () => {
        const masaDepan = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const res1 = await makeRequest('/api/sinkron-jawaban', 'POST', {
            jawaban: [{ soal_id: seeded.soalId, jawaban: 'A', client_ts: masaDepan }]
        }, sessionCookie);
        assert.strictEqual(res1.statusCode, 200);

        const res2 = await makeRequest('/api/sinkron-jawaban', 'POST', {
            jawaban: [{ soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date(Date.now() + 1000).toISOString() }]
        }, sessionCookie);
        assert.strictEqual(res2.statusCode, 200);

        const [rows] = await pool.query(
            'SELECT jawaban_dipilih FROM jawaban_siswa WHERE siswa_id = ? AND soal_id = ?',
            [seeded.siswa1Id, seeded.soalId]
        );
        assert.strictEqual(rows[0].jawaban_dipilih, 'B');
    });
});
