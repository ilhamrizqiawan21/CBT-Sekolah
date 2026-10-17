const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool,
    TEST_DB_NAME
} = require('./helpers/db');

describe('Backup Database via UI (restore tetap CLI-only)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let adminCookie;
    const tempBackupDir = path.join(__dirname, 'temp_backup_ui');

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const payload = body ? new URLSearchParams(body).toString() : null;
            const headers = {};
            if (payload) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) headers['Cookie'] = cookie;

            const req = http.request(url, { method, headers }, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    const cookieHeader = setCookie && setCookie.length > 0 ? setCookie[0].split(';')[0] : null;
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), cookie: cookieHeader });
                });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    before(async () => {
        pool = getTestPool();

        if (fs.existsSync(tempBackupDir)) fs.rmSync(tempBackupDir, { recursive: true, force: true });
        process.env.BACKUP_DIR = tempBackupDir;
        process.env.DB_NAME = TEST_DB_NAME;

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-backup-ui',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        app.use('/', require('../routes/index'));
        app.use('/admin', require('../routes/admin'));

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (fs.existsSync(tempBackupDir)) fs.rmSync(tempBackupDir, { recursive: true, force: true });
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        const loginRes = await makeRequest('/login-admin', 'POST', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });
        adminCookie = loginRes.cookie;
        assert.ok(adminCookie, 'Admin harus menerima cookie session');
    });

    test('1. Halaman backup kosong sebelum ada backup dibuat', async () => {
        const res = await makeRequest('/admin/backup', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);
        assert.match(res.body.toString(), /Belum ada berkas backup/);
    });

    test('2. Membuat backup menghasilkan berkas .sql.gz dan tercatat di log aktivitas', async () => {
        const res = await makeRequest('/admin/backup/buat', 'POST', null, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /msg=/);

        const files = fs.readdirSync(tempBackupDir).filter(f => f.endsWith('.sql.gz'));
        assert.strictEqual(files.length, 1, 'Harus ada tepat 1 berkas backup');

        const [logs] = await pool.query("SELECT * FROM log_aktivitas_admin WHERE entitas = 'backup'");
        assert.strictEqual(logs.length, 1);
    });

    test('3. Berkas backup yang valid bisa diunduh', async () => {
        await makeRequest('/admin/backup/buat', 'POST', null, adminCookie);
        const files = fs.readdirSync(tempBackupDir).filter(f => f.endsWith('.sql.gz'));
        const filename = files[0];

        const res = await makeRequest(`/admin/backup/download/${encodeURIComponent(filename)}`, 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.body.length > 100, 'Berkas yang diunduh harus berisi data');
    });

    test('4. Percobaan path traversal pada nama berkas ditolak, bukan membocorkan berkas lain', async () => {
        const res = await makeRequest('/admin/backup/download/' + encodeURIComponent('../../.env'), 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);
    });

    test('5. Nama berkas yang tidak sesuai pola backup ditolak', async () => {
        const res = await makeRequest('/admin/backup/download/app.js', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);
    });

    test('6. Akses tanpa login admin ditolak', async () => {
        const res = await makeRequest('/admin/backup', 'GET', null, null);
        assert.notStrictEqual(res.statusCode, 200);
    });
});
