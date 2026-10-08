const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { isGuru } = require('../middleware/auth');

router.use(isGuru);

// ==================== DASHBOARD GURU ====================
router.get('/dashboard', async (req, res) => {
    const guruId = req.session.guruId;
    const guruNama = req.session.guruNama;

    const [pengajaran] = await pool.query(`
        SELECT pg.id, mp.nama_mapel, k.nama_kelas, mp.id as mapel_id
        FROM pengajaran pg 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
    `, [guruId]);

    const mapelIds = pengajaran.map(p => p.mapel_id);
    
    if (mapelIds.length === 0) {
        return res.render('guru/dashboard', { 
            session: req.session,
            pengajaran,
            totalUjian: 0,
            totalSoal: 0,
            totalSiswaUjian: 0,
            ujianTerbaru: [],
            logTerbaru: [],
            rataRataNilai: 0
        });
    }

    const [statUjian] = await pool.query(`
        SELECT COUNT(*) as total 
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE pg.guru_id = ?
    `, [guruId]);
    const totalUjian = statUjian[0].total;

    const [statSoal] = await pool.query(`
        SELECT COUNT(*) as total 
        FROM soal s 
        JOIN ujian u ON s.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE pg.guru_id = ?
    `, [guruId]);
    const totalSoal = statSoal[0].total;

    const [statSiswa] = await pool.query(`
        SELECT COUNT(DISTINCT n.siswa_id) as total 
        FROM nilai_ujian n 
        JOIN ujian u ON n.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE pg.guru_id = ?
    `, [guruId]);
    const totalSiswaUjian = statSiswa[0].total;

    const [statNilai] = await pool.query(`
        SELECT AVG(n.nilai) as rata 
        FROM nilai_ujian n 
        JOIN ujian u ON n.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE pg.guru_id = ?
    `, [guruId]);
    const rataRataNilai = Math.round(statNilai[0].rata || 0);

    const [ujianTerbaru] = await pool.query(`
        SELECT u.id, u.nama_ujian, u.tanggal_mulai, u.tanggal_selesai, 
               mp.nama_mapel, k.nama_kelas,
               (SELECT COUNT(*) FROM nilai_ujian WHERE ujian_id = u.id) as jumlah_peserta,
               (SELECT AVG(nilai) FROM nilai_ujian WHERE ujian_id = u.id) as rata_nilai
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY u.tanggal_mulai DESC 
        LIMIT 5
    `, [guruId]);

    const [logTerbaru] = await pool.query(`
        SELECT l.*, s.nama as siswa_nama, s.nis, u.nama_ujian 
        FROM log_kecurangan l
        JOIN siswa s ON l.siswa_id = s.id
        JOIN ujian u ON l.ujian_id = u.id
        JOIN pengajaran pg ON u.pengajaran_id = pg.id
        WHERE pg.guru_id = ?
        ORDER BY l.timestamp DESC
        LIMIT 5
    `, [guruId]);

    res.render('guru/dashboard', {
        session: req.session,
        pengajaran,
        totalUjian,
        totalSoal,
        totalSiswaUjian,
        ujianTerbaru,
        logTerbaru,
        rataRataNilai
    });
});

// ==================== KELOLA SOAL (GURU) ====================
router.get('/kelola-soal', async (req, res) => {
    const guruId = req.session.guruId;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const filterUjian = req.query.ujian || '';

    const [ujianList] = await pool.query(`
        SELECT DISTINCT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY u.tanggal_mulai DESC
    `, [guruId]);

    let baseQuery = `
        FROM soal s 
        JOIN ujian u ON s.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE pg.guru_id = ?
    `;
    let params = [guruId];

    if (filterUjian) {
        baseQuery += ` AND s.ujian_id = ?`;
        params.push(filterUjian);
    }

    const [totalResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = totalResult[0].total;
    const totalPages = Math.ceil(total / limit);

const [soal] = await pool.query(`
    SELECT s.*, u.nama_ujian
    ${baseQuery}
    ORDER BY s.id DESC
    LIMIT ? OFFSET ?
`, [...params, limit, offset]);

    res.render('guru/kelola_soal', {
        soal,
        ujianList,
        filterUjian,
        currentPage: page,
        totalPages,
        total,
        msg: req.query.msg,
        error: req.query.error
    });
});

// Halaman tambah soal (batch)
router.get('/kelola-soal/tambah-batch', async (req, res) => {
    const guruId = req.session.guruId;
    const [ujianList] = await pool.query(`
        SELECT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY mp.nama_mapel, k.nama_kelas
    `, [guruId]);
    res.render('guru/soal_tambah_batch', { ujianList });
});

// API: Ambil ujian berdasarkan guru
router.get('/api/ujian-by-guru', async (req, res) => {
    const guruId = req.session.guruId;
    const [ujian] = await pool.query(`
        SELECT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY mp.nama_mapel
    `, [guruId]);
    res.json(ujian);
});

// Batch tambah soal (POST)
router.post('/soal/batch-tambah', async (req, res) => {
    const { ujian_id, soal_pg, soal_menjodohkan, soal_essay, pengecoh } = req.body;
    if (!ujian_id) return res.status(400).json({ success: false, error: 'Ujian tidak dipilih' });
    
    let totalInserted = 0;
    try {
        for (const soal of soal_pg) {
            if (!soal.teks_soal) continue;
            await pool.query(
                `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar) 
                 VALUES (?, 'pg', ?, ?, ?, ?, ?, ?, ?)`,
                [ujian_id, soal.teks_soal, soal.poin || 1, soal.pilihan_a || '', soal.pilihan_b || '', soal.pilihan_c || '', soal.pilihan_d || '', soal.jawaban_benar || '']
            );
            totalInserted++;
        }
        
        if (soal_menjodohkan.length > 0) {
            const pasangan = soal_menjodohkan.map(s => ({ kiri: s.pasangan.kiri, kanan: s.pasangan.kanan }));
            const jawabanJSON = JSON.stringify(pasangan);
            const opsiJSON = JSON.stringify({ pasangan, pengecoh: pengecoh || [] });
            const teksGabungan = soal_menjodohkan.map((s, i) => `${i+1}. ${s.teks_soal}`).join('\n');
            const totalPoin = soal_menjodohkan.reduce((sum, s) => sum + (s.poin || 2), 0);
            await pool.query(
                `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) 
                 VALUES (?, 'menjodohkan', ?, ?, ?, ?)`,
                [ujian_id, teksGabungan, totalPoin, jawabanJSON, opsiJSON]
            );
            totalInserted++;
        }
        
        for (const soal of soal_essay) {
            if (!soal.teks_soal) continue;
            await pool.query(
                `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) 
                 VALUES (?, 'essay', ?, ?, ?, ?)`,
                [ujian_id, soal.teks_soal, soal.poin || 4, '[]', '{}']
            );
            totalInserted++;
        }
        
        res.json({ success: true, total: totalInserted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Halaman edit soal
router.get('/soal/edit/:id', async (req, res) => {
    const guruId = req.session.guruId;
    const [soal] = await pool.query(`
        SELECT s.*, u.pengajaran_id 
        FROM soal s 
        JOIN ujian u ON s.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE s.id = ? AND pg.guru_id = ?
    `, [req.params.id, guruId]);
    if (soal.length === 0) return res.redirect('/guru/kelola-soal?error=Soal tidak ditemukan');
    
    const [ujianList] = await pool.query(`
        SELECT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
    `, [guruId]);
    res.render('guru/soal_edit', { soal: soal[0], ujianList });
});

// Proses edit soal
router.post('/soal/edit/:id', async (req, res) => {
    const { ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar, opsi_tambahan } = req.body;
    try {
        if (tipe_soal === 'pg') {
            await pool.query(
                `UPDATE soal SET ujian_id=?, tipe_soal=?, teks_soal=?, poin=?, pilihan_a=?, pilihan_b=?, pilihan_c=?, pilihan_d=?, jawaban_benar=? WHERE id=?`,
                [ujian_id, tipe_soal, teks_soal, poin || 1, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar, req.params.id]
            );
        } else {
            await pool.query(
                `UPDATE soal SET ujian_id=?, tipe_soal=?, teks_soal=?, poin=?, jawaban_benar=?, opsi_tambahan=? WHERE id=?`,
                [ujian_id, tipe_soal, teks_soal, poin || 1, jawaban_benar, opsi_tambahan, req.params.id]
            );
        }
        res.redirect('/guru/kelola-soal?msg=Soal berhasil diupdate');
    } catch (err) {
        console.error(err);
        res.redirect(`/guru/kelola-soal?error=Gagal update soal`);
    }
});

// Hapus soal
router.get('/soal/hapus/:id', async (req, res) => {
    const guruId = req.session.guruId;
    try {
        const [soal] = await pool.query(`
            SELECT s.id FROM soal s 
            JOIN ujian u ON s.ujian_id = u.id 
            JOIN pengajaran pg ON u.pengajaran_id = pg.id 
            WHERE s.id = ? AND pg.guru_id = ?
        `, [req.params.id, guruId]);
        if (soal.length === 0) return res.redirect('/guru/kelola-soal?error=Soal tidak ditemukan');
        
        await pool.query('DELETE FROM soal WHERE id = ?', [req.params.id]);
        res.redirect('/guru/kelola-soal?msg=Soal berhasil dihapus');
    } catch (err) {
        console.error(err);
        res.redirect('/guru/kelola-soal?error=Gagal hapus soal');
    }
});

// Detail soal per ujian (API)
router.get('/api/soal/:ujianId', async (req, res) => {
    const [soal] = await pool.query('SELECT * FROM soal WHERE ujian_id = ?', [req.params.ujianId]);
    res.json(soal);
});

// ==================== HASIL SISWA (GURU) ====================
router.get('/hasil-siswa', async (req, res) => {
    const guruId = req.session.guruId;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const filterUjian = req.query.ujian || '';
    const filterKelas = req.query.kelas || '';

    // Ambil daftar ujian yang diajar oleh guru ini (untuk dropdown filter)
    const [ujianList] = await pool.query(`
        SELECT DISTINCT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY u.tanggal_mulai DESC
    `, [guruId]);

    // Ambil daftar kelas yang diajar (untuk dropdown filter)
    const [kelasList] = await pool.query(`
        SELECT DISTINCT k.id, k.nama_kelas
        FROM pengajaran pg 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY k.nama_kelas
    `, [guruId]);

    // Query dasar
    let baseQuery = `
        FROM nilai_ujian n 
        JOIN siswa s ON n.siswa_id = s.id 
        JOIN ujian u ON n.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
    `;
    let params = [guruId];

    if (filterUjian) {
        baseQuery += ` AND n.ujian_id = ?`;
        params.push(filterUjian);
    }
    if (filterKelas) {
        baseQuery += ` AND k.id = ?`;
        params.push(filterKelas);
    }

    // Hitung total data
    const [totalResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = totalResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Ambil data dengan pagination
    const [hasil] = await pool.query(`
        SELECT n.*, s.nama as siswa_nama, s.nis, s.kelas as nama_kelas, 
               u.nama_ujian, mp.nama_mapel, n.siswa_id, n.ujian_id 
        ${baseQuery}
        ORDER BY n.selesai_pada DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    // Statistik ringkas
    let statQuery = `
        SELECT 
            COUNT(*) as total_ujian_selesai,
            AVG(n.nilai) as rata_rata_nilai,
            MAX(n.nilai) as nilai_tertinggi,
            MIN(n.nilai) as nilai_terendah
        FROM nilai_ujian n 
        JOIN ujian u ON n.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        WHERE pg.guru_id = ?
    `;
    let statParams = [guruId];
    if (filterUjian) {
        statQuery += ` AND n.ujian_id = ?`;
        statParams.push(filterUjian);
    }
    const [statistik] = await pool.query(statQuery, statParams);

    res.render('guru/hasil_siswa', {
        hasil,
        ujianList,
        kelasList,
        filterUjian,
        filterKelas,
        currentPage: page,
        totalPages,
        total,
        statistik: statistik[0],
        msg: req.query.msg,
        error: req.query.error
    });
});

// Export hasil siswa ke Excel
router.get('/hasil-siswa/export', async (req, res) => {
    const guruId = req.session.guruId;
    const filterUjian = req.query.ujian || '';
    const filterKelas = req.query.kelas || '';

    let query = `
        SELECT s.nis, s.nama as siswa_nama, s.kelas, u.nama_ujian, 
               mp.nama_mapel, n.poin_otomatis, n.poin_essay, n.nilai, n.status_koreksi, 
               n.benar, n.salah, n.kosong, n.selesai_pada 
        FROM nilai_ujian n 
        JOIN siswa s ON n.siswa_id = s.id 
        JOIN ujian u ON n.ujian_id = u.id 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
    `;
    let params = [guruId];

    if (filterUjian) {
        query += ` AND n.ujian_id = ?`;
        params.push(filterUjian);
    }
    if (filterKelas) {
        query += ` AND k.id = ?`;
        params.push(filterKelas);
    }
    query += ` ORDER BY n.selesai_pada DESC`;

    const [hasil] = await pool.query(query, params);

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Hasil Ujian');

    worksheet.columns = [
        { header: 'NIS', key: 'nis', width: 15 },
        { header: 'Nama Siswa', key: 'siswa_nama', width: 30 },
        { header: 'Kelas', key: 'kelas', width: 15 },
        { header: 'Ujian', key: 'nama_ujian', width: 30 },
        { header: 'Mata Pelajaran', key: 'nama_mapel', width: 20 },
        { header: 'Poin PG+Menjodohkan', key: 'poin_otomatis', width: 22 },
        { header: 'Poin Essay', key: 'poin_essay', width: 15 },
        { header: 'Nilai Akhir', key: 'nilai', width: 12 },
        { header: 'Status Koreksi', key: 'status_koreksi', width: 18 },
        { header: 'Benar', key: 'benar', width: 10 },
        { header: 'Salah', key: 'salah', width: 10 },
        { header: 'Kosong', key: 'kosong', width: 10 },
        { header: 'Selesai Pada', key: 'selesai_pada', width: 20 }
    ];

    hasil.forEach(row => {
        worksheet.addRow({
            nis: row.nis,
            siswa_nama: row.siswa_nama,
            kelas: row.kelas,
            nama_ujian: row.nama_ujian,
            nama_mapel: row.nama_mapel,
            poin_otomatis: row.poin_otomatis ?? 0,
            poin_essay: row.poin_essay ?? 0,
            nilai: row.nilai ?? 0,
            status_koreksi: row.status_koreksi === 'menunggu_essay' ? 'Menunggu Essay' : (row.status_koreksi === 'selesai' ? 'Selesai' : (row.status_koreksi || '-')),
            benar: row.benar,
            salah: row.salah,
            kosong: row.kosong,
            selesai_pada: row.selesai_pada ? new Date(row.selesai_pada).toLocaleString() : '-'
        });
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1CC88A' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=hasil_ujian_guru.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// ==================== LOG KECURANGAN (GURU) ====================
router.get('/log-kecurangan', async (req, res) => {
    const guruId = req.session.guruId;
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const filterUjian = req.query.ujian || '';
    const filterSiswa = req.query.siswa || '';
    const filterJenis = req.query.jenis || '';

    // Ambil daftar ujian yang diajar oleh guru ini (untuk dropdown filter)
    const [ujianList] = await pool.query(`
        SELECT DISTINCT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        FROM ujian u 
        JOIN pengajaran pg ON u.pengajaran_id = pg.id 
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id 
        JOIN kelas k ON pg.kelas_id = k.id 
        WHERE pg.guru_id = ?
        ORDER BY u.tanggal_mulai DESC
    `, [guruId]);

    // Ambil daftar siswa yang pernah melakukan pelanggaran (untuk dropdown filter)
    const [siswaList] = await pool.query(`
        SELECT DISTINCT s.id, s.nis, s.nama
        FROM log_kecurangan l
        JOIN siswa s ON l.siswa_id = s.id
        JOIN ujian u ON l.ujian_id = u.id
        JOIN pengajaran pg ON u.pengajaran_id = pg.id
        WHERE pg.guru_id = ?
        ORDER BY s.nama
    `, [guruId]);

    // Query dasar
    let baseQuery = `
        FROM log_kecurangan l
        JOIN siswa s ON l.siswa_id = s.id
        JOIN ujian u ON l.ujian_id = u.id
        JOIN pengajaran pg ON u.pengajaran_id = pg.id
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id
        JOIN kelas k ON pg.kelas_id = k.id
        WHERE pg.guru_id = ?
    `;
    let params = [guruId];

    if (filterUjian) {
        baseQuery += ` AND l.ujian_id = ?`;
        params.push(filterUjian);
    }
    if (filterSiswa) {
        baseQuery += ` AND l.siswa_id = ?`;
        params.push(filterSiswa);
    }
    if (filterJenis) {
        baseQuery += ` AND l.jenis_kecurangan = ?`;
        params.push(filterJenis);
    }

    // Hitung total data
    const [totalResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = totalResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Ambil data dengan pagination
    const [logs] = await pool.query(`
        SELECT l.*, s.nama as siswa_nama, s.nis, u.nama_ujian, mp.nama_mapel, k.nama_kelas
        ${baseQuery}
        ORDER BY l.timestamp DESC
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    // Statistik ringkas
    const [statistik] = await pool.query(`
        SELECT 
            COUNT(*) as total_pelanggaran,
            COUNT(DISTINCT l.siswa_id) as total_siswa,
            SUM(CASE WHEN l.jenis_kecurangan = 'pindah_tab' THEN 1 ELSE 0 END) as pindah_tab,
            SUM(CASE WHEN l.jenis_kecurangan = 'copy_paste' THEN 1 ELSE 0 END) as copy_paste,
            SUM(CASE WHEN l.jenis_kecurangan = 'lainnya' THEN 1 ELSE 0 END) as lainnya
        FROM log_kecurangan l
        JOIN ujian u ON l.ujian_id = u.id
        JOIN pengajaran pg ON u.pengajaran_id = pg.id
        WHERE pg.guru_id = ?
    `, [guruId]);

    res.render('guru/log_kecurangan', {
        logs,
        ujianList,
        siswaList,
        filterUjian,
        filterSiswa,
        filterJenis,
        currentPage: page,
        totalPages,
        total,
        statistik: statistik[0],
        msg: req.query.msg,
        error: req.query.error
    });
});

// Export log kecurangan ke Excel
router.get('/log-kecurangan/export', async (req, res) => {
    const guruId = req.session.guruId;
    const filterUjian = req.query.ujian || '';
    const filterSiswa = req.query.siswa || '';
    const filterJenis = req.query.jenis || '';

    let query = `
        SELECT l.timestamp, s.nis, s.nama as siswa_nama, s.kelas, 
               u.nama_ujian, mp.nama_mapel, k.nama_kelas, l.jenis_kecurangan
        FROM log_kecurangan l
        JOIN siswa s ON l.siswa_id = s.id
        JOIN ujian u ON l.ujian_id = u.id
        JOIN pengajaran pg ON u.pengajaran_id = pg.id
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id
        JOIN kelas k ON pg.kelas_id = k.id
        WHERE pg.guru_id = ?
    `;
    let params = [guruId];

    if (filterUjian) {
        query += ` AND l.ujian_id = ?`;
        params.push(filterUjian);
    }
    if (filterSiswa) {
        query += ` AND l.siswa_id = ?`;
        params.push(filterSiswa);
    }
    if (filterJenis) {
        query += ` AND l.jenis_kecurangan = ?`;
        params.push(filterJenis);
    }
    query += ` ORDER BY l.timestamp DESC`;

    const [logs] = await pool.query(query, params);

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Log Kecurangan');

    worksheet.columns = [
        { header: 'Waktu', key: 'timestamp', width: 20 },
        { header: 'NIS', key: 'nis', width: 15 },
        { header: 'Siswa', key: 'siswa_nama', width: 30 },
        { header: 'Kelas', key: 'kelas', width: 15 },
        { header: 'Ujian', key: 'nama_ujian', width: 30 },
        { header: 'Mata Pelajaran', key: 'nama_mapel', width: 20 },
        { header: 'Jenis Kecurangan', key: 'jenis_kecurangan', width: 20 }
    ];

    logs.forEach(log => {
        worksheet.addRow({
            timestamp: new Date(log.timestamp).toLocaleString(),
            nis: log.nis,
            siswa_nama: log.siswa_nama,
            kelas: log.kelas,
            nama_ujian: log.nama_ujian,
            nama_mapel: log.nama_mapel,
            jenis_kecurangan: log.jenis_kecurangan.replace('_', ' ')
        });
    });

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC3545' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=log_kecurangan_guru.xlsx');
    await workbook.xlsx.write(res);
    res.end();
});

// ==================== PENILAIAN ESSAY (T3.5, DESIGN §3.5) ====================
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { hitungUlangNilai } = require('../services/finalizeService');

const uploadEssay = multer({
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.xlsx') {
            return cb(new Error('Hanya file Excel (.xlsx) yang diperbolehkan'));
        }
        cb(null, true);
    }
});

// Helper validasi guru pengampu
async function checkGuruPengampuUjian(ujianId, guruId) {
    const [rows] = await pool.query(`
        SELECT u.id, u.nama_ujian, pg.guru_id, mp.nama_mapel, k.nama_kelas
        FROM ujian u
        JOIN pengajaran pg ON u.pengajaran_id = pg.id
        JOIN mata_pelajaran mp ON pg.mapel_id = mp.id
        JOIN kelas k ON pg.kelas_id = k.id
        WHERE u.id = ?
    `, [ujianId]);
    if (rows.length === 0) return { exists: false };
    if (rows[0].guru_id !== guruId) return { exists: true, authorized: false, ujian: rows[0] };
    return { exists: true, authorized: true, ujian: rows[0] };
}

// Hanya sesi yang sudah selesai yang boleh dinilai essay-nya: menyimpan nilai
// tidak boleh menghentikan ujian siswa yang masih berjalan.
async function ambilPesertaSelesai(ujianId) {
    const [rows] = await pool.query(
        "SELECT siswa_id FROM sesi_ujian WHERE ujian_id = ? AND status = 'selesai'",
        [ujianId]
    );
    return new Set(rows.map(r => r.siswa_id));
}

// 1. Daftar Ujian dengan Soal Essay
router.get('/essay', async (req, res) => {
    const guruId = req.session.guruId;

    try {
        const [ujianList] = await pool.query(`
            SELECT u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas, u.tanggal_mulai, u.tanggal_selesai,
                   COUNT(DISTINCT s.id) as jumlah_essay,
                   COUNT(DISTINCT nu.siswa_id) as total_peserta,
                   SUM(CASE WHEN nu.status_koreksi = 'selesai' THEN 1 ELSE 0 END) as peserta_selesai,
                   SUM(CASE WHEN nu.status_koreksi = 'menunggu_essay' THEN 1 ELSE 0 END) as peserta_menunggu
            FROM ujian u
            JOIN pengajaran pg ON u.pengajaran_id = pg.id
            JOIN mata_pelajaran mp ON pg.mapel_id = mp.id
            JOIN kelas k ON pg.kelas_id = k.id
            JOIN soal s ON s.ujian_id = u.id AND s.tipe_soal = 'essay'
            LEFT JOIN nilai_ujian nu ON nu.ujian_id = u.id
            WHERE pg.guru_id = ?
            GROUP BY u.id, u.nama_ujian, mp.nama_mapel, k.nama_kelas, u.tanggal_mulai, u.tanggal_selesai
            ORDER BY u.tanggal_mulai DESC
        `, [guruId]);

        res.render('guru/essay_daftar', {
            ujianList,
            msg: req.query.msg,
            error: req.query.error
        });
    } catch (err) {
        console.error('Error GET /guru/essay:', err);
        res.status(500).send('Terjadi kesalahan saat memuat daftar penilaian essay');
    }
});

// 2. Form Matriks Penilaian Essay Siswa
router.get('/essay/:ujianId', async (req, res) => {
    const guruId = req.session.guruId;
    const ujianId = parseInt(req.params.ujianId);

    try {
        const authCheck = await checkGuruPengampuUjian(ujianId, guruId);
        if (!authCheck.exists) {
            return res.status(404).send('Ujian tidak ditemukan');
        }
        if (!authCheck.authorized) {
            return res.status(403).send('Akses ditolak: Anda bukan guru pengampu ujian ini');
        }

        const ujian = authCheck.ujian;

        // Ambil soal essay
        const [soalList] = await pool.query(`
            SELECT id, teks_soal, poin
            FROM soal
            WHERE ujian_id = ? AND tipe_soal = 'essay'
            ORDER BY id ASC
        `, [ujianId]);

        if (soalList.length === 0) {
            return res.redirect('/guru/essay?error=' + encodeURIComponent('Ujian ini tidak memiliki soal essay'));
        }

        // Ambil daftar siswa yang mengikuti ujian
        const [siswaList] = await pool.query(`
            SELECT s.id as siswa_id, s.nis, s.nama, s.kelas,
                   nu.poin_otomatis, nu.poin_essay, nu.poin_maks, nu.nilai,
                   COALESCE(nu.status_koreksi, 'menunggu_essay') as status_koreksi
            FROM siswa s
            JOIN sesi_ujian su ON su.siswa_id = s.id AND su.ujian_id = ? AND su.status = 'selesai'
            LEFT JOIN nilai_ujian nu ON nu.siswa_id = s.id AND nu.ujian_id = su.ujian_id
            ORDER BY s.nama ASC
        `, [ujianId]);

        // Ambil skor essay yang sudah ada
        const [essayRows] = await pool.query(`
            SELECT siswa_id, soal_id, skor
            FROM nilai_essay
            WHERE ujian_id = ?
        `, [ujianId]);

        const skorMap = {};
        for (const row of essayRows) {
            if (!skorMap[row.siswa_id]) skorMap[row.siswa_id] = {};
            skorMap[row.siswa_id][row.soal_id] = row.skor;
        }

        res.render('guru/essay_penilaian', {
            ujian,
            soalList,
            siswaList,
            skorMap,
            msg: req.query.msg,
            error: req.query.error
        });
    } catch (err) {
        console.error('Error GET /guru/essay/:ujianId:', err);
        res.status(500).send('Terjadi kesalahan saat memuat form penilaian essay');
    }
});

// 3. Simpan Nilai Essay & Hitung Ulang Nilai Akhir
router.post('/essay/:ujianId', async (req, res) => {
    const guruId = req.session.guruId;
    const ujianId = parseInt(req.params.ujianId);

    try {
        const authCheck = await checkGuruPengampuUjian(ujianId, guruId);
        if (!authCheck.exists) {
            return res.status(404).send('Ujian tidak ditemukan');
        }
        if (!authCheck.authorized) {
            return res.status(403).send('Akses ditolak: Anda bukan guru pengampu ujian ini');
        }

        // Ambil soal essay dan validasi poin maksimal
        const [soalList] = await pool.query(`
            SELECT id, poin
            FROM soal
            WHERE ujian_id = ? AND tipe_soal = 'essay'
        `, [ujianId]);

        const maxPoinMap = new Map();
        soalList.forEach(s => maxPoinMap.set(s.id, s.poin));

        const skorInput = req.body.skor || {};
        const parsedSkor = {}; // { [siswaId]: { [soalId]: val } }

        if (typeof skorInput === 'object' && skorInput !== null) {
            for (const sKey of Object.keys(skorInput)) {
                const sId = parseInt(String(sKey).replace(/\D/g, ''));
                if (isNaN(sId)) continue;
                const studentScores = skorInput[sKey] || {};
                parsedSkor[sId] = parsedSkor[sId] || {};

                for (const qKey of Object.keys(studentScores)) {
                    const qId = parseInt(String(qKey).replace(/\D/g, ''));
                    if (isNaN(qId)) continue;
                    parsedSkor[sId][qId] = studentScores[qKey];
                }
            }
        }

        const siswaIds = Object.keys(parsedSkor);

        // Hanya peserta yang sesinya sudah selesai yang boleh dinilai
        const pesertaSelesai = await ambilPesertaSelesai(ujianId);
        for (const sIdStr of siswaIds) {
            if (!pesertaSelesai.has(parseInt(sIdStr))) {
                return res.status(400).send(`Siswa ID ${sIdStr} bukan peserta ujian ini atau ujiannya belum selesai`);
            }
        }

        // Validasi seluruh input skor sebelum menyimpan
        for (const sIdStr of siswaIds) {
            const studentScores = parsedSkor[sIdStr] || {};
            for (const soalIdStr of Object.keys(studentScores)) {
                const soalId = parseInt(soalIdStr);
                const rawVal = studentScores[soalIdStr];
                if (rawVal === '' || rawVal === null || rawVal === undefined) continue;

                const val = Number(rawVal);
                const maxPoin = maxPoinMap.get(soalId);
                if (maxPoin === undefined) {
                    return res.status(400).send(`Soal ID ${soalId} bukan bagian dari ujian ini`);
                }
                if (isNaN(val) || !Number.isInteger(val) || val < 0 || val > maxPoin) {
                    return res.status(400).send(`Skor tidak valid untuk soal #${soalId}: Skor (${rawVal}) harus berupa bilangan bulat antara 0 dan ${maxPoin}`);
                }
            }
        }

        // Simpan nilai essay dan hitung ulang
        for (const sIdStr of siswaIds) {
            const siswaId = parseInt(sIdStr);
            const studentScores = parsedSkor[sIdStr] || {};

            for (const soalIdStr of Object.keys(studentScores)) {
                const soalId = parseInt(soalIdStr);
                const rawVal = studentScores[soalIdStr];
                if (rawVal === '' || rawVal === null || rawVal === undefined) continue;

                const val = parseInt(rawVal);
                await pool.query(`
                    INSERT INTO nilai_essay (siswa_id, ujian_id, soal_id, skor, dinilai_oleh, dinilai_pada)
                    VALUES (?, ?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                      skor = VALUES(skor),
                      dinilai_oleh = VALUES(dinilai_oleh),
                      dinilai_pada = NOW()
                `, [siswaId, ujianId, soalId, val, guruId]);
            }

            // Hitung ulang nilai akhir siswa
            await hitungUlangNilai(siswaId, ujianId, pool);
        }

        res.redirect(`/guru/essay/${ujianId}?msg=` + encodeURIComponent('Nilai essay berhasil disimpan dan nilai akhir telah dihitung ulang'));
    } catch (err) {
        console.error('Error POST /guru/essay/:ujianId:', err);
        res.status(500).send('Terjadi kesalahan saat menyimpan nilai essay: ' + err.message);
    }
});

// 4. Ekspor Template Nilai Essay ke Excel
router.get('/essay/:ujianId/export', async (req, res) => {
    const guruId = req.session.guruId;
    const ujianId = parseInt(req.params.ujianId);

    try {
        const authCheck = await checkGuruPengampuUjian(ujianId, guruId);
        if (!authCheck.exists) {
            return res.status(404).send('Ujian tidak ditemukan');
        }
        if (!authCheck.authorized) {
            return res.status(403).send('Akses ditolak: Anda bukan guru pengampu ujian ini');
        }

        const ujian = authCheck.ujian;

        const [soalList] = await pool.query(`
            SELECT id, teks_soal, poin
            FROM soal
            WHERE ujian_id = ? AND tipe_soal = 'essay'
            ORDER BY id ASC
        `, [ujianId]);

        const [siswaList] = await pool.query(`
            SELECT s.id as siswa_id, s.nis, s.nama, s.kelas
            FROM siswa s
            JOIN sesi_ujian su ON su.siswa_id = s.id AND su.ujian_id = ? AND su.status = 'selesai'
            ORDER BY s.nama ASC
        `, [ujianId]);

        const [essayRows] = await pool.query(`
            SELECT siswa_id, soal_id, skor
            FROM nilai_essay
            WHERE ujian_id = ?
        `, [ujianId]);

        const skorMap = {};
        for (const row of essayRows) {
            if (!skorMap[row.siswa_id]) skorMap[row.siswa_id] = {};
            skorMap[row.siswa_id][row.soal_id] = row.skor;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Nilai Essay');

        const columns = [
            { header: 'ID Siswa', key: 'siswa_id', width: 12 },
            { header: 'NIS', key: 'nis', width: 15 },
            { header: 'Nama Siswa', key: 'nama', width: 30 },
            { header: 'Kelas', key: 'kelas', width: 15 }
        ];

        soalList.forEach((s, idx) => {
            columns.push({
                header: `Soal #${idx + 1} [ID:${s.id}] (Maks: ${s.poin})`,
                key: `soal_${s.id}`,
                width: 25
            });
        });

        worksheet.columns = columns;

        siswaList.forEach(sw => {
            const rowData = {
                siswa_id: sw.siswa_id,
                nis: sw.nis,
                nama: sw.nama,
                kelas: sw.kelas
            };
            const studentScores = skorMap[sw.siswa_id] || {};
            soalList.forEach(s => {
                rowData[`soal_${s.id}`] = studentScores[s.id] !== undefined ? studentScores[s.id] : '';
            });
            worksheet.addRow(rowData);
        });

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4E73DF' } };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=nilai_essay_${ujian.nama_ujian.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Error GET /guru/essay/:ujianId/export:', err);
        res.status(500).send('Terjadi kesalahan saat mengekspor Excel');
    }
});

// 5. Impor Nilai Essay dari Excel
router.post('/essay/:ujianId/import', uploadEssay.single('file_excel'), async (req, res) => {
    const guruId = req.session.guruId;
    const ujianId = parseInt(req.params.ujianId);

    const cleanup = () => {
        if (req.file && req.file.path) {
            try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
        }
    };

    try {
        const authCheck = await checkGuruPengampuUjian(ujianId, guruId);
        if (!authCheck.exists) {
            cleanup();
            return res.status(404).send('Ujian tidak ditemukan');
        }
        if (!authCheck.authorized) {
            cleanup();
            return res.status(403).send('Akses ditolak: Anda bukan guru pengampu ujian ini');
        }

        if (!req.file) {
            return res.redirect(`/guru/essay/${ujianId}?error=` + encodeURIComponent('Silakan pilih file Excel'));
        }

        // Ambil daftar soal essay yang sah
        const [soalList] = await pool.query(`
            SELECT id, poin
            FROM soal
            WHERE ujian_id = ? AND tipe_soal = 'essay'
        `, [ujianId]);

        const maxPoinMap = new Map();
        soalList.forEach(s => maxPoinMap.set(s.id, s.poin));

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const worksheet = workbook.worksheets[0];

        if (!worksheet) {
            cleanup();
            return res.redirect(`/guru/essay/${ujianId}?error=` + encodeURIComponent('File Excel tidak memiliki lembar kerja'));
        }

        // Baca header di baris 1
        const headerRow = worksheet.getRow(1);
        let idSiswaColIdx = null;
        let nisColIdx = null;
        const soalColMap = new Map(); // colIndex => soalId

        headerRow.eachCell((cell, colNumber) => {
            const val = String(cell.value || '').trim();
            if (val.toLowerCase().includes('id siswa')) {
                idSiswaColIdx = colNumber;
            } else if (val.toLowerCase() === 'nis') {
                nisColIdx = colNumber;
            }

            const match = val.match(/\[ID:(\d+)\]/);
            if (match) {
                const soalId = parseInt(match[1]);
                if (maxPoinMap.has(soalId)) {
                    soalColMap.set(colNumber, soalId);
                }
            }
        });

        if (!idSiswaColIdx && !nisColIdx) {
            cleanup();
            return res.redirect(`/guru/essay/${ujianId}?error=` + encodeURIComponent('Header kolom ID Siswa atau NIS tidak ditemukan'));
        }

        // Buat lookup siswa berdasarkan NIS bila ID Siswa tidak ada
        let nisToIdMap = new Map();
        if (!idSiswaColIdx) {
            const [allSiswa] = await pool.query('SELECT id, nis FROM siswa');
            allSiswa.forEach(s => nisToIdMap.set(String(s.nis).trim(), s.id));
        }

        const pesertaSelesai = await ambilPesertaSelesai(ujianId);
        const updatesToApply = []; // { siswaId, soalId, skor }
        const affectedSiswaIds = new Set();
        const errors = [];

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header

            let siswaId = null;
            if (idSiswaColIdx) {
                const val = row.getCell(idSiswaColIdx).value;
                if (val !== null && val !== undefined) siswaId = parseInt(val);
            } else if (nisColIdx) {
                const rawNis = String(row.getCell(nisColIdx).value || '').trim();
                siswaId = nisToIdMap.get(rawNis);
            }

            if (!siswaId || isNaN(siswaId)) return;

            if (!pesertaSelesai.has(siswaId)) {
                errors.push(`Baris ${rowNumber}: siswa ID ${siswaId} bukan peserta ujian ini atau ujiannya belum selesai`);
                return;
            }

            soalColMap.forEach((soalId, colNumber) => {
                const rawScore = row.getCell(colNumber).value;
                if (rawScore === null || rawScore === undefined || String(rawScore).trim() === '') return;

                const score = Number(rawScore);
                const maxPoin = maxPoinMap.get(soalId);

                if (isNaN(score) || !Number.isInteger(score) || score < 0 || score > maxPoin) {
                    errors.push(`Baris ${rowNumber}: Skor (${rawScore}) untuk Soal ID ${soalId} tidak valid (maks: ${maxPoin})`);
                } else {
                    updatesToApply.push({ siswaId, soalId, skor: score });
                    affectedSiswaIds.add(siswaId);
                }
            });
        });

        if (errors.length > 0) {
            cleanup();
            return res.redirect(`/guru/essay/${ujianId}?error=` + encodeURIComponent(errors.slice(0, 3).join('; ')));
        }

        // Simpan semua nilai yang sah
        for (const item of updatesToApply) {
            await pool.query(`
                INSERT INTO nilai_essay (siswa_id, ujian_id, soal_id, skor, dinilai_oleh, dinilai_pada)
                VALUES (?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                  skor = VALUES(skor),
                  dinilai_oleh = VALUES(dinilai_oleh),
                  dinilai_pada = NOW()
            `, [item.siswaId, ujianId, item.soalId, item.skor, guruId]);
        }

        // Hitung ulang nilai akhir untuk semua siswa terdampak
        for (const sId of affectedSiswaIds) {
            await hitungUlangNilai(sId, ujianId, pool);
        }

        cleanup();
        res.redirect(`/guru/essay/${ujianId}?msg=` + encodeURIComponent(`Berhasil mengimpor nilai essay untuk ${affectedSiswaIds.size} siswa`));
    } catch (err) {
        cleanup();
        console.error('Error POST /guru/essay/:ujianId/import:', err);
        res.status(500).send('Terjadi kesalahan saat mengimpor nilai essay: ' + err.message);
    }
});

module.exports = router;