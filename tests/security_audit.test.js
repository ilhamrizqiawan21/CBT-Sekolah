const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const session = require('express-session');
const {
    TEST_DB_NAME,
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');
const { verifySameOrigin } = require('../middleware/csrfProtection');

describe('T6.6 Pemeriksaan Keamanan Akhir', () => {
    let pool;
    let seeded;

    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    describe('1. Proteksi CSRF berbasis Origin / Referer (DESIGN §6)', () => {
        let app;
        let server;
        let serverUrl;

        before(async () => {
            app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: true }));
            app.use(verifySameOrigin);
            app.post('/test-action', (req, res) => res.json({ status: 'ok' }));
            app.get('/test-action', (req, res) => res.json({ status: 'ok' }));

            server = http.createServer(app);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const port = server.address().port;
            serverUrl = `http://127.0.0.1:${port}`;
        });

        after(async () => {
            if (server) await new Promise(resolve => server.close(resolve));
        });

        test('POST dengan Origin lintas situs (attacker) ditolak 403', async () => {
            const res = await fetch(`${serverUrl}/test-action`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': 'https://evil-attacker.com'
                },
                body: JSON.stringify({ action: 'delete' })
            });

            assert.strictEqual(res.status, 403, 'Request lintas situs harus ditolak 403');
            const data = await res.json();
            assert.match(data.error, /Origin\/Referer tidak cocok/i);
        });

        test('POST dengan Referer lintas situs ditolak 403', async () => {
            const res = await fetch(`${serverUrl}/test-action`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Referer': 'https://evil-attacker.com/csrf-page'
                },
                body: JSON.stringify({ action: 'delete' })
            });

            assert.strictEqual(res.status, 403, 'Request lintas situs via Referer harus ditolak 403');
        });

        test('POST same-origin (Origin cocok dengan Host) diterima 200', async () => {
            const u = new URL(serverUrl);
            const res = await fetch(`${serverUrl}/test-action`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Origin': `http://${u.host}`
                },
                body: JSON.stringify({ action: 'safe' })
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.status, 'ok');
        });

        test('GET request tidak diblokir oleh proteksi CSRF', async () => {
            const res = await fetch(`${serverUrl}/test-action`, {
                method: 'GET',
                headers: {
                    'Origin': 'https://other-domain.com'
                }
            });

            assert.strictEqual(res.status, 200);
        });
    });

    describe('2. Verifikasi Respon Soal Tidak Membocorkan jawaban_benar', () => {
        let app;
        let server;
        let serverUrl;
        let sessionCookie;

        before(async () => {
            app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: true }));
            app.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));

            const sesiService = require('../services/sesiService');
            const sesi = await sesiService.mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop');

            // Mock login middleware for siswa
            app.use((req, res, next) => {
                req.session.siswaId = seeded.siswa1Id;
                req.session.ujianId = seeded.ujianId;
                req.session.deviceToken = sesi.device_token;
                next();
            });

            app.use('/api', require('../routes/api'));

            server = http.createServer(app);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const port = server.address().port;
            serverUrl = `http://127.0.0.1:${port}`;
        });

        after(async () => {
            if (server) await new Promise(resolve => server.close(resolve));
        });

        test('GET /api/soal/:ujianId sama sekali tidak mengandung properti jawaban_benar', async () => {
            const res = await fetch(`${serverUrl}/api/soal/${seeded.ujianId}`);
            assert.strictEqual(res.status, 200);
            const soalList = await res.json();

            assert.ok(Array.isArray(soalList) && soalList.length > 0, 'Harus mengembalikan daftar soal');

            for (const s of soalList) {
                assert.strictEqual(s.jawaban_benar, undefined, 'Field jawaban_benar tidak boleh ada');
                assert.strictEqual(s.kunci, undefined, 'Field kunci tidak boleh ada');
                assert.strictEqual(s.opsi_tambahan, undefined, 'Field opsi_tambahan mentah tidak boleh dibocorkan');

                if (s.tipe === 'pg') {
                    for (const pil of s.pilihan) {
                        assert.strictEqual(pil.is_benar, undefined, 'is_benar tidak boleh ada di pilihan PG');
                    }
                }

                if (s.tipe === 'menjodohkan') {
                    assert.strictEqual(s.pasangan, undefined, 'Kunci pasangan menjodohkan tidak boleh dibocorkan');
                    assert.ok(Array.isArray(s.kiri), 'Hanya boleh memuat daftar kiri');
                    assert.ok(Array.isArray(s.opsi_kanan), 'Hanya boleh memuat opsi_kanan acak');
                }
            }
        });
    });

    describe('3. Tinjauan Endpoint Tanpa Autentikasi', () => {
        let app;
        let server;
        let serverUrl;

        before(async () => {
            app = express();
            app.use(express.json());
            app.use(express.urlencoded({ extended: true }));
            app.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false
            }));

            app.use('/', require('../routes/index'));
            app.use('/admin', require('../routes/admin'));
            app.use('/guru', require('../routes/guru'));
            app.use('/api', require('../routes/api'));

            server = http.createServer(app);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const port = server.address().port;
            serverUrl = `http://127.0.0.1:${port}`;
        });

        after(async () => {
            if (server) await new Promise(resolve => server.close(resolve));
        });

        test('Endpoint admin tanpa login dialihkan ke /login-admin (302)', async () => {
            const res = await fetch(`${serverUrl}/admin/dashboard`, { redirect: 'manual' });
            assert.strictEqual(res.status, 302);
            assert.match(res.headers.get('location'), /\/login-admin/);
        });

        test('Endpoint guru tanpa login dialihkan ke /login-guru (302)', async () => {
            const res = await fetch(`${serverUrl}/guru/dashboard`, { redirect: 'manual' });
            assert.strictEqual(res.status, 302);
            assert.match(res.headers.get('location'), /\/login-guru/);
        });

        test('Endpoint API privat tanpa session siswa ditolak 401', async () => {
            const res = await fetch(`${serverUrl}/api/sesi`);
            assert.strictEqual(res.status, 401);
        });

        test('Endpoint API soal tanpa session siswa ditolak 401', async () => {
            const res = await fetch(`${serverUrl}/api/soal/1`);
            assert.strictEqual(res.status, 401);
        });

        test('Endpoint GET /api/daftar-ujian dapat diakses publik tanpa data sensitif', async () => {
            const res = await fetch(`${serverUrl}/api/daftar-ujian`);
            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.ok(Array.isArray(data));
            for (const item of data) {
                assert.ok(item.id && item.nama_ujian);
                assert.strictEqual(item.password, undefined);
                assert.strictEqual(item.token_ujian, undefined); // Token ujian tidak dibocorkan di daftar publik
            }
        });
    });
});
