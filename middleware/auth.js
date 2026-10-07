// middleware/auth.js
const pool = require('../models/db');
const logger = require('../utils/logger');

module.exports = {
    isAdmin: (req, res, next) => {
        if (req.session && req.session.adminId) return next();
        res.redirect('/login-admin');
    },
    isGuru: (req, res, next) => {
        if (req.session && req.session.guruId) return next();
        res.redirect('/login-guru');
    },
    isSiswa: (req, res, next) => {
        if (req.session && req.session.siswaId) return next();
        res.redirect('/login');
    },
    // Middleware untuk API Siswa (validasi session & deteksi take-over perangkat)
    isSiswaAPI: async (req, res, next) => {
        if (!req.session || !req.session.siswaId || !req.session.ujianId) {
            return res.status(401).json({ error: 'Unauthorized, silakan login ulang' });
        }
        try {
            const [rows] = await pool.query(
                'SELECT device_token, status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
                [req.session.siswaId, req.session.ujianId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
            }

            if (rows[0].status === 'keluar_paksa') {
                return res.status(403).json({ error: 'Akses ujian telah dicabut karena pelanggaran' });
            }

            if (rows[0].status === 'selesai') {
                return res.status(403).json({ error: 'Ujian sudah selesai' });
            }

            // Validasi device_token: bandingkan token klien/sesi dengan token aktif di database
            const clientToken = req.headers['x-device-token'] || req.body?.device_token || req.session.deviceToken;
            if (rows[0].device_token && clientToken && rows[0].device_token !== clientToken) {
                return res.status(409).json({
                    error: 'Sesi telah diambil alih di perangkat lain',
                    code: 409
                });
            }

            next();
        } catch (err) {
            logger.error(`isSiswaAPI error: ${err.message}`);
            res.status(500).json({ error: 'Terjadi kesalahan server' });
        }
    }
};