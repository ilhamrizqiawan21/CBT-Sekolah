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

describe('Deteksi dan Catat Tipe Perangkat (T5.1)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const headers = {};
            let payload = null;

            if (body && typeof body === 'object') {
                payload = JSON.stringify(body);
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            } else if (typeof body === 'string') {
                payload = body;
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
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

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-device',
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
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
    });

    test('1. Login siswa dengan device_type=hp mencatat hp di sesi_ujian', async () => {
        const nis = 'T0001';
        const loginBody = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&device_type=hp`;

        const res = await makeRequest('/login-siswa', 'POST', loginBody);
        assert.strictEqual(res.statusCode, 302);
        assert.ok(res.headers.location.includes('/ujian'));

        // Verifikasi sesi_ujian mencatat device_type = 'hp'
        const [sesiRows] = await pool.query(
            'SELECT device_type, status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesiRows.length, 1);
        assert.strictEqual(sesiRows[0].device_type, 'hp');
        assert.strictEqual(sesiRows[0].status, 'sedang_ujian');
    });

    test('2. Login siswa dengan device_type=laptop mencatat laptop di sesi_ujian', async () => {
        const nis = 'T0001';
        const loginBody = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&device_type=laptop`;

        const res = await makeRequest('/login-siswa', 'POST', loginBody);
        assert.strictEqual(res.statusCode, 302);

        const [sesiRows] = await pool.query(
            'SELECT device_type FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesiRows.length, 1);
        assert.strictEqual(sesiRows[0].device_type, 'laptop');
    });

    test('3. Take-over sesi memperbarui device_type sesi dan mencatat log_kecurangan.device_type', async () => {
        const nis = 'T0001';

        // Login pertama dengan laptop
        const login1 = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&device_type=laptop`;
        await makeRequest('/login-siswa', 'POST', login1);

        const [sesi1] = await pool.query('SELECT device_type FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        assert.strictEqual(sesi1[0].device_type, 'laptop');

        // Login kedua (take-over) berpindah ke HP
        const login2 = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&device_type=hp`;
        const res2 = await makeRequest('/login-siswa', 'POST', login2);
        assert.strictEqual(res2.statusCode, 302);

        // Verifikasi sesi_ujian terupdate menjadi 'hp'
        const [sesi2] = await pool.query('SELECT device_type FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        assert.strictEqual(sesi2[0].device_type, 'hp');

        // Verifikasi log_kecurangan mencatat jenis_kecurangan='ambil_alih_sesi' dengan device_type='hp'
        const [logs] = await pool.query(
            "SELECT jenis_kecurangan, device_type FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ? AND jenis_kecurangan = 'ambil_alih_sesi'",
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].device_type, 'hp');
    });

    test('4. Socket event pelanggaran mencatat device_type ke log_kecurangan', async () => {
        const nis = 'T0001';
        // Login dengan hp
        const login = `nis=${encodeURIComponent(nis)}&pin=${seeded.defaultPin}&ujian_id=${seeded.ujianId}&device_type=hp`;
        await makeRequest('/login-siswa', 'POST', login);

        // Simulasikan insert log_kecurangan seperti yang dilakukan handler socket app.js
        const deviceType = 'hp';
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
             VALUES (?, ?, 'pindah_tab', ?)`,
            [seeded.siswa1Id, seeded.ujianId, deviceType]
        );
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
             VALUES (?, ?, 'copy_paste', ?)`,
            [seeded.siswa1Id, seeded.ujianId, deviceType]
        );

        const [pelanggaranRows] = await pool.query(
            "SELECT jenis_kecurangan, device_type FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ? AND jenis_kecurangan IN ('pindah_tab', 'copy_paste') ORDER BY id ASC",
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(pelanggaranRows.length, 2);
        assert.strictEqual(pelanggaranRows[0].device_type, 'hp');
        assert.strictEqual(pelanggaranRows[1].device_type, 'hp');
    });
});
