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

describe('Manajemen Akun Admin', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let adminCookie;
    let adminId;

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
            secret: 'test-secret-akun',
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

        const [rows] = await pool.query("SELECT id FROM admin WHERE username = 'admin_uji'");
        adminId = rows[0].id;
    });

    test('1. Menambahkan akun admin baru dengan password valid berhasil', async () => {
        const res = await makeRequest('/admin/akun/tambah', 'POST', {
            username: 'admin_kedua',
            password: 'rahasia123'
        }, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /msg=/);

        const [rows] = await pool.query("SELECT id FROM admin WHERE username = 'admin_kedua'");
        assert.strictEqual(rows.length, 1);
    });

    test('2. Menambahkan akun dengan password < 8 karakter ditolak', async () => {
        const res = await makeRequest('/admin/akun/tambah', 'POST', {
            username: 'admin_lemah',
            password: '123'
        }, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);

        const [rows] = await pool.query("SELECT id FROM admin WHERE username = 'admin_lemah'");
        assert.strictEqual(rows.length, 0);
    });

    test('3. Menambahkan akun dengan username yang sudah dipakai ditolak', async () => {
        const res = await makeRequest('/admin/akun/tambah', 'POST', {
            username: 'admin_uji',
            password: 'rahasia123'
        }, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);

        const [rows] = await pool.query("SELECT COUNT(*) as total FROM admin WHERE username = 'admin_uji'");
        assert.strictEqual(rows[0].total, 1);
    });

    test('4. Edit akun tanpa mengisi password tidak mengubah password lama', async () => {
        const res = await makeRequest(`/admin/akun/edit/${adminId}`, 'POST', {
            username: 'admin_uji_rename',
            password: ''
        }, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /msg=/);

        const loginUlang = await makeRequest('/login-admin', 'POST', {
            username: 'admin_uji_rename',
            password: seeded.defaultPin
        });
        assert.ok(loginUlang.cookie, 'Password lama harus tetap berlaku setelah edit tanpa isi password baru');
    });

    test('5. Admin tidak bisa menghapus akun miliknya sendiri', async () => {
        const res = await makeRequest(`/admin/akun/hapus/${adminId}`, 'POST', null, adminCookie);
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /error=/);

        const [rows] = await pool.query('SELECT id FROM admin WHERE id = ?', [adminId]);
        assert.strictEqual(rows.length, 1, 'Akun sendiri tidak boleh terhapus');
    });

    test('6. Satu-satunya akun admin yang tersisa tidak bisa dihapus meski oleh admin lain', async () => {
        const hashed = await require('bcrypt').hash('rahasia123', 10);
        const [resIns] = await pool.query(
            "INSERT INTO admin (username, password) VALUES ('admin_kedua', ?)",
            [hashed]
        );
        const keduaId = resIns.insertId;

        // Hapus akun pertama (bukan diri sendiri dari sudut pandang admin_uji -> OK, 2 admin tersisa jadi 1)
        await makeRequest(`/admin/akun/hapus/${keduaId}`, 'POST', null, adminCookie);
        const [sisa] = await pool.query('SELECT COUNT(*) as total FROM admin');
        assert.strictEqual(sisa[0].total, 1, 'Harus tersisa 1 admin setelah penghapusan admin_kedua');
    });

    test('7. Akses tanpa login admin ditolak', async () => {
        const res = await makeRequest('/admin/akun', 'GET', null, null);
        assert.notStrictEqual(res.statusCode, 200);
    });
});
