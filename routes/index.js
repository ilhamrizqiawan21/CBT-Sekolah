const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authController = require('../controllers/authController');
const { regenerateSession } = require('../utils/helper');
const {
    loginSiswaIpLimiter,
    loginSiswaNisLimiter,
    loginAdminLimiter,
    loginGuruLimiter
} = require('../middleware/rateLimiter');

// Landing page: pilih peran; pengguna yang sudah login langsung ke halamannya
router.get('/', (req, res) => {
    const sess = req.session || {};
    if (sess.adminId) return res.redirect('/admin/dashboard');
    if (sess.guruId) return res.redirect('/guru/dashboard');
    if (sess.siswaId && sess.ujianId) return res.redirect('/ujian');
    res.render('landing');
});

// Halaman login
router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

router.post('/login-siswa', loginSiswaIpLimiter, loginSiswaNisLimiter, authController.loginSiswa);
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Halaman ujian (setelah login)
router.get('/ujian', async (req, res) => {
    if (!req.session.siswaId || !req.session.ujianId) {
        return res.redirect('/login');
    }
    try {
        const pool = require('../models/db');

        // Gunakan DATE_FORMAT langsung, tanpa CONVERT_TZ
        // Asumsi: MySQL sudah diset time_zone = '+07:00'
        const [ujianData] = await pool.query(`
            SELECT u.nama_ujian,
                   DATE_FORMAT(u.tanggal_mulai, '%d/%m/%Y %H:%i') AS tanggal_mulai,
                   mp.nama_mapel
            FROM ujian u
            JOIN pengajaran pg ON u.pengajaran_id = pg.id
            JOIN mata_pelajaran mp ON pg.mapel_id = mp.id
            WHERE u.id = ?
        `, [req.session.ujianId]);

        const ujian = ujianData[0] || {};
        const deviceType = req.session.deviceType || 'laptop';

        res.render('ujian', {
            siswa: {
                id: req.session.siswaId,
                nama: req.session.siswaNama,
                nis: req.session.siswaNis || req.session.siswaId
            },
            ujianId: req.session.ujianId,
            ujian: ujian,
            deviceType: deviceType
        });
    } catch (err) {
        console.error(err);
        res.redirect('/login');
    }
});

// Login Admin
router.get('/login-admin', (req, res) => {
    res.render('login-admin', { error: null });
});

router.post('/login-admin', loginAdminLimiter, async (req, res) => {
    const { username, password } = req.body;
    const pool = require('../models/db');
    const bcrypt = require('bcrypt');

    try {
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            return res.render('login-admin', { error: 'Username atau password salah' });
        }
        const [admin] = await pool.query('SELECT * FROM admin WHERE username = ?', [username]);
        // Pesan sama untuk username/password salah agar akun tidak bisa ditebak
        const match = admin.length > 0 && await bcrypt.compare(String(password), admin[0].password);
        if (!match) {
            return res.render('login-admin', { error: 'Username atau password salah' });
        }
        await regenerateSession(req);
        req.session.adminId = admin[0].id;
        req.session.adminNama = admin[0].nama || admin[0].username;
        req.session.save(() => res.redirect('/admin/dashboard'));
    } catch (err) {
        console.error(err);
        res.render('login-admin', { error: 'Terjadi kesalahan server' });
    }
});

router.get('/logout-admin', (req, res) => {
    req.session.destroy();
    res.redirect('/login-admin');
});

// Login Guru
router.get('/login-guru', (req, res) => {
    res.render('login-guru', { error: null });
});

router.post('/login-guru', loginGuruLimiter, async (req, res) => {
    const { username, password } = req.body;
    const pool = require('../models/db');
    const bcrypt = require('bcrypt');

    try {
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            return res.render('login-guru', { error: 'Username atau password salah' });
        }
        const [guru] = await pool.query('SELECT * FROM guru WHERE username = ?', [username]);
        const match = guru.length > 0 && await bcrypt.compare(String(password), guru[0].password);
        if (!match) {
            return res.render('login-guru', { error: 'Username atau password salah' });
        }
        await regenerateSession(req);
        req.session.guruId = guru[0].id;
        req.session.guruNama = guru[0].nama;
        req.session.save(() => res.redirect('/guru/dashboard'));
    } catch (err) {
        console.error(err);
        res.render('login-guru', { error: 'Terjadi kesalahan server' });
    }
});

router.get('/logout-guru', (req, res) => {
    req.session.destroy();
    res.redirect('/login-guru');
});

module.exports = router;