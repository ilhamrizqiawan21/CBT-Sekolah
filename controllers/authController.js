const pool = require('../models/db');
const bcrypt = require('bcrypt');
const logger = require('../utils/logger');

exports.loginSiswa = async (req, res) => {
    const { nis, pin, ujian_id } = req.body;

    if (!nis || !pin || !ujian_id) {
        return res.render('login', { error: 'NIS, PIN, dan Ujian harus diisi' });
    }

    // Sanitasi dasar: ujian_id harus angka
    if (isNaN(parseInt(ujian_id))) {
        return res.render('login', { error: 'Ujian tidak valid' });
    }

    try {
        // ── Cek siswa berdasarkan NIS ──
        const [siswa] = await pool.query(
            `SELECT id, nama, nis, kelas, pin_ujian
             FROM siswa
             WHERE nis = ?`,
            [nis]
        );
        if (siswa.length === 0) {
            return res.render('login', { error: 'NIS atau PIN salah' });
        }
        const siswaData = siswa[0];

        // ── Verifikasi PIN dengan bcrypt ──
        const pinMatch = await bcrypt.compare(pin, siswaData.pin_ujian);
        if (!pinMatch) {
            return res.render('login', { error: 'NIS atau PIN salah' });
        }

        // ── Validasi kelas siswa = kelas pengajaran ujian (join ujian → pengajaran → kelas) ──
        const [ujianRows] = await pool.query(
            `SELECT u.id, u.token_ujian, k.nama_kelas
             FROM ujian u
             JOIN pengajaran p ON u.pengajaran_id = p.id
             JOIN kelas k ON p.kelas_id = k.id
             WHERE u.id = ? AND u.tanggal_mulai <= NOW() AND u.tanggal_selesai >= NOW()`,
            [ujian_id]
        );
        if (ujianRows.length === 0) {
            return res.render('login', { error: 'Ujian tidak tersedia atau belum dimulai/sudah berakhir' });
        }

        if (siswaData.kelas !== ujianRows[0].nama_kelas) {
            return res.render('login', { error: 'Ujian ini tidak diperuntukkan bagi kelas Anda' });
        }

        // ── Validasi Token Ujian jika diset (DESIGN §3.1, §3.7, T5.3) ──
        const requiredToken = ujianRows[0].token_ujian ? ujianRows[0].token_ujian.trim() : null;
        if (requiredToken && requiredToken !== '') {
            const inputToken = (req.body.token_ujian || '').trim();
            if (!inputToken) {
                return res.render('login', { error: 'Token ujian wajib diisi untuk ujian ini' });
            }
            if (inputToken.toUpperCase() !== requiredToken.toUpperCase()) {
                return res.render('login', { error: 'Token ujian salah. Silakan minta token yang benar ke pengawas' });
            }
        }

        // ── Cek apakah sudah pernah mengerjakan ujian ini ──
        const [nilai] = await pool.query(
            `SELECT id FROM nilai_ujian
             WHERE siswa_id = ? AND ujian_id = ?`,
            [siswaData.id, ujian_id]
        );
        if (nilai.length > 0) {
            return res.render('login', { error: 'Anda sudah mengerjakan ujian ini sebelumnya!' });
        }

        // ── Ambil atau buat sesi ujian (Take-over jika sedang aktif, DESIGN §3.1, §3.7) ──
        const sesiService = require('../services/sesiService');
        const rawDevice = (req.body.device_type || '').trim().toLowerCase();
        const deviceType = (rawDevice === 'hp' || rawDevice === 'laptop') ? rawDevice : 'laptop';
        const hasilSesi = await sesiService.mulaiAtauLanjut(siswaData.id, parseInt(ujian_id), deviceType, pool);

        if (hasilSesi.status === 'keluar_paksa') {
            return res.render('login', {
                error: hasilSesi.message || 'Akses ujian Anda telah dicabut karena pelanggaran. Hubungi pengawas.'
            });
        }
        if (hasilSesi.status === 'selesai') {
            return res.render('login', {
                error: hasilSesi.message || 'Anda sudah menyelesaikan ujian ini.'
            });
        }

        // Jika sesi diambil alih (take-over), catat ke log_kecurangan
        if (hasilSesi.status === 'lanjut' && hasilSesi.takeOver) {
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
                 VALUES (?, ?, 'ambil_alih_sesi', ?)`,
                [siswaData.id, parseInt(ujian_id), deviceType]
            );
            logger.info(`Sesi siswa NIS ${siswaData.nis} untuk ujian ID ${ujian_id} diambil alih (${deviceType})`);
        }

        // ── Simpan session ──
        req.session.siswaId     = siswaData.id;
        req.session.siswaNama   = siswaData.nama;
        req.session.ujianId     = parseInt(ujian_id);
        req.session.siswaNis    = siswaData.nis;
        req.session.deviceToken = hasilSesi.sesi.device_token;
        req.session.deviceType  = deviceType;

        req.session.save(err => {
            if (err) logger.error(`Session save error: ${err.message}`);
            res.redirect('/ujian');
        });

    } catch (err) {
        logger.error(`loginSiswa error: ${err.message}`, { stack: err.stack });
        res.render('login', { error: 'Terjadi kesalahan server' });
    }
};