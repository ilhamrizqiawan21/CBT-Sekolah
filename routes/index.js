const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const authController = require('../controllers/authController');

// Halaman login
router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

router.post('/login-siswa', authController.loginSiswa);
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

        res.render('ujian', {
            siswa: {
                id: req.session.siswaId,
                nama: req.session.siswaNama,
                nis: req.session.siswaNis || req.session.siswaId
            },
            ujianId: req.session.ujianId,
            ujian: ujian
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

router.post('/login-admin', async (req, res) => {
    const { username, password } = req.body;
    const pool = require('../models/db');
    const bcrypt = require('bcrypt');
    const [admin] = await pool.query('SELECT * FROM admin WHERE username = ?', [username]);
    if (admin.length === 0) {
        return res.render('login-admin', { error: 'Username salah' });
    }
    const match = await bcrypt.compare(password, admin[0].password);
    if (!match) {
        return res.render('login-admin', { error: 'Password salah' });
    }
    req.session.adminId = admin[0].id;
    req.session.adminNama = admin[0].nama;
    res.redirect('/admin/dashboard');
});

router.get('/logout-admin', (req, res) => {
    req.session.destroy();
    res.redirect('/login-admin');
});

// Login Guru
router.get('/login-guru', (req, res) => {
    res.render('login-guru', { error: null });
});

router.post('/login-guru', async (req, res) => {
    const { username, password } = req.body;
    const pool = require('../models/db');
    const bcrypt = require('bcrypt');

    try {
        const [guru] = await pool.query('SELECT * FROM guru WHERE username = ?', [username]);
        if (guru.length === 0) {
            return res.render('login-guru', { error: 'Username tidak ditemukan' });
        }
        const match = await bcrypt.compare(password, guru[0].password);
        if (!match) {
            return res.render('login-guru', { error: 'Password salah' });
        }
        req.session.guruId = guru[0].id;
        req.session.guruNama = guru[0].nama;
        res.redirect('/guru/dashboard');
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