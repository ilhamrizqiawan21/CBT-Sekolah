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
            const opsiJSON = JSON.stringify({ kata_kunci: soal.kata_kunci || [] });
            await pool.query(
                `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) 
                 VALUES (?, 'essay', ?, ?, ?, ?)`,
                [ujian_id, soal.teks_soal, soal.poin || 3, JSON.stringify(soal.kata_kunci || []), opsiJSON]
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
               mp.nama_mapel, n.nilai, n.benar, n.salah, n.kosong, n.selesai_pada 
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
        { header: 'Nilai', key: 'nilai', width: 10 },
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
            nilai: row.nilai,
            benar: row.benar,
            salah: row.salah,
            kosong: row.kosong,
            selesai_pada: new Date(row.selesai_pada).toLocaleString()
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

module.exports = router;