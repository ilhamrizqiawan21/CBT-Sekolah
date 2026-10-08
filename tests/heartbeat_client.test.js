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

describe('Heartbeat & Client Session Support (T1.7)', () => {
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

        const loginRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'hp'
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

    test('POST /api/heartbeat memperbarui last_seen di database', async () => {
        // Set last_seen ke 1 menit yang lalu
        await pool.query(
            'UPDATE sesi_ujian SET last_seen = NOW() - INTERVAL 1 MINUTE WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );

        const [rowsBefore] = await pool.query(
            'SELECT last_seen FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        const timeBefore = new Date(rowsBefore[0].last_seen).getTime();

        // Panggil endpoint heartbeat
        const res = await makeRequest('/api/heartbeat', 'POST', {}, sessionCookie);
        assert.strictEqual(res.statusCode, 200);
        const json = JSON.parse(res.body);
        assert.strictEqual(json.success, true);

        // Verifikasi last_seen di DB bertambah baru
        const [rowsAfter] = await pool.query(
            'SELECT last_seen FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        const timeAfter = new Date(rowsAfter[0].last_seen).getTime();
        assert.ok(timeAfter > timeBefore, 'last_seen harus dimajukan setelah heartbeat');
    });

    test('POST /api/heartbeat mengembalikan 409 jika sesi telah diambil alih (take-over)', async () => {
        // Login di perangkat kedua
        const loginDev2 = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId),
            device_type: 'laptop'
        });
        assert.strictEqual(loginDev2.statusCode, 302);

        // Heartbeat dari perangkat lama (cookie lama) harus menerima 409 Conflict
        const res = await makeRequest('/api/heartbeat', 'POST', {}, sessionCookie);
        assert.strictEqual(res.statusCode, 409);
        const json = JSON.parse(res.body);
        assert.strictEqual(json.code, 409);
    });

    test('POST /api/heartbeat mengembalikan 401 jika tanpa sesi login', async () => {
        const res = await makeRequest('/api/heartbeat', 'POST', {}, null);
        assert.strictEqual(res.statusCode, 401);
    });
});

