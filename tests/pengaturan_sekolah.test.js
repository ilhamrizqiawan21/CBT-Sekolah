const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const session = require('express-session');
const {
    TEST_DB_NAME,
    getTestPool,
    cleanDatabase,
    closeTestPool
} = require('./helpers/db');
const pengaturanService = require('../services/pengaturanService');

describe('Pengaturan Identitas & Logo Sekolah (/admin/pengaturan)', () => {
    let pool;
    let server;
    let baseUrl;
    let currentSession = {};

    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);

        // Buat tabel pengaturan jika belum ada di DB test
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pengaturan (
                kunci VARCHAR(50) PRIMARY KEY,
                nilai TEXT NULL
            ) ENGINE=InnoDB;
        `);

        // Express app untuk pengujian endpoint
        const app = express();
        app.use(express.urlencoded({ extended: true }));
        app.use(express.json());
        app.use(session({
            secret: 'test-secret-pengaturan-cbt',
            resave: false,
            saveUninitialized: false
        }));

        // Mock session injection
        app.use((req, res, next) => {
            Object.assign(req.session, currentSession);
            next();
        });

        // Middleware pengaturan seperti di app.js
        app.use(async (req, res, next) => {
            try {
                const settings = await pengaturanService.getPengaturan(pool);
                res.locals.appSettings = settings;
                res.locals.namaSekolah = settings.nama_sekolah || 'CBT Sekolah';
                res.locals.logoSekolah = (settings.logo_sekolah && settings.logo_sekolah.trim() !== '')
                    ? settings.logo_sekolah
                    : '/images/default-logo.svg';
                res.locals.isCustomLogo = Boolean(settings.logo_sekolah && settings.logo_sekolah.trim() !== '');
            } catch (_) {
                res.locals.appSettings = { nama_sekolah: 'CBT Sekolah', logo_sekolah: '' };
                res.locals.namaSekolah = 'CBT Sekolah';
                res.locals.logoSekolah = '/images/default-logo.svg';
                res.locals.isCustomLogo = false;
            }
            next();
        });

        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        app.use('/', require('../routes/index'));
        app.use('/admin', require('../routes/admin'));

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) await new Promise(r => server.close(r));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        pengaturanService.invalidateCache();
        await pool.query('TRUNCATE TABLE log_aktivitas_admin');
        await pool.query('TRUNCATE TABLE pengaturan');
        await pool.query("INSERT INTO pengaturan (kunci, nilai) VALUES ('nama_sekolah', 'CBT Sekolah'), ('logo_sekolah', '')");
        await pool.query('DELETE FROM admin WHERE id = 1');
        await pool.query("INSERT INTO admin (id, username, password) VALUES (1, 'test_admin', '$2b$10$abcdefghijklmnopqrstuu')");
        currentSession = {};
    });

    test('1. Pengaturan default menghasilkan nama "CBT Sekolah" dan logo default SVG', async () => {
        const settings = await pengaturanService.getPengaturan(pool);
        assert.equal(settings.nama_sekolah, 'CBT Sekolah');
        assert.equal(settings.logo_sekolah, '');

        // File default SVG harus ada di public/images/default-logo.svg
        const svgPath = path.join(__dirname, '..', 'public', 'images', 'default-logo.svg');
        assert.ok(fs.existsSync(svgPath), 'default-logo.svg harus ada di public/images/');
        const svgContent = fs.readFileSync(svgPath, 'utf8');
        assert.ok(svgContent.includes('<svg'), 'default-logo.svg harus berkas SVG valid');
    });

    test('2. Akses /admin/pengaturan tanpa login dialihkan ke /login-admin', async () => {
        currentSession = {};
        const res = await fetch(`${baseUrl}/admin/pengaturan`, { redirect: 'manual' });
        assert.equal(res.status, 302);
        assert.ok(res.headers.get('location').includes('/login-admin'));
    });

    test('3. Admin dapat mengakses halaman /admin/pengaturan dan melihat preview logo default', async () => {
        currentSession = { adminId: 1, adminNama: 'Admin Test' };
        const res = await fetch(`${baseUrl}/admin/pengaturan`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('Pengaturan Sekolah'));
        assert.ok(html.includes('Logo Default (SVG)'));
        assert.ok(html.includes('/images/default-logo.svg'));
    });

    test('4. Admin dapat memperbarui nama sekolah', async () => {
        currentSession = { adminId: 1, adminNama: 'Admin Test' };
        const params = new URLSearchParams();
        params.append('nama_sekolah', 'SMA Negeri 1 Prestasi');

        const res = await fetch(`${baseUrl}/admin/pengaturan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': baseUrl
            },
            body: params.toString(),
            redirect: 'manual'
        });

        assert.equal(res.status, 302);
        const updated = await pengaturanService.getPengaturan(pool);
        assert.equal(updated.nama_sekolah, 'SMA Negeri 1 Prestasi');

        // Log aktivitas admin harus tercatat
        const [logs] = await pool.query(
            "SELECT * FROM log_aktivitas_admin WHERE entitas = 'pengaturan' ORDER BY id DESC LIMIT 1"
        );
        assert.ok(logs.length > 0, 'Harus mencatat log aktivitas admin');
        assert.ok(logs[0].detail.includes('SMA Negeri 1 Prestasi'));
    });

    test('5. Admin dapat mengunggah logo kustom dan aplikasi berganti ke logo baru', async () => {
        currentSession = { adminId: 1, adminNama: 'Admin Test' };

        // Buat multipart form data secara manual
        const boundary = '----WebKitFormBoundaryTest123';
        const dummySvg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="10"/></svg>';

        let body = `--${boundary}\r\n`;
        body += 'Content-Disposition: form-data; name="nama_sekolah"\r\n\r\n';
        body += 'SMA Unggulan\r\n';
        body += `--${boundary}\r\n`;
        body += 'Content-Disposition: form-data; name="logo"; filename="custom-logo.svg"\r\n';
        body += 'Content-Type: image/svg+xml\r\n\r\n';
        body += dummySvg + '\r\n';
        body += `--${boundary}--\r\n`;

        const res = await fetch(`${baseUrl}/admin/pengaturan`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Origin': baseUrl
            },
            body: Buffer.from(body),
            redirect: 'manual'
        });

        assert.equal(res.status, 302);
        const updated = await pengaturanService.getPengaturan(pool);
        assert.equal(updated.nama_sekolah, 'SMA Unggulan');
        assert.ok(updated.logo_sekolah.startsWith('/uploads/logo-sekolah-'));

        // Cek file fisik logo di public/uploads/
        const uploadedFilePath = path.join(__dirname, '..', 'public', updated.logo_sekolah.replace(/^\//, ''));
        assert.ok(fs.existsSync(uploadedFilePath), 'File logo fisik harus ada di public/uploads/');

        // Cek halaman preview menampilkan logo kustom
        const pageRes = await fetch(`${baseUrl}/admin/pengaturan`);
        const html = await pageRes.text();
        assert.ok(html.includes('Logo Kustom Aktif'));
        assert.ok(html.includes(updated.logo_sekolah));

        // Bersihkan file uji
        try { fs.unlinkSync(uploadedFilePath); } catch (_) {}
    });

    test('6. Admin dapat mereset logo kustom kembali ke default (SVG)', async () => {
        currentSession = { adminId: 1, adminNama: 'Admin Test' };

        // Simpan logo kustom pura-pura
        const testFile = path.join(__dirname, '..', 'public', 'uploads', 'logo-sekolah-test-reset.svg');
        fs.writeFileSync(testFile, '<svg></svg>');
        await pool.query("UPDATE pengaturan SET nilai = '/uploads/logo-sekolah-test-reset.svg' WHERE kunci = 'logo_sekolah'");
        pengaturanService.invalidateCache();

        const res = await fetch(`${baseUrl}/admin/pengaturan/reset-logo`, {
            method: 'POST',
            headers: {
                'Origin': baseUrl
            },
            redirect: 'manual'
        });

        assert.equal(res.status, 302);
        const updated = await pengaturanService.getPengaturan(pool);
        assert.equal(updated.logo_sekolah, '');
        assert.equal(fs.existsSync(testFile), false, 'File logo kustom lama harus dihapus dari disk');
    });
});
