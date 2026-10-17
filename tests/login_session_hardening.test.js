const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');

describe('Hardening login: pesan seragam & regenerate sesi (temuan 5)', () => {
    let server, base, seeded;

    // Ambil cookie sid dari header set-cookie
    const sid = (res) => (res.headers.getSetCookie().find(c => c.startsWith('connect.sid=')) || '').split(';')[0];
    const post = (url, body, cookie) => fetch(`${base}${url}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) },
        body: new URLSearchParams(body).toString()
    });

    before(async () => {
        const pool = getTestPool();
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        const app = express();
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');
        app.use(express.urlencoded({ extended: true }));
        app.use(session({ secret: 'uji', resave: false, saveUninitialized: false }));
        app.get('/_sesi-anonim', (req, res) => { req.session.anon = 1; res.end('ok'); });
        app.use('/', require('../routes/index'));
        server = http.createServer(app);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        base = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await new Promise(r => server.close(r));
        await cleanDatabase(getTestPool());
        await closeTestPool();
    });

    for (const [peran, url, userOk, redirect] of [
        ['admin', '/login-admin', 'admin_uji', '/admin/dashboard'],
        ['guru', '/login-guru', 'guru_uji', '/guru/dashboard']
    ]) {
        test(`${peran}: username tak dikenal dan password salah memberi pesan sama`, async () => {
            const a = await post(url, { username: 'tidak_ada', password: '1234' });
            const b = await post(url, { username: userOk, password: 'salah-salah' });
            const [ta, tb] = [await a.text(), await b.text()];
            assert.match(ta, /Username atau password salah/);
            assert.match(tb, /Username atau password salah/);
            assert.doesNotMatch(ta + tb, /Username salah|Password salah|tidak ditemukan/);
        });

        test(`${peran}: password non-string (array) tidak membuat server error`, async () => {
            const res = await post(url, { username: userOk, 'password[]': 'x' });
            assert.equal(res.status, 200);
            assert.match(await res.text(), /Username atau password salah/);
        });

        test(`${peran}: login sukses mengganti ID sesi (anti session fixation)`, async () => {
            const cookieAwal = sid(await fetch(`${base}/_sesi-anonim`));
            assert.ok(cookieAwal, 'sesi anonim harus tersimpan sebagai titik awal');
            const res = await post(url, { username: userOk, password: '1234' }, cookieAwal);
            assert.equal(res.status, 302);
            assert.equal(res.headers.get('location'), redirect);
            const cookieBaru = sid(res);
            assert.ok(cookieBaru, 'cookie sesi baru harus dikirim');
            assert.notEqual(cookieBaru, cookieAwal);
        });
    }

    test('siswa: login sukses mengganti ID sesi', async () => {
        const pool = getTestPool();
        await pool.query('UPDATE ujian SET tanggal_mulai = NOW() - INTERVAL 1 HOUR, tanggal_selesai = NOW() + INTERVAL 1 HOUR, token_ujian = NULL WHERE id = ?', [seeded.ujianId]);
        const [[sis]] = await pool.query("SELECT nis FROM siswa WHERE nis = 'T0001'");
        const cookieAwal = sid(await fetch(`${base}/_sesi-anonim`));
        assert.ok(cookieAwal);
        const res = await post('/login-siswa', { nis: sis.nis, pin: '1234', ujian_id: seeded.ujianId, device_type: 'laptop' }, cookieAwal);
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/ujian');
        const cookieBaru = sid(res);
        assert.ok(cookieBaru);
        assert.notEqual(cookieBaru, cookieAwal);
    });
});

describe('Hardening logging: app.js tanpa console.log di jalur panas (temuan 8)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    test('tidak ada console.log; error server memakai logger', () => {
        assert.ok(!/console\.log\(/.test(src), 'app.js tidak boleh memakai console.log');
        assert.ok(/logger\.error\(/.test(src));
    });

    test('level log bisa diatur lewat LOG_LEVEL', () => {
        const prev = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = 'warn';
        delete require.cache[require.resolve('../utils/logger')];
        try {
            assert.equal(require('../utils/logger').level, 'warn');
        } finally {
            if (prev === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = prev;
            delete require.cache[require.resolve('../utils/logger')];
        }
    });
});
