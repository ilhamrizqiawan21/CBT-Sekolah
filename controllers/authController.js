const pool = require('../models/db');

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
        // ── Cek siswa ──
        // FIX: Tidak lagi SELECT * — hanya ambil kolom yang dibutuhkan
        const [siswa] = await pool.query(
            `SELECT id, nama, nis, kelas
             FROM siswa
             WHERE nis = ? AND pin_ujian = ?`,
            [nis, pin]
        );
        if (siswa.length === 0) {
            return res.render('login', { error: 'NIS atau PIN salah' });
        }
        const siswaData = siswa[0];

        // ── Cek apakah sudah pernah mengerjakan ujian ini ──
        const [nilai] = await pool.query(
            `SELECT id FROM nilai_ujian
             WHERE siswa_id = ? AND ujian_id = ?`,
            [siswaData.id, ujian_id]
        );
        if (nilai.length > 0) {
            return res.render('login', { error: 'Anda sudah mengerjakan ujian ini sebelumnya!' });
        }

        // ── FIX #12 — Cek sesi aktif (sekarang benar-benar terisi oleh app.js) ──
        // Cegah login ganda dari dua perangkat berbeda
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
            // status = 'selesai' → sudah tercakup oleh cek nilai_ujian di atas
        }

        // ── Cek validitas waktu ujian ──
        const [ujian] = await pool.query(
            `SELECT id FROM ujian
             WHERE id = ? AND tanggal_mulai <= NOW() AND tanggal_selesai >= NOW()`,
            [ujian_id]
        );
        if (ujian.length === 0) {
            return res.render('login', { error: 'Ujian tidak tersedia atau belum dimulai/sudah berakhir' });
        }

        // ── Simpan session ──
        req.session.siswaId   = siswaData.id;
        req.session.siswaNama = siswaData.nama;
        req.session.ujianId   = parseInt(ujian_id); // pastikan integer, bukan string
        req.session.siswaNis  = siswaData.nis;

        req.session.save(err => {
            if (err) console.error('Session save error:', err);
            res.redirect('/ujian');
        });

    } catch (err) {
        console.error('loginSiswa error:', err);
        res.render('login', { error: 'Terjadi kesalahan server' });
    }
};