const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const session = require('express-session');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool,
    TEST_DB_NAME
} = require('./helpers/db');

describe('Login Melanjutkan Sesi & Take-over (T1.3)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;

    before(async () => {
        pool = getTestPool();

        // Siapkan mini server express untuk pengujian login dan API
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

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

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
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
    });

    // Helper request HTTP dengan penyimpanan cookie
    async function makeRequest(path, method, body, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
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

    test('Login -> lanjut sesi: waktu_mulai tetap, perangkat lama menerima 409', async () => {
        // 1. Siswa login pertama kali dari Perangkat A
        const loginDevA = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'laptop'
        });

        assert.strictEqual(loginDevA.statusCode, 302, 'Login pertama harus redirect 302');
        assert.ok(loginDevA.cookie, 'Harus mendapatkan session cookie');
        const cookieA = loginDevA.cookie;

        // Ambil data sesi awal dari DB
        const [sesiRowsA] = await pool.query(
            'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesiRowsA.length, 1);
        const tokenA = sesiRowsA[0].device_token;
        const waktuMulaiA = new Date(sesiRowsA[0].waktu_mulai).getTime();
        const batasWaktuA = new Date(sesiRowsA[0].batas_waktu).getTime();
        assert.ok(tokenA, 'Sesi harus memiliki device_token');

        // Perangkat A mengakses API soal -> Berhasil 200
        const resSoalA = await makeRequest(`/api/soal/${seeded.ujianId}`, 'GET', null, cookieA);
        assert.strictEqual(resSoalA.statusCode, 200, 'Perangkat A harus berhasil mengakses soal');

        // 2. Siswa login kedua kali dari Perangkat B (tutup tab / ganti perangkat)
        const loginDevB = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'hp'
        });

        assert.strictEqual(loginDevB.statusCode, 302, 'Login kedua harus berhasil redirect 302 (take-over)');
        const cookieB = loginDevB.cookie;
        assert.notStrictEqual(cookieB, cookieA, 'Cookie perangkat B harus berbeda dengan cookie A');

        // Cek sesi di DB setelah take-over
        const [sesiRowsB] = await pool.query(
            'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        const tokenB = sesiRowsB[0].device_token;
        const waktuMulaiB = new Date(sesiRowsB[0].waktu_mulai).getTime();
        const batasWaktuB = new Date(sesiRowsB[0].batas_waktu).getTime();

        assert.notStrictEqual(tokenB, tokenA, 'device_token harus diperbarui ke token baru saat take-over');
        assert.strictEqual(waktuMulaiB, waktuMulaiA, 'waktu_mulai tidak boleh berubah saat lanjut sesi');
        assert.strictEqual(batasWaktuB, batasWaktuA, 'batas_waktu tidak boleh berubah saat lanjut sesi');

        // Cek bahwa pengambilalihan dicatat ke log_kecurangan
        const [logRows] = await pool.query(
            "SELECT * FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ? AND jenis_kecurangan = 'ambil_alih_sesi'",
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(logRows.length, 1, 'Pengambilalihan harus tercatat di log_kecurangan');

        // 3. Perangkat B mengakses API soal -> Berhasil 200
        const resSoalB = await makeRequest(`/api/soal/${seeded.ujianId}`, 'GET', null, cookieB);
        assert.strictEqual(resSoalB.statusCode, 200, 'Perangkat B harus berhasil mengakses soal');

        // 4. Perangkat A (yang sudah diambil alih) mencoba mengakses request berikutnya -> Menerima 409 Conflict
        const resSoalAConflict = await makeRequest(`/api/soal/${seeded.ujianId}`, 'GET', null, cookieA);
        assert.strictEqual(resSoalAConflict.statusCode, 409, 'Perangkat A harus menerima status 409 Conflict');
        const jsonA = JSON.parse(resSoalAConflict.body);
        assert.strictEqual(jsonA.code, 409);
        assert.strictEqual(jsonA.error, 'Sesi telah diambil alih di perangkat lain');
    });
});
