const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
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

describe('Pengujian Ketahanan Sesi End-to-End (T1.10)', () => {
    let pool;
    let seeded;
    let sessionStore;

    // Helper untuk membuat aplikasi server express dengan session MySQL
    function createApp() {
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        app.use(session({
            secret: 'test-secret',
            store: sessionStore,
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));

        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        const authController = require('../controllers/authController');
        const apiRouter = require('../routes/api');
        const adminRouter = require('../routes/admin');
        const indexRouter = require('../routes/index');

        app.use('/', indexRouter);
        app.use('/admin', adminRouter);
        app.use('/api', apiRouter);

        return app;
    }

    async function startServer(app) {
        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        const baseUrl = `http://127.0.0.1:${port}`;
        return { server, baseUrl, port };
    }

    async function makeRequest(baseUrl, reqPath, method, body, cookie = null) {
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

    before(async () => {
        pool = getTestPool();
        sessionStore = new MySQLStore({
            clearExpired: true,
            checkExpirationInterval: 900000,
            createDatabaseTable: true
        }, pool);
    });

    after(async () => {
        // Hentikan timer pembersih session store agar proses test dapat keluar
        await sessionStore.close();
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        // Tambahkan soal ke-2 dan ke-3 pada ujian seeded.ujianId
        const [resSoal2] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Hasil dari 5 x 5?', 2, '20', '25', '30', '35', 'B')`,
            [seeded.ujianId]
        );
        seeded.soal2Id = resSoal2.insertId;

        const [resSoal3] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Hasil dari 10 - 4?', 2, '6', '7', '8', '9', 'A')`,
            [seeded.ujianId]
        );
        seeded.soal3Id = resSoal3.insertId;
    });

    test('Skenario 1: Siswa login, jawab, putus koneksi (tutup browser), login ulang, lanjut sesi', async () => {
        const instance = await startServer(createApp());
        try {
            // 1. Siswa login pertama kali
            const login1 = await makeRequest(instance.baseUrl, '/login-siswa', 'POST', {
                nis: 'T0001',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId),
                device_type: 'laptop'
            });
            assert.strictEqual(login1.statusCode, 302);
            const cookieSiswa = login1.cookie;

            // Catat waktu mulai dan batas waktu awal di database
            const [sesiAwalRows] = await pool.query(
                'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            assert.strictEqual(sesiAwalRows.length, 1);
            const waktuMulaiAwal = new Date(sesiAwalRows[0].waktu_mulai).getTime();
            const batasWaktuAwal = new Date(sesiAwalRows[0].batas_waktu).getTime();

            // 2. Siswa menjawab soal ke-1
            const resJawab1 = await makeRequest(instance.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [{ soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date().toISOString() }]
            }, cookieSiswa);
            assert.strictEqual(resJawab1.statusCode, 200);

            // 3. Siswa putus koneksi / tutup browser (simulasi: client baru tanpa cookie lama)
            // 4. Siswa login ulang dengan NIS dan PIN yang sama
            const login2 = await makeRequest(instance.baseUrl, '/login-siswa', 'POST', {
                nis: 'T0001',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId),
                device_type: 'hp'
            });
            assert.strictEqual(login2.statusCode, 302);
            const cookieSiswaBaru = login2.cookie;

            // Verifikasi sesi berlanjut: waktu_mulai dan batas_waktu TIDAK berubah (tidak reset)
            const [sesiLanjutRows] = await pool.query(
                'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            assert.strictEqual(sesiLanjutRows.length, 1);
            assert.strictEqual(new Date(sesiLanjutRows[0].waktu_mulai).getTime(), waktuMulaiAwal);
            assert.strictEqual(new Date(sesiLanjutRows[0].batas_waktu).getTime(), batasWaktuAwal);
            assert.strictEqual(sesiLanjutRows[0].status, 'sedang_ujian');

            // Verifikasi jawaban soal 1 sebelumnya tetap ada saat cek GET /api/sesi
            const resSesiLanjut = await makeRequest(instance.baseUrl, '/api/sesi', 'GET', null, cookieSiswaBaru);
            assert.strictEqual(resSesiLanjut.statusCode, 200);
            const jsonSesi = JSON.parse(resSesiLanjut.body);
            assert.strictEqual(jsonSesi.jawaban_tersimpan[seeded.soalId], 'B');

            // 5. Siswa melanjutkan menjawab soal ke-2
            const resJawab2 = await makeRequest(instance.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [{ soal_id: seeded.soal2Id, jawaban: 'B', client_ts: new Date().toISOString() }]
            }, cookieSiswaBaru);
            assert.strictEqual(resJawab2.statusCode, 200);

            // Verifikasi kedua jawaban tersimpan
            const [jawabanAll] = await pool.query(
                'SELECT soal_id, jawaban_dipilih FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            assert.strictEqual(jawabanAll.length, 2);

        } finally {
            await new Promise(r => instance.server.close(r));
        }
    });

    test('Skenario 2: Restart server saat ujian sedang berlangsung (klien tetap login, timer & seed konsisten)', async () => {
        // Jalankan Server Instance 1
        const instance1 = await startServer(createApp());
        let cookieSiswa;
        let seedAwal;

        try {
            // Siswa login di Instance 1
            const login = await makeRequest(instance1.baseUrl, '/login-siswa', 'POST', {
                nis: 'T0001',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId),
                device_type: 'laptop'
            });
            cookieSiswa = login.cookie;

            // Siswa menjawab soal ke-1
            await makeRequest(instance1.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [{ soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date().toISOString() }]
            }, cookieSiswa);

            // Ambil seed acak soal di DB
            const [sesiRows] = await pool.query(
                'SELECT seed FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            seedAwal = sesiRows[0].seed;

            // Ambil daftar urutan soal di Instance 1
            const resSoal1 = await makeRequest(instance1.baseUrl, `/api/soal/${seeded.ujianId}`, 'GET', null, cookieSiswa);
            assert.strictEqual(resSoal1.statusCode, 200);

        } finally {
            // Matikan Server Instance 1 (simulasi restart / crash)
            await new Promise(r => instance1.server.close(r));
        }

        // Jalankan Server Instance 2 (setelah restart)
        const instance2 = await startServer(createApp());
        try {
            // Menggunakan cookie yang sama: sesi tetap valid karena express-mysql-session
            const resSesiInstance2 = await makeRequest(instance2.baseUrl, '/api/sesi', 'GET', null, cookieSiswa);
            assert.strictEqual(resSesiInstance2.statusCode, 200, 'Siswa harus tetap login di server instance baru');
            const jsonSesi2 = JSON.parse(resSesiInstance2.body);
            assert.ok(jsonSesi2.sisa_detik > 0, 'Sisa detik harus dihitung akurat dari server');
            assert.strictEqual(jsonSesi2.jawaban_tersimpan[seeded.soalId], 'B');

            // Soal di Instance 2 harus konsisten (seed di DB tidak berubah)
            const [sesiAfterRestart] = await pool.query(
                'SELECT seed FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            assert.strictEqual(sesiAfterRestart[0].seed, seedAwal);

            // Siswa dapat lanjut menjawab soal ke-2 di server instance baru
            const resJawab2 = await makeRequest(instance2.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [{ soal_id: seeded.soal2Id, jawaban: 'B', client_ts: new Date().toISOString() }]
            }, cookieSiswa);
            assert.strictEqual(resJawab2.statusCode, 200);

        } finally {
            await new Promise(r => instance2.server.close(r));
        }
    });

    test('Skenario 3: Sesi kedaluwarsa tanpa siswa online otomatis difinalisasi oleh background job', async () => {
        const instance = await startServer(createApp());
        try {
            // Siswa login dan menjawab 2 soal
            const login = await makeRequest(instance.baseUrl, '/login-siswa', 'POST', {
                nis: 'T0001',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId),
                device_type: 'hp'
            });
            const cookie = login.cookie;

            await makeRequest(instance.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [
                    { soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date().toISOString() }, // Benar
                    { soal_id: seeded.soal2Id, jawaban: 'B', client_ts: new Date().toISOString() }  // Benar
                ]
            }, cookie);

            // Siswa offline (tidak pernah membuka browser lagi)
            // Waktu ujian melewati batas_waktu + grace period
            await pool.query(
                'UPDATE sesi_ujian SET batas_waktu = NOW() - INTERVAL 5 MINUTE WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );

            // Job auto-finalize berjalan
            const hasilTutup = await tutupSesiKadaluarsa(pool, 120);
            assert.strictEqual(hasilTutup.length, 1);
            assert.strictEqual(hasilTutup[0].siswaId, seeded.siswa1Id);

            // Status sesi di DB menjadi selesai
            const [sesiFinal] = await pool.query(
                'SELECT status, selesai_pada FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            assert.strictEqual(sesiFinal[0].status, 'selesai');
            assert.ok(sesiFinal[0].selesai_pada);

            // Nilai siswa otomatis tersimpan di nilai_ujian (2 benar dari 3 total soal = 67)
            const [nilaiFinal] = await pool.query(
                'SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            assert.strictEqual(nilaiFinal.length, 1);
            assert.strictEqual(nilaiFinal[0].benar, 2);
            assert.strictEqual(nilaiFinal[0].kosong, 1);
            assert.strictEqual(nilaiFinal[0].nilai, 67);

        } finally {
            await new Promise(r => instance.server.close(r));
        }
    });

    test('Skenario 4: Siswa terkena keluar_paksa, dibuka kunci oleh admin, dan menyelesaikan ujian', async () => {
        const instance = await startServer(createApp());
        try {
            // 1. Login Admin
            const adminLogin = await makeRequest(instance.baseUrl, '/login-admin', 'POST', {
                username: 'admin_uji',
                password: seeded.defaultPin
            });
            const adminCookie = adminLogin.cookie;

            // 2. Siswa login & menjawab soal 1
            const siswaLogin = await makeRequest(instance.baseUrl, '/login-siswa', 'POST', {
                nis: 'T0001',
                pin: seeded.defaultPin,
                ujian_id: String(seeded.ujianId),
                device_type: 'laptop'
            });
            const siswaCookie = siswaLogin.cookie;

            await makeRequest(instance.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [{ soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date().toISOString() }]
            }, siswaCookie);

            // Ambil sesiId
            const [sesiRows] = await pool.query(
                'SELECT id FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            const sesiId = sesiRows[0].id;

            // 3. Siswa melanggar aturan dan terkunci keluar_paksa
            await pool.query("UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE id = ?", [sesiId]);

            // Klien mencoba sinkronisasi -> Ditolak 403
            const resBlocked = await makeRequest(instance.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [{ soal_id: seeded.soal2Id, jawaban: 'B' }]
            }, siswaCookie);
            assert.strictEqual(resBlocked.statusCode, 403);

            // 4. Admin membuka kunci siswa via endpoint buka-kunci
            const resBuka = await makeRequest(instance.baseUrl, `/admin/api/sesi/${sesiId}/buka-kunci`, 'POST', {}, adminCookie);
            assert.strictEqual(resBuka.statusCode, 200);

            // 5. Siswa dapat melanjutkan kembali: menjawab soal 2 & 3
            const resLanjutJawab = await makeRequest(instance.baseUrl, '/api/sinkron-jawaban', 'POST', {
                jawaban: [
                    { soal_id: seeded.soal2Id, jawaban: 'B', client_ts: new Date().toISOString() },
                    { soal_id: seeded.soal3Id, jawaban: 'A', client_ts: new Date().toISOString() }
                ]
            }, siswaCookie);
            assert.strictEqual(resLanjutJawab.statusCode, 200);

            // 6. Siswa menyelesaikan ujian secara normal
            const resSelesai = await makeRequest(instance.baseUrl, '/api/selesai-ujian', 'POST', {}, siswaCookie);
            assert.strictEqual(resSelesai.statusCode, 200);
            const jsonSelesai = JSON.parse(resSelesai.body);
            assert.strictEqual(jsonSelesai.benar, 3);
            assert.strictEqual(jsonSelesai.nilai, 100);

            // Status akhir di DB -> selesai
            const [sesiAkhir] = await pool.query('SELECT status FROM sesi_ujian WHERE id = ?', [sesiId]);
            assert.strictEqual(sesiAkhir[0].status, 'selesai');

        } finally {
            await new Promise(r => instance.server.close(r));
        }
    });
});

