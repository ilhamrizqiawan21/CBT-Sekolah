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
const { hitungStatusTurunan, getMonitorSnapshot } = require('../services/monitorService');

describe('Fase 4: Dashboard Pemantauan Admin (T4.1)', () => {
    describe('1. Pure Logic Status Turunan (hitungStatusTurunan)', () => {
        const now = new Date('2026-10-08T10:00:00Z');

        test('Mengembalikan belum_masuk jika sesi belum ada', () => {
            assert.strictEqual(hitungStatusTurunan(null, now), 'belum_masuk');
            assert.strictEqual(hitungStatusTurunan(undefined, now), 'belum_masuk');
        });

        test('Mengembalikan selesai jika status sesi selesai', () => {
            const sesi = { status: 'selesai', last_seen: now };
            assert.strictEqual(hitungStatusTurunan(sesi, now), 'selesai');
        });

        test('Mengembalikan terkunci jika status sesi keluar_paksa', () => {
            const sesi = { status: 'keluar_paksa', last_seen: now };
            assert.strictEqual(hitungStatusTurunan(sesi, now), 'terkunci');
        });

        test('Mengembalikan online jika sedang_ujian dan last_seen < 45 detik yang lalu', () => {
            // 10 detik yang lalu
            const lastSeen = new Date(now.getTime() - 10 * 1000);
            const sesi = { status: 'sedang_ujian', last_seen: lastSeen };
            assert.strictEqual(hitungStatusTurunan(sesi, now), 'online');

            // 44 detik yang lalu
            const lastSeen44 = new Date(now.getTime() - 44 * 1000);
            assert.strictEqual(hitungStatusTurunan({ status: 'sedang_ujian', last_seen: lastSeen44 }, now), 'online');
        });

        test('Mengembalikan offline jika sedang_ujian dan last_seen >= 45 detik yang lalu atau null', () => {
            // Tepat 45 detik yang lalu
            const lastSeen45 = new Date(now.getTime() - 45 * 1000);
            assert.strictEqual(hitungStatusTurunan({ status: 'sedang_ujian', last_seen: lastSeen45 }, now), 'offline');

            // 60 detik yang lalu
            const lastSeen60 = new Date(now.getTime() - 60 * 1000);
            assert.strictEqual(hitungStatusTurunan({ status: 'sedang_ujian', last_seen: lastSeen60 }, now), 'offline');

            // last_seen null
            assert.strictEqual(hitungStatusTurunan({ status: 'sedang_ujian', last_seen: null }, now), 'offline');
        });
    });

    describe('2. Endpoint Snapshot GET /admin/api/monitor/:ujianId', () => {
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

        test('Hanya admin yang boleh mengakses (403 untuk selain admin)', async () => {
            // 1. Tanpa session
            const resAnon = await makeRequest(`/admin/api/monitor/${seeded.ujianId}`, 'GET', null, null);
            assert.strictEqual(resAnon.statusCode, 403, 'Akses tanpa login harus 403');

            // 2. Session Guru
            const resGuru = await makeRequest(`/admin/api/monitor/${seeded.ujianId}`, 'GET', null, guruCookie);
            assert.strictEqual(resGuru.statusCode, 403, 'Akses sesi guru harus 403');

            // 3. Session Siswa
            const resSiswa = await makeRequest(`/admin/api/monitor/${seeded.ujianId}`, 'GET', null, siswaCookie);
            assert.strictEqual(resSiswa.statusCode, 403, 'Akses sesi siswa harus 403');
        });

        test('Admin berhasil mendapatkan snapshot pemantauan dengan data akurat', async () => {
            // Siswa 1 (T0001, kelas X-A) sudah login dan punya sesi aktif.
            // Buat jawaban untuk Siswa 1
            await pool.query(
                `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar, client_ts)
                 VALUES (?, ?, ?, 'B', 1, NOW())`,
                [seeded.siswa1Id, seeded.ujianId, seeded.soalId]
            );

            // Tambahkan pelanggaran untuk Siswa 1
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan)
                 VALUES (?, ?, 'pindah_tab')`,
                [seeded.siswa1Id, seeded.ujianId]
            );

            // Set device_type pada sesi Siswa 1
            await pool.query(
                `UPDATE sesi_ujian SET device_type = 'laptop'
                 WHERE siswa_id = ? AND ujian_id = ?`,
                [seeded.siswa1Id, seeded.ujianId]
            );

            // Tambahkan Siswa 3 di kelas X-A tapi belum masuk ujian
            const [resSiswa3] = await pool.query(
                "INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0003', 'Siswa Belum Masuk', 'X-A', 'hash')",
            );

            const res = await makeRequest(`/admin/api/monitor/${seeded.ujianId}`, 'GET', null, adminCookie);
            assert.strictEqual(res.statusCode, 200);

            const data = JSON.parse(res.body);
            assert.ok(data.ujian);
            assert.strictEqual(data.ujian.id, seeded.ujianId);
            assert.strictEqual(data.total_soal, 1);

            // Ringkasan
            assert.ok(data.ringkasan);
            assert.strictEqual(data.ringkasan.total_siswa, 2); // Siswa 1 dan Siswa 3 (kelas X-A)
            assert.strictEqual(data.ringkasan.online, 1); // Siswa 1 baru login, last_seen = NOW()
            assert.strictEqual(data.ringkasan.belum_masuk, 1); // Siswa 3 belum punya sesi

            // Per siswa
            const siswa1 = data.siswa.find(s => s.nis === 'T0001');
            assert.ok(siswa1);
            assert.strictEqual(siswa1.status, 'online');
            assert.strictEqual(siswa1.progres.terjawab, 1);
            assert.strictEqual(siswa1.progres.total, 1);
            assert.strictEqual(siswa1.pelanggaran, 1);
            assert.strictEqual(siswa1.perangkat, 'laptop');

            const siswa3 = data.siswa.find(s => s.nis === 'T0003');
            assert.ok(siswa3);
            assert.strictEqual(siswa3.status, 'belum_masuk');
            assert.strictEqual(siswa3.progres.terjawab, 0);
            assert.strictEqual(siswa3.progres.total, 1);
            assert.strictEqual(siswa3.pelanggaran, 0);
            assert.strictEqual(siswa3.perangkat, null);
        });

        test('Snapshot merespons 404 jika ujian tidak ditemukan dan 400 jika ID tidak valid', async () => {
            const res404 = await makeRequest('/admin/api/monitor/99999', 'GET', null, adminCookie);
            assert.strictEqual(res404.statusCode, 404);

            const res400 = await makeRequest('/admin/api/monitor/abc', 'GET', null, adminCookie);
            assert.strictEqual(res400.statusCode, 400);
        });
    });
});
