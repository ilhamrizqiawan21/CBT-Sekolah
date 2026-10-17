const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getTestPool, cleanDatabase } = require('./helpers/db');
const { validateEnv, cookieSecure } = require('../utils/validateEnv');
const { buatAdmin } = require('../scripts/create-admin');
const { seedDevelopmentData } = require('../scripts/seed');

const envOk = {
    SESSION_SECRET: 'a'.repeat(40),
    DB_NAME: 'cbt_sekolah',
    DB_USER: 'cbt_user',
    PORT: '3000',
    NODE_ENV: 'production'
};

describe('Hardening produksi: validasi env (temuan 4)', () => {
    test('1. konfigurasi lengkap lolos', () => {
        assert.deepEqual(validateEnv(envOk), []);
    });

    test('2. SESSION_SECRET kosong, contoh, atau pendek ditolak di produksi', () => {
        assert.match(validateEnv({ ...envOk, SESSION_SECRET: '' }).join(), /SESSION_SECRET belum diisi/);
        assert.match(validateEnv({ ...envOk, SESSION_SECRET: 'ganti-dengan-secret-yang-kuat' }).join(), /nilai contoh/);
        assert.match(validateEnv({ ...envOk, SESSION_SECRET: 'pendek' }).join(), /minimal 32/);
    });

    test('3. secret pendek masih boleh saat development, tetapi kosong tetap ditolak', () => {
        assert.deepEqual(validateEnv({ ...envOk, NODE_ENV: 'development', SESSION_SECRET: 'pendek' }), []);
        assert.equal(validateEnv({ ...envOk, NODE_ENV: 'development', SESSION_SECRET: '' }).length, 1);
    });

    test('4. DB_NAME, DB_USER, PORT, COOKIE_SECURE divalidasi', () => {
        const errs = validateEnv({ ...envOk, DB_NAME: '', DB_USER: '', PORT: 'abc', COOKIE_SECURE: 'ya' }).join('\n');
        assert.match(errs, /DB_NAME/);
        assert.match(errs, /DB_USER/);
        assert.match(errs, /PORT tidak valid/);
        assert.match(errs, /COOKIE_SECURE/);
        assert.match(validateEnv({ ...envOk, PORT: '70000' }).join(), /PORT tidak valid/);
    });

    test('5. app.js gagal start dengan pesan jelas bila env tidak valid', () => {
        const { spawnSync } = require('child_process');
        const r = spawnSync('node', ['app.js'], {
            cwd: path.join(__dirname, '..'),
            env: { PATH: process.env.PATH, SESSION_SECRET: '', DB_NAME: 'x', DB_USER: 'x', DOTENV_CONFIG_QUIET: 'true' },
            encoding: 'utf8',
            timeout: 10000
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /SESSION_SECRET belum diisi/);
    });
});

describe('Hardening produksi: flag cookie secure (temuan 1)', () => {
    test('6. default mengikuti NODE_ENV', () => {
        assert.equal(cookieSecure({ NODE_ENV: 'production' }), true);
        assert.equal(cookieSecure({ NODE_ENV: 'development' }), false);
    });

    test('7. COOKIE_SECURE=false mengizinkan produksi di LAN tanpa HTTPS; true memaksa aktif', () => {
        assert.equal(cookieSecure({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }), false);
        assert.equal(cookieSecure({ NODE_ENV: 'development', COOKIE_SECURE: 'true' }), true);
    });
});

describe('Hardening produksi: akun admin (temuan 2)', () => {
    let pool;
    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);
    });
    after(async () => {
        await cleanDatabase(pool);
        await pool.end();
    });

    test('8. membuat admin baru dengan password ter-hash bcrypt', async () => {
        const r = await buatAdmin({ username: 'kepsek', password: 'Rahasia-Kuat-1' }, pool);
        assert.deepEqual(r, { aksi: 'dibuat', username: 'kepsek' });
        const [rows] = await pool.query('SELECT password FROM admin WHERE username = ?', ['kepsek']);
        const bcrypt = require('bcrypt');
        assert.ok(rows[0].password.startsWith('$2'));
        assert.ok(await bcrypt.compare('Rahasia-Kuat-1', rows[0].password));
    });

    test('9. admin yang sudah ada ditolak kecuali --reset; reset mengganti password', async () => {
        await assert.rejects(buatAdmin({ username: 'kepsek', password: 'Lain-Lagi-22' }, pool), /sudah ada/);
        const r = await buatAdmin({ username: 'kepsek', password: 'Lain-Lagi-22', reset: true }, pool);
        assert.equal(r.aksi, 'reset');
        const bcrypt = require('bcrypt');
        const [rows] = await pool.query('SELECT password FROM admin WHERE username = ?', ['kepsek']);
        assert.ok(await bcrypt.compare('Lain-Lagi-22', rows[0].password));
        const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM admin');
        assert.equal(n, 1);
    });

    test('10. username dan password lemah ditolak', async () => {
        await assert.rejects(buatAdmin({ username: 'a b', password: 'Rahasia-Kuat-1' }, pool), /Username/);
        await assert.rejects(buatAdmin({ username: 'admin2', password: 'pendek' }, pool), /minimal 8/);
        await assert.rejects(buatAdmin({ username: 'admin2', password: 'admin123' }, pool), /minimal 8|mudah ditebak/);
    });

    test('11. seed data contoh menolak jalan pada NODE_ENV=production', async () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await assert.rejects(seedDevelopmentData(), /tidak boleh dijalankan pada NODE_ENV=production/);
        } finally {
            process.env.NODE_ENV = prev;
        }
        const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM admin WHERE username = 'admin'");
        assert.equal(n, 0);
    });
});

describe('Hardening produksi: XSS di halaman ujian (temuan 3)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ujian.js'), 'utf8');

    test('12. teks soal, teks pilihan, dan pesan error di-escape sebelum masuk innerHTML', () => {
        assert.ok(!src.includes('${soal.teks_soal}'), 'teks_soal tidak boleh disisipkan mentah');
        assert.ok(!src.includes('${p.text}'), 'teks pilihan tidak boleh disisipkan mentah');
        assert.ok(!src.includes('${err.message}'), 'err.message tidak boleh disisipkan mentah');
        assert.ok(src.includes('${escapeHtml(soal.teks_soal)}'));
        assert.ok(src.includes('${escapeHtml(p.text)}'));
    });

    test('13. escapeHtml menetralkan markup', () => {
        const vm = require('vm');
        const fn = /function escapeHtml\(v\) \{[\s\S]*?\n\}/.exec(src)[0];
        const ctx = {};
        vm.runInNewContext(fn + '; out = escapeHtml(\'<img src=x onerror="alert(1)">\');', ctx);
        assert.equal(ctx.out, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    });
});
