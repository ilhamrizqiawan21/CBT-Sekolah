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

describe('Log Aktivitas Admin (CRUD umum)', () => {
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
            secret: 'test-secret-log-aktivitas',
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

    test('1. Menambahkan guru baru mencatat log aktivitas dengan aksi=tambah, entitas=guru', async () => {
        const res = await makeRequest('/admin/guru/tambah', 'POST', {
            nip: '19990101', nama: 'Guru Baru', username: 'guru_baru_uji', password: 'rahasia123'
        }, adminCookie);
        assert.strictEqual(res.statusCode, 302);

        const [logs] = await pool.query(
            "SELECT * FROM log_aktivitas_admin WHERE entitas = 'guru' AND aksi = 'tambah' ORDER BY id DESC LIMIT 1"
        );
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].admin_id, adminId);
        assert.match(logs[0].detail, /Guru Baru/);
    });

    test('2. Menghapus siswa mencatat log aktivitas dengan aksi=hapus, entitas=siswa', async () => {
        const res = await makeRequest(`/admin/siswa/hapus/${seeded.siswa2Id}`, 'POST', null, adminCookie);
        assert.strictEqual(res.statusCode, 302);

        const [logs] = await pool.query(
            "SELECT * FROM log_aktivitas_admin WHERE entitas = 'siswa' AND aksi = 'hapus' ORDER BY id DESC LIMIT 1"
        );
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(String(logs[0].entitas_id), String(seeded.siswa2Id));
    });

    test('3. Mengedit mata pelajaran mencatat log aktivitas dengan aksi=edit', async () => {
        const [mapelRows] = await pool.query('SELECT id FROM mata_pelajaran LIMIT 1');
        const mapelId = mapelRows[0].id;

        const res = await makeRequest(`/admin/mapel/edit/${mapelId}`, 'POST', {
            nama_mapel: 'Matematika Lanjutan'
        }, adminCookie);
        assert.strictEqual(res.statusCode, 302);

        const [logs] = await pool.query(
            "SELECT * FROM log_aktivitas_admin WHERE entitas = 'mata_pelajaran' AND aksi = 'edit' ORDER BY id DESC LIMIT 1"
        );
        assert.strictEqual(logs.length, 1);
        assert.match(logs[0].detail, /Matematika Lanjutan/);
    });

    test('4. Halaman /admin/log-aktivitas menampilkan riwayat dan filter entitas bekerja', async () => {
        await makeRequest('/admin/kelas/tambah', 'POST', { nama_kelas: 'XI-C' }, adminCookie);
        await makeRequest('/admin/mapel/tambah', 'POST', { nama_mapel: 'Fisika' }, adminCookie);

        const resAll = await makeRequest('/admin/log-aktivitas', 'GET', null, adminCookie);
        assert.strictEqual(resAll.statusCode, 200);
        assert.match(resAll.body, /XI-C/);
        assert.match(resAll.body, /Fisika/);

        const resFiltered = await makeRequest('/admin/log-aktivitas?entitas=kelas', 'GET', null, adminCookie);
        assert.strictEqual(resFiltered.statusCode, 200);
        assert.match(resFiltered.body, /XI-C/);
        assert.doesNotMatch(resFiltered.body, /Menambahkan mata pelajaran Fisika/);
    });

    test('5. Menghapus akun admin yang masih terpakai FK tidak menggagalkan log (admin_id jadi NULL)', async () => {
        const hashed = await require('bcrypt').hash('rahasia123', 10);
        const [resIns] = await pool.query(
            "INSERT INTO admin (username, password) VALUES ('admin_kedua', ?)",
            [hashed]
        );
        const keduaId = resIns.insertId;

        const loginKedua = await makeRequest('/login-admin', 'POST', {
            username: 'admin_kedua', password: 'rahasia123'
        });

        // admin_kedua menambahkan kelas (tercatat atas nama admin_kedua)
        await makeRequest('/admin/kelas/tambah', 'POST', { nama_kelas: 'XI-D' }, loginKedua.cookie);

        // admin_uji menghapus akun admin_kedua
        await makeRequest(`/admin/akun/hapus/${keduaId}`, 'POST', null, adminCookie);

        const [logs] = await pool.query(
            "SELECT admin_id FROM log_aktivitas_admin WHERE detail = 'Menambahkan kelas XI-D'"
        );
        assert.strictEqual(logs.length, 1);
        assert.strictEqual(logs[0].admin_id, null, 'FK ON DELETE SET NULL harus membuat admin_id jadi NULL, bukan menghapus barisnya');
    });

    test('6. Akses tanpa login admin ditolak', async () => {
        const res = await makeRequest('/admin/log-aktivitas', 'GET', null, null);
        assert.notStrictEqual(res.statusCode, 200);
    });
});
