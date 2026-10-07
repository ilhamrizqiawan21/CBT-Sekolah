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
            `SELECT u.id, k.nama_kelas
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

        // ── Cek apakah sudah pernah mengerjakan ujian ini ──
        const [nilai] = await pool.query(
            `SELECT id FROM nilai_ujian
             WHERE siswa_id = ? AND ujian_id = ?`,
            [siswaData.id, ujian_id]
        );
        if (nilai.length > 0) {
            return res.render('login', { error: 'Anda sudah mengerjakan ujian ini sebelumnya!' });
        }

        // ── Cek sesi aktif ──
        const [sesi] = await pool.query(
            `SELECT id, status FROM sesi_ujian
             WHERE siswa_id = ? AND ujian_id = ?`,
            [siswaData.id, ujian_id]
        );

        if (sesi.length > 0) {
            if (sesi[0].status === 'sedang_ujian') {
                return res.render('login', {
                    error: 'Anda sedang dalam sesi ujian aktif. Hubungi pengawas jika ini kesalahan.'
                });
            }
            if (sesi[0].status === 'keluar_paksa') {
                return res.render('login', {
                    error: 'Akses ujian Anda telah dicabut karena pelanggaran. Hubungi pengawas.'
                });
            }
        }

        // ── Simpan session ──
        req.session.siswaId   = siswaData.id;
        req.session.siswaNama = siswaData.nama;
        req.session.ujianId   = parseInt(ujian_id);
        req.session.siswaNis  = siswaData.nis;

        req.session.save(err => {
            if (err) logger.error(`Session save error: ${err.message}`);
            res.redirect('/ujian');
        });

    } catch (err) {
        logger.error(`loginSiswa error: ${err.message}`, { stack: err.stack });
        res.render('login', { error: 'Terjadi kesalahan server' });
    }
};