const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('T7.1 Guru: Ganti Password Sendiri (/guru/profil)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let guruCookie;
    let guruId;

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
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    const cookieHeader = setCookie && setCookie.length > 0 ? setCookie[0].split(';')[0] : null;
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: data, cookie: cookieHeader });
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
            secret: 'test-secret-guru-profil',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        app.use('/', require('../routes/index'));
        app.use('/guru', require('../routes/guru'));

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        const loginRes = await makeRequest('/login-guru', 'POST', {
            username: 'guru_uji',
            password: seeded.defaultPin
        });
        guruCookie = loginRes.cookie;
        assert.ok(guruCookie, 'Guru harus menerima cookie session');

        const [rows] = await pool.query("SELECT id FROM guru WHERE username = 'guru_uji'");
        guruId = rows[0].id;
    });

    test('0. Akses tanpa login ditolak dan diarahkan ke /login-guru', async () => {
        const res = await makeRequest('/guru/profil', 'GET');
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /\/login-guru/);
    });

    test('1. Password lama salah ditolak dan password di DB tidak berubah', async () => {
        const [oldGuru] = await pool.query('SELECT password FROM guru WHERE id = ?', [guruId]);
        const oldHash = oldGuru[0].password;

        const res = await makeRequest('/guru/profil', 'POST', {
            password_lama: 'passwordsalah123',
            password_baru: 'passwordbaru123',
            konfirmasi_baru: 'passwordbaru123'
        }, guruCookie);

        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);

        const [currGuru] = await pool.query('SELECT password FROM guru WHERE id = ?', [guruId]);
        assert.strictEqual(currGuru[0].password, oldHash, 'Hash password di database tidak boleh berubah');
    });

    test('2. Password baru < 6 karakter ditolak', async () => {
        const res = await makeRequest('/guru/profil', 'POST', {
            password_lama: seeded.defaultPin,
            password_baru: '12345',
            konfirmasi_baru: '12345'
        }, guruCookie);

        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);
        assert.match(decodeURIComponent(res.headers.location), /Password guru minimal 6 karakter/);
    });

    test('3. Konfirmasi password baru tidak cocok ditolak', async () => {
        const res = await makeRequest('/guru/profil', 'POST', {
            password_lama: seeded.defaultPin,
            password_baru: 'passwordbaru123',
            konfirmasi_baru: 'berbedapassword'
        }, guruCookie);

        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);
        assert.match(decodeURIComponent(res.headers.location), /Konfirmasi password tidak cocok/);
    });

    test('4. Kombinasi benar berhasil update, login lama gagal, login baru berhasil', async () => {
        const res = await makeRequest('/guru/profil', 'POST', {
            password_lama: seeded.defaultPin,
            password_baru: 'guruBaru123!',
            konfirmasi_baru: 'guruBaru123!'
        }, guruCookie);

        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /msg=/);

        // Verifikasi login dengan password lama gagal
        const loginOldRes = await makeRequest('/login-guru', 'POST', {
            username: 'guru_uji',
            password: seeded.defaultPin
        });
        assert.strictEqual(loginOldRes.statusCode, 200, 'Render view login jika gagal');
        assert.match(loginOldRes.body, /Username atau password salah/);

        // Verifikasi login dengan password baru berhasil
        const loginNewRes = await makeRequest('/login-guru', 'POST', {
            username: 'guru_uji',
            password: 'guruBaru123!'
        });
        assert.strictEqual(loginNewRes.statusCode, 302);
        assert.match(loginNewRes.headers.location, /\/guru\/dashboard/);
    });
});
