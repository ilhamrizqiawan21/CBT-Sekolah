const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const { isAdmin } = require('../middleware/auth');
const bcrypt  = require('bcrypt');
const monitorService = require('../services/monitorService');
const { poinDefault } = require('../utils/helper');

router.use(isAdmin);

// ============================================================
// DASHBOARD
// ============================================================
router.get('/dashboard', async (req, res) => {
    const [totalGuru]    = await pool.query('SELECT COUNT(*) as total FROM guru');
    const [totalSiswa]   = await pool.query('SELECT COUNT(*) as total FROM siswa');
    const [totalUjian]   = await pool.query('SELECT COUNT(*) as total FROM ujian');
    const [totalSoal]    = await pool.query('SELECT COUNT(*) as total FROM soal');
    const [ujianAktif]   = await pool.query('SELECT COUNT(*) as total FROM ujian WHERE tanggal_mulai <= NOW() AND tanggal_selesai >= NOW()');
    const [siswaPerKelas]= await pool.query('SELECT kelas, COUNT(*) as jumlah FROM siswa GROUP BY kelas ORDER BY kelas');
    const [ujianTerbaru] = await pool.query(`
        SELECT u.nama_ujian, u.tanggal_mulai, u.tanggal_selesai, k.nama_kelas, p.nama_mapel
        FROM ujian u JOIN pengajaran pg ON u.pengajaran_id = pg.id
        JOIN kelas k ON pg.kelas_id = k.id JOIN mata_pelajaran p ON pg.mapel_id = p.id
        ORDER BY u.created_at DESC LIMIT 5
    `);
    res.render('admin/dashboard', {
        totalGuru: totalGuru[0].total, totalSiswa: totalSiswa[0].total,
        totalUjian: totalUjian[0].total, totalSoal: totalSoal[0].total,
        ujianAktif: ujianAktif[0].total, siswaPerKelas, ujianTerbaru
    });
});

// ============================================================
// GURU
// ============================================================
router.get('/guru', async (req, res) => {
    const [guru] = await pool.query('SELECT * FROM guru');
    res.render('admin/guru', { guru, msg: req.query.msg, error: req.query.error });
});
router.post('/guru/tambah', async (req, res) => {
    const { nip, nama, username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    try {
        await pool.query('INSERT INTO guru (nip, nama, username, password) VALUES (?, ?, ?, ?)', [nip, nama, username, hashed]);
        res.redirect('/admin/guru?msg=Guru berhasil ditambahkan');
    } catch (err) { console.error(err); res.redirect('/admin/guru?error=Gagal menambahkan guru'); }
});
router.post('/guru/hapus/:id', async (req, res) => {
    try { await pool.query('DELETE FROM guru WHERE id = ?', [req.params.id]); res.redirect('/admin/guru?msg=Guru berhasil dihapus'); }
    catch (err) { console.error(err); res.redirect('/admin/guru?error=Gagal hapus guru'); }
});
router.post('/guru/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { nip, nama, username, password } = req.body;
    try {
        if (password && password.trim() !== '') {
            const hashed = await bcrypt.hash(password, 10);
            await pool.query('UPDATE guru SET nip=?, nama=?, username=?, password=? WHERE id=?', [nip, nama, username, hashed, id]);
        } else {
            await pool.query('UPDATE guru SET nip=?, nama=?, username=? WHERE id=?', [nip, nama, username, id]);
        }
        res.redirect('/admin/guru?msg=Guru berhasil diupdate');
    } catch (err) { console.error(err); res.redirect('/admin/guru?error=Gagal update guru'); }
});

// ============================================================
// KELAS
// ============================================================
router.get('/kelas', async (req, res) => {
    const [kelas] = await pool.query('SELECT * FROM kelas');
    res.render('admin/kelas', { kelas, msg: req.query.msg, error: req.query.error });
});
router.post('/kelas/tambah', async (req, res) => {
    await pool.query('INSERT INTO kelas (nama_kelas) VALUES (?)', [req.body.nama_kelas]);
    res.redirect('/admin/kelas');
});
router.post('/kelas/hapus/:id', async (req, res) => {
    await pool.query('DELETE FROM kelas WHERE id = ?', [req.params.id]);
    res.redirect('/admin/kelas');
});
router.post('/kelas/edit/:id', async (req, res) => {
    try {
        await pool.query('UPDATE kelas SET nama_kelas = ? WHERE id = ?', [req.body.nama_kelas, req.params.id]);
        res.redirect('/admin/kelas?msg=Kelas berhasil diperbarui');
    } catch (err) { console.error(err); res.redirect('/admin/kelas?error=Gagal memperbarui kelas'); }
});

// ============================================================
// MATA PELAJARAN
// ============================================================
router.get('/mapel', async (req, res) => {
    const [mapel] = await pool.query('SELECT * FROM mata_pelajaran');
    res.render('admin/mapel', { mapel, msg: req.query.msg, error: req.query.error });
});
router.post('/mapel/tambah', async (req, res) => {
    await pool.query('INSERT INTO mata_pelajaran (nama_mapel) VALUES (?)', [req.body.nama_mapel]);
    res.redirect('/admin/mapel');
});
router.post('/mapel/hapus/:id', async (req, res) => {
    await pool.query('DELETE FROM mata_pelajaran WHERE id = ?', [req.params.id]);
    res.redirect('/admin/mapel');
});
router.post('/mapel/edit/:id', async (req, res) => {
    try {
        await pool.query('UPDATE mata_pelajaran SET nama_mapel = ? WHERE id = ?', [req.body.nama_mapel, req.params.id]);
        res.redirect('/admin/mapel?msg=Mapel berhasil diperbarui');
    } catch (err) { console.error(err); res.redirect('/admin/mapel?error=Gagal memperbarui mapel'); }
});

// ============================================================
// UJIAN
// ============================================================
router.get('/ujian', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 10, offset = (page - 1) * limit;
    const filterMapel = req.query.mapel || '', filterKelas = req.query.kelas || '';
    const [mapelList] = await pool.query('SELECT id, nama_mapel FROM mata_pelajaran ORDER BY nama_mapel');
    const [kelasList] = await pool.query('SELECT id, nama_kelas FROM kelas ORDER BY nama_kelas');
    let baseQuery = `FROM ujian u JOIN pengajaran pg ON u.pengajaran_id = pg.id JOIN mata_pelajaran p ON pg.mapel_id = p.id JOIN kelas k ON pg.kelas_id = k.id JOIN guru g ON pg.guru_id = g.id WHERE 1=1`;
    let params = [];
    if (filterMapel) { baseQuery += ' AND p.id = ?'; params.push(filterMapel); }
    if (filterKelas) { baseQuery += ' AND k.id = ?'; params.push(filterKelas); }
    const [totalResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = totalResult[0].total, totalPages = Math.ceil(total / limit);
    const [ujian] = await pool.query(`SELECT u.*, p.nama_mapel, k.nama_kelas, g.nama as guru_nama ${baseQuery} ORDER BY u.tanggal_mulai DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [pengajaran] = await pool.query(`SELECT pg.id, p.nama_mapel, k.nama_kelas, g.nama as guru_nama FROM pengajaran pg JOIN mata_pelajaran p ON pg.mapel_id = p.id JOIN kelas k ON pg.kelas_id = k.id JOIN guru g ON pg.guru_id = g.id ORDER BY p.nama_mapel, k.nama_kelas`);
    res.render('admin/ujian', { ujian, pengajaran, mapelList, kelasList, filterMapel, filterKelas, currentPage: page, totalPages, total, msg: req.query.msg, error: req.query.error });
});
router.post('/ujian/tambah', async (req, res) => {
    const { pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal, acak_pilihan, batas_pelanggaran, token_ujian } = req.body;
    const batas = parseInt(batas_pelanggaran) || 3;
    if (batas < 1) return res.redirect('/admin/ujian?error=Batas pelanggaran minimal 1');
    const token = token_ujian && token_ujian.trim() !== '' ? token_ujian.trim() : null;
    try {
        await pool.query(`INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal, acak_pilihan, batas_pelanggaran, token_ujian) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal || 0, acak_pilihan || 0, batas, token]);
        res.redirect('/admin/ujian?msg=Ujian berhasil ditambahkan');
    } catch (err) { console.error(err); res.redirect('/admin/ujian?error=Gagal menambahkan ujian'); }
});
router.get('/ujian/edit/:id', async (req, res) => {
    const [ujian] = await pool.query('SELECT * FROM ujian WHERE id = ?', [req.params.id]);
    if (ujian.length === 0) return res.redirect('/admin/ujian?error=Ujian tidak ditemukan');
    const [pengajaran] = await pool.query(`SELECT pg.id, p.nama_mapel, k.nama_kelas, g.nama as guru_nama FROM pengajaran pg JOIN mata_pelajaran p ON pg.mapel_id = p.id JOIN kelas k ON pg.kelas_id = k.id JOIN guru g ON pg.guru_id = g.id`);
    res.render('admin/ujian_edit', { ujian: ujian[0], pengajaran, error: req.query.error });
});
router.post('/ujian/edit/:id', async (req, res) => {
    const { pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal, acak_pilihan, batas_pelanggaran, token_ujian } = req.body;
    const batas = parseInt(batas_pelanggaran) || 3;
    if (batas < 1) return res.redirect(`/admin/ujian/edit/${req.params.id}?error=Batas pelanggaran minimal 1`);
    const token = token_ujian && token_ujian.trim() !== '' ? token_ujian.trim() : null;
    try {
        await pool.query(`UPDATE ujian SET pengajaran_id=?, nama_ujian=?, durasi=?, tanggal_mulai=?, tanggal_selesai=?, acak_soal=?, acak_pilihan=?, batas_pelanggaran=?, token_ujian=? WHERE id=?`, [pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal || 0, acak_pilihan || 0, batas, token, req.params.id]);
        res.redirect('/admin/ujian?msg=Ujian berhasil diupdate');
    } catch (err) { console.error(err); res.redirect(`/admin/ujian/edit/${req.params.id}?error=Gagal update ujian`); }
});
router.post('/ujian/hapus/:id', async (req, res) => {
    try { await pool.query('DELETE FROM ujian WHERE id = ?', [req.params.id]); res.redirect('/admin/ujian?msg=Ujian berhasil dihapus'); }
    catch (err) { console.error(err); res.redirect('/admin/ujian?error=Gagal menghapus ujian (masih terhubung dengan data lain)'); }
});
router.get('/api/ujian-by-mapel/:mapelId', async (req, res) => {
    const mapelId = req.params.mapelId;
    if (!mapelId || mapelId === '') return res.json([]);
    const [ujian] = await pool.query(`SELECT u.id, u.nama_ujian FROM ujian u JOIN pengajaran pg ON u.pengajaran_id = pg.id WHERE pg.mapel_id = ? ORDER BY u.tanggal_mulai DESC`, [mapelId]);
    res.json(ujian);
});

// ============================================================
// SOAL
// ============================================================
router.get('/soal', async (req, res) => {
    const page = parseInt(req.query.page) || 1, limit = 10, offset = (page - 1) * limit;
    const filterUjian = req.query.ujian || '';
    const [ujianList] = await pool.query('SELECT id, nama_ujian FROM ujian ORDER BY nama_ujian');
    let baseQuery = `FROM soal s JOIN ujian u ON s.ujian_id = u.id WHERE 1=1`;
    let params = [];
    if (filterUjian) { baseQuery += ' AND s.ujian_id = ?'; params.push(filterUjian); }
    const [totalResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = totalResult[0].total, totalPages = Math.ceil(total / limit);
    const [soal] = await pool.query(`SELECT s.*, u.nama_ujian ${baseQuery} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.render('admin/soal', { soal, ujianList, filterUjian, currentPage: page, totalPages, total, msg: req.query.msg, error: req.query.error });
});
router.post('/soal/tambah', async (req, res) => {
    const { ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar, opsi_tambahan } = req.body;
    try {
        if (tipe_soal === 'pg') {
            await pool.query(`INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ujian_id, tipe_soal, teks_soal, poinDefault(tipe_soal, poin), pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar]);
        } else {
            await pool.query(`INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) VALUES (?, ?, ?, ?, ?, ?)`, [ujian_id, tipe_soal, teks_soal, poinDefault(tipe_soal, poin), jawaban_benar, opsi_tambahan]);
        }
        res.redirect('/admin/soal?msg=Soal berhasil ditambahkan');
    } catch (err) { console.error(err); res.redirect('/admin/soal?error=Gagal menambahkan soal'); }
});
router.get('/soal/edit/:id', async (req, res) => {
    const [soal] = await pool.query('SELECT * FROM soal WHERE id = ?', [req.params.id]);
    if (soal.length === 0) return res.redirect('/admin/soal?error=Soal tidak ditemukan');
    const [ujianList] = await pool.query('SELECT id, nama_ujian FROM ujian');
    res.render('admin/soal_edit', { soal: soal[0], ujianList });
});
router.post('/soal/edit/:id', async (req, res) => {
    const { ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar, opsi_tambahan } = req.body;
    try {
        if (tipe_soal === 'pg') {
            await pool.query(`UPDATE soal SET ujian_id=?, tipe_soal=?, teks_soal=?, poin=?, pilihan_a=?, pilihan_b=?, pilihan_c=?, pilihan_d=?, jawaban_benar=? WHERE id=?`, [ujian_id, tipe_soal, teks_soal, poinDefault(tipe_soal, poin), pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar, req.params.id]);
        } else {
            await pool.query(`UPDATE soal SET ujian_id=?, tipe_soal=?, teks_soal=?, poin=?, jawaban_benar=?, opsi_tambahan=? WHERE id=?`, [ujian_id, tipe_soal, teks_soal, poinDefault(tipe_soal, poin), jawaban_benar, opsi_tambahan, req.params.id]);
        }
        res.redirect('/admin/soal?msg=Soal berhasil diupdate');
    } catch (err) { console.error(err); res.redirect(`/admin/soal/edit/${req.params.id}?error=Gagal update soal`); }
});
router.post('/soal/hapus/:id', async (req, res) => {
    try { await pool.query('DELETE FROM soal WHERE id = ?', [req.params.id]); res.redirect('/admin/soal?msg=Soal berhasil dihapus'); }
    catch (err) { console.error(err); res.redirect('/admin/soal?error=Gagal hapus soal'); }
});
router.get('/soal/tambah-batch', async (req, res) => {
    const [mapelList] = await pool.query('SELECT id, nama_mapel FROM mata_pelajaran ORDER BY nama_mapel');
    res.render('admin/soal_tambah', { mapelList });
});
router.post('/soal/batch-tambah', async (req, res) => {
    const { ujian_id, soal_pg, soal_menjodohkan, soal_essay, pengecoh } = req.body;
    if (!ujian_id) return res.status(400).json({ success: false, error: 'Ujian tidak dipilih' });
    let totalInserted = 0;
    try {
        for (const soal of soal_pg) {
            await pool.query(`INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar) VALUES (?, 'pg', ?, ?, ?, ?, ?, ?, ?)`, [ujian_id, soal.teks_soal, soal.poin, soal.pilihan_a, soal.pilihan_b, soal.pilihan_c, soal.pilihan_d, soal.jawaban_benar]);
            totalInserted++;
        }
        if (soal_menjodohkan.length > 0) {
            const pasangan = soal_menjodohkan.map(s => ({ kiri: s.pasangan.kiri, kanan: s.pasangan.kanan }));
            await pool.query(`INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) VALUES (?, 'menjodohkan', ?, ?, ?, ?)`, [ujian_id, soal_menjodohkan.map((s,i)=>`${i+1}. ${s.teks_soal}`).join('\n'), soal_menjodohkan.reduce((s,x)=>s+x.poin,0), JSON.stringify(pasangan), JSON.stringify({ pasangan, pengecoh: pengecoh || [] })]);
            totalInserted++;
        }
        for (const soal of soal_essay) {
            await pool.query(`INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) VALUES (?, 'essay', ?, ?, ?, ?)`, [ujian_id, soal.teks_soal, soal.poin, '[]', '{}']);
            totalInserted++;
        }
        res.json({ success: true, total: totalInserted });
    } catch (err) { console.error(err); res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// PENGAJARAN
// ============================================================
router.get('/pengajaran', async (req, res) => {
    const [pengajaran] = await pool.query(`SELECT pg.id, g.nama as guru_nama, p.nama_mapel, k.nama_kelas FROM pengajaran pg JOIN guru g ON pg.guru_id = g.id JOIN mata_pelajaran p ON pg.mapel_id = p.id JOIN kelas k ON pg.kelas_id = k.id ORDER BY p.nama_mapel, k.nama_kelas`);
    const [guruList]  = await pool.query('SELECT id, nama FROM guru ORDER BY nama');
    const [mapelList] = await pool.query('SELECT id, nama_mapel FROM mata_pelajaran ORDER BY nama_mapel');
    const [kelasList] = await pool.query('SELECT id, nama_kelas FROM kelas ORDER BY nama_kelas');
    res.render('admin/pengajaran', { pengajaran, guruList, mapelList, kelasList, msg: req.query.msg, error: req.query.error });
});
router.post('/pengajaran/tambah', async (req, res) => {
    try {
        await pool.query('INSERT INTO pengajaran (guru_id, mapel_id, kelas_id) VALUES (?, ?, ?)', [req.body.guru_id, req.body.mapel_id, req.body.kelas_id]);
        res.redirect('/admin/pengajaran?msg=Berhasil ditambahkan');
    } catch (err) { console.error(err); res.redirect('/admin/pengajaran?error=Gagal menambahkan (mungkin sudah ada)'); }
});
router.post('/pengajaran/hapus/:id', async (req, res) => {
    try { await pool.query('DELETE FROM pengajaran WHERE id = ?', [req.params.id]); res.redirect('/admin/pengajaran?msg=Berhasil dihapus'); }
    catch (err) { console.error(err); res.redirect('/admin/pengajaran?error=Gagal menghapus data'); }
});

// ============================================================
// SISWA — FIX #7: semua operasi PIN pakai bcrypt
// ============================================================
const multer  = require('multer');
const path    = require('path');
const ExcelJS = require('exceljs');
const fs      = require('fs');
const logger  = require('../utils/logger');

const upload = multer({
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

const uploadMiddleware = (req, res, next) => {
    upload.single('file_excel')(req, res, (err) => {
        if (err) {
            if (req.file && req.file.path) {
                try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
            }
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.redirect('/admin/siswa?error=' + encodeURIComponent('Ukuran file melebihi batas maksimal (2 MB)'));
            }
            return res.redirect('/admin/siswa?error=' + encodeURIComponent(err.message));
        }
        next();
    });
};

router.get('/siswa', async (req, res) => {
    const page = parseInt(req.query.page) || 1, limit = 10, offset = (page - 1) * limit;
    const filterKelas = req.query.kelas || '';
    const [kelasList] = await pool.query('SELECT DISTINCT nama_kelas FROM kelas ORDER BY nama_kelas');
    let totalQuery = 'SELECT COUNT(*) as total FROM siswa s';
    let dataQuery  = 'SELECT s.*, k.nama_kelas FROM siswa s LEFT JOIN kelas k ON s.kelas = k.nama_kelas';
    let params = [];
    if (filterKelas) { totalQuery += ' WHERE s.kelas = ?'; dataQuery += ' WHERE s.kelas = ?'; params.push(filterKelas); }
    const [totalResult] = await pool.query(totalQuery, params);
    const total = totalResult[0].total, totalPages = Math.ceil(total / limit);
    const [siswa] = await pool.query(dataQuery + ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?', [...params, limit, offset]);
    res.render('admin/siswa', { siswa, kelasList, filterKelas, currentPage: page, totalPages, limit, total, msg: req.query.msg, error: req.query.error });
});

// Tambah siswa — FIX #7: hash PIN
router.post('/siswa/tambah', async (req, res) => {
    const { nis, nama, kelas, pin_ujian } = req.body;
    try {
        const pin    = (pin_ujian || '1234').trim();
        const hashed = await bcrypt.hash(pin, 10);
        await pool.query('INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES (?, ?, ?, ?)', [nis, nama, kelas || null, hashed]);
        res.redirect('/admin/siswa?msg=Siswa berhasil ditambahkan');
    } catch (err) { console.error(err); res.redirect('/admin/siswa?error=Gagal menambahkan siswa (NIS mungkin sudah ada)'); }
});

router.post('/siswa/hapus/:id', async (req, res) => {
    try { await pool.query('DELETE FROM siswa WHERE id = ?', [req.params.id]); res.redirect('/admin/siswa?msg=Siswa berhasil dihapus'); }
    catch (err) { console.error(err); res.redirect('/admin/siswa?error=Gagal hapus siswa, mungkin masih terhubung dengan data ujian'); }
});

router.get('/siswa/template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Template_Siswa');
        worksheet.columns = [
            { header: 'NIS', key: 'nis', width: 15 },
            { header: 'NAMA', key: 'nama', width: 30 },
            { header: 'KELAS', key: 'kelas', width: 15 },
            { header: 'PIN_UJIAN', key: 'pin_ujian', width: 15 }
        ];
        worksheet.getRow(1).font = { bold: true };
        res.setHeader('Content-Disposition', 'attachment; filename=template_siswa.xlsx');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        logger.error(`Download template siswa error: ${err.message}`);
        res.redirect('/admin/siswa?error=Gagal mengunduh template siswa');
    }
});

// Import Excel — FIX #7: hash PIN dari Excel
router.post('/siswa/import', uploadMiddleware, async (req, res) => {
    if (!req.file) return res.redirect('/admin/siswa?error=File tidak ditemukan');
    const filePath = req.file.path;
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            throw new Error('Worksheet Excel tidak ditemukan');
        }

        const rowsToProcess = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const nis = row.getCell(1).text ? row.getCell(1).text.trim() : '';
            const nama = row.getCell(2).text ? row.getCell(2).text.trim() : '';
            const kelas = row.getCell(3).text ? row.getCell(3).text.trim() : '';
            const pinRaw = row.getCell(4).text ? row.getCell(4).text.trim() : '';
            if (nis && nama) {
                rowsToProcess.push({
                    rowNumber,
                    nis,
                    nama,
                    kelas,
                    pin: pinRaw || '1234'
                });
            }
        });

        let inserted = 0, errors = [];
        for (const item of rowsToProcess) {
            try {
                const hashed = await bcrypt.hash(item.pin, 10);
                await pool.query(
                    'INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES (?, ?, ?, ?)',
                    [item.nis, item.nama, item.kelas || null, hashed]
                );
                inserted++;
            } catch (err) {
                errors.push(`Baris ${item.rowNumber}: ${err.message}`);
            }
        }

        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (unlinkErr) {
            logger.error(`Gagal menghapus file upload: ${unlinkErr.message}`);
        }

        const msg = `Import selesai. Berhasil: ${inserted}, Gagal: ${errors.length}`;
        if (errors.length > 0) return res.redirect(`/admin/siswa?error=${encodeURIComponent(msg + ' - ' + errors.join(', '))}`);
        res.redirect(`/admin/siswa?msg=${encodeURIComponent(msg)}`);
    } catch (err) {
        logger.error(`Import siswa error: ${err.message}`);
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (unlinkErr) {
            logger.error(`Gagal menghapus file upload saat error: ${unlinkErr.message}`);
        }
        res.redirect('/admin/siswa?error=Gagal memproses file Excel');
    }
});

router.get('/siswa/edit/:id', async (req, res) => {
    const [siswa] = await pool.query('SELECT * FROM siswa WHERE id = ?', [req.params.id]);
    if (siswa.length === 0) return res.redirect('/admin/siswa?error=Siswa tidak ditemukan');
    res.render('admin/siswa_edit', { siswa: siswa[0] });
});

// Edit siswa — FIX #7: hash PIN baru jika diisi, skip jika kosong
router.post('/siswa/edit/:id', async (req, res) => {
    const { nis, nama, kelas, pin_ujian } = req.body;
    try {
        if (pin_ujian && pin_ujian.trim() !== '') {
            const hashed = await bcrypt.hash(pin_ujian.trim(), 10);
            await pool.query('UPDATE siswa SET nis=?, nama=?, kelas=?, pin_ujian=? WHERE id=?', [nis, nama, kelas, hashed, req.params.id]);
        } else {
            // PIN tidak diubah
            await pool.query('UPDATE siswa SET nis=?, nama=?, kelas=? WHERE id=?', [nis, nama, kelas, req.params.id]);
        }
        res.redirect('/admin/siswa?msg=Siswa berhasil diupdate');
    } catch (err) { console.error(err); res.redirect(`/admin/siswa/edit/${req.params.id}?error=Gagal update`); }
});

// ============================================================
// HASIL UJIAN
// ============================================================
router.get('/hasil', async (req, res) => {
    const page = parseInt(req.query.page) || 1, limit = 10, offset = (page - 1) * limit;
    const filterUjian = req.query.ujian || '', filterKelas = req.query.kelas || '';
    const [ujianList] = await pool.query('SELECT id, nama_ujian FROM ujian ORDER BY nama_ujian');
    const [kelasList] = await pool.query('SELECT DISTINCT nama_kelas FROM kelas ORDER BY nama_kelas');
    let baseQuery = `FROM nilai_ujian n JOIN siswa s ON n.siswa_id = s.id JOIN ujian u ON n.ujian_id = u.id WHERE 1=1`;
    let params = [];
    if (filterUjian) { baseQuery += ' AND n.ujian_id = ?'; params.push(filterUjian); }
    if (filterKelas) { baseQuery += ' AND s.kelas = ?'; params.push(filterKelas); }
    const [totalResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, params);
    const total = totalResult[0].total, totalPages = Math.ceil(total / limit);
    const [hasil] = await pool.query(`SELECT n.*, s.nama as siswa_nama, s.nis, s.kelas, u.nama_ujian, n.siswa_id, n.ujian_id ${baseQuery} ORDER BY n.selesai_pada DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [statistik] = await pool.query(`SELECT COUNT(*) as total_ujian_selesai, AVG(n.nilai) as rata_rata_nilai, MAX(n.nilai) as nilai_tertinggi, MIN(n.nilai) as nilai_terendah FROM nilai_ujian n`);
    res.render('admin/hasil', { hasil, ujianList, kelasList, filterUjian, filterKelas, currentPage: page, totalPages, total, statistik: statistik[0], msg: req.query.msg, error: req.query.error });
});

router.get('/log-kecurangan', async (req, res) => {
    const filterUjian = req.query.ujian || '', filterJenis = req.query.jenis || '';
    const [ujianList] = await pool.query('SELECT id, nama_ujian FROM ujian ORDER BY nama_ujian');
    let baseQuery = `FROM log_kecurangan lk JOIN siswa s ON lk.siswa_id = s.id JOIN ujian u ON lk.ujian_id = u.id WHERE 1=1`;
    let params = [];
    if (filterUjian) { baseQuery += ' AND lk.ujian_id = ?'; params.push(filterUjian); }
    if (filterJenis) { baseQuery += ' AND lk.jenis_kecurangan = ?'; params.push(filterJenis); }
    const [log] = await pool.query(`SELECT lk.*, s.nama as siswa_nama, s.nis, u.nama_ujian ${baseQuery} ORDER BY lk.timestamp DESC`, params);
    res.render('admin/log_kecurangan', { log, ujianList, filterUjian, filterJenis, msg: req.query.msg, error: req.query.error });
});

// ─────────────────────────────────────────────
// GET /admin/monitor/:ujianId & /admin/monitor (T4.3)
// Halaman dashboard pemantauan ujian real-time
// ─────────────────────────────────────────────
router.get('/monitor', async (req, res) => {
    try {
        const [activeUjian] = await pool.query(`
            SELECT id FROM ujian
            ORDER BY (tanggal_mulai <= NOW() AND tanggal_selesai >= NOW()) DESC, created_at DESC
            LIMIT 1
        `);
        if (activeUjian.length > 0) {
            return res.redirect(`/admin/monitor/${activeUjian[0].id}`);
        }
        res.redirect('/admin/ujian?msg=Belum ada ujian untuk dipantau');
    } catch (err) {
        logger.error(`GET /admin/monitor error: ${err.message}`);
        res.redirect('/admin/ujian');
    }
});

router.get('/monitor/:ujianId', async (req, res) => {
    const ujianId = parseInt(req.params.ujianId, 10);
    if (isNaN(ujianId)) {
        return res.redirect('/admin/ujian?error=ID ujian tidak valid');
    }

    try {
        const snapshot = await monitorService.getMonitorSnapshot(ujianId, pool);
        if (!snapshot) {
            return res.redirect('/admin/ujian?error=Ujian tidak ditemukan');
        }

        const [ujianList] = await pool.query(`
            SELECT u.id, u.nama_ujian, k.nama_kelas
            FROM ujian u
            JOIN pengajaran p ON u.pengajaran_id = p.id
            JOIN kelas k ON p.kelas_id = k.id
            ORDER BY (u.tanggal_mulai <= NOW() AND u.tanggal_selesai >= NOW()) DESC, u.created_at DESC
        `);

        res.render('admin/monitor', {
            ujian: snapshot.ujian,
            total_soal: snapshot.total_soal,
            ringkasan: snapshot.ringkasan,
            siswa: snapshot.siswa,
            ujianList
        });
    } catch (err) {
        logger.error(`GET /admin/monitor/${ujianId} error: ${err.message}`);
        res.redirect('/admin/ujian?error=Gagal memuat halaman pemantauan');
    }
});

// ─────────────────────────────────────────────
// GET /admin/api/monitor/:ujianId (DESIGN §3.6, §4, T4.1)
// Snapshot pemantauan ujian untuk admin
// ─────────────────────────────────────────────
router.get('/api/monitor/:ujianId', async (req, res) => {
    const ujianId = parseInt(req.params.ujianId, 10);
    if (isNaN(ujianId)) {
        return res.status(400).json({ error: 'ID ujian tidak valid' });
    }

    try {
        const snapshot = await monitorService.getMonitorSnapshot(ujianId, pool);
        if (!snapshot) {
            return res.status(404).json({ error: 'Ujian tidak ditemukan' });
        }
        res.json(snapshot);
    } catch (err) {
        logger.error(`GET /admin/api/monitor/${ujianId} error: ${err.message}`);
        res.status(500).json({ error: 'Gagal mengambil data pemantauan' });
    }
});

// ─────────────────────────────────────────────
// POST /admin/api/sesi/:id/buka-kunci (DESIGN §3.6, §4, T1.9)
// Membuka sesi yang keluar_paksa -> sedang_ujian tanpa hapus data
// ─────────────────────────────────────────────
router.post('/api/sesi/:id/buka-kunci', async (req, res) => {
    const sesiId = parseInt(req.params.id, 10);
    if (isNaN(sesiId)) {
        return res.status(400).json({ error: 'ID sesi tidak valid' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT s.*, sw.nama, sw.nis, u.nama_ujian
             FROM sesi_ujian s
             JOIN siswa sw ON s.siswa_id = sw.id
             JOIN ujian u ON s.ujian_id = u.id
             WHERE s.id = ?`,
            [sesiId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
        }

        const sesi = rows[0];

        if (sesi.status !== 'keluar_paksa') {
            return res.status(409).json({ error: 'Sesi tidak dalam status terkunci (keluar_paksa)' });
        }

        // Ubah status dari keluar_paksa menjadi sedang_ujian tanpa menghapus jawaban
        const [upd] = await pool.query(
            `UPDATE sesi_ujian
             SET status = 'sedang_ujian'
             WHERE id = ? AND status = 'keluar_paksa'`,
            [sesiId]
        );
        if (upd.affectedRows === 0) {
            return res.status(409).json({ error: 'Sesi tidak dalam status terkunci (keluar_paksa)' });
        }

        // Penanda: pelanggaran sebelum ini tidak dihitung lagi (log lama tetap tersimpan)
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan)
             VALUES (?, ?, 'buka_kunci')`,
            [sesi.siswa_id, sesi.ujian_id]
        );

        // Catat ke audit_admin
        await pool.query(
            `INSERT INTO audit_admin (admin_id, sesi_id, aksi, detail)
             VALUES (?, ?, 'buka-kunci', ?)`,
            [
                req.session.adminId || null,
                sesiId,
                `Buka kunci sesi siswa NIS ${sesi.nis} (${sesi.nama}) untuk ujian ${sesi.nama_ujian}`
            ]
        );

        logger.info(`Admin ${req.session.adminId || 'unknown'} membuka kunci sesi ID ${sesiId} (Siswa: ${sesi.nis})`);

        const io = req.app.get('io');
        if (io) {
            await monitorService.siarkanUpdateSiswa(io, sesi.ujian_id, sesi.siswa_id, pool, { event: 'buka_kunci' });
        }

        res.json({
            success: true,
            message: 'Kunci sesi berhasil dibuka, siswa dapat melanjutkan ujian',
            sesi_id: sesiId,
            status: 'sedang_ujian'
        });

    } catch (err) {
        logger.error(`buka-kunci sesi error: ${err.message}`);
        res.status(500).json({ error: 'Gagal membuka kunci sesi' });
    }
});

// ─────────────────────────────────────────────
// POST /admin/api/sesi/:id/tambah-waktu (DESIGN §3.6, §4, T4.4)
// Menambahkan menit ujian ke batas_waktu sesi siswa
// ─────────────────────────────────────────────
router.post('/api/sesi/:id/tambah-waktu', async (req, res) => {
    const sesiId = parseInt(req.params.id, 10);
    const menit = parseInt(req.body.menit, 10);

    if (isNaN(sesiId)) {
        return res.status(400).json({ error: 'ID sesi tidak valid' });
    }
    if (isNaN(menit) || menit <= 0 || menit > 180) {
        return res.status(400).json({ error: 'Jumlah menit harus berupa angka antara 1 sampai 180' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT s.*, sw.nama, sw.nis, u.nama_ujian
             FROM sesi_ujian s
             JOIN siswa sw ON s.siswa_id = sw.id
             JOIN ujian u ON s.ujian_id = u.id
             WHERE s.id = ?`,
            [sesiId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
        }

        const sesi = rows[0];

        if (sesi.status === 'selesai') {
            return res.status(409).json({ error: 'Tidak dapat menambah waktu untuk sesi yang sudah selesai' });
        }

        const sesiService = require('../services/sesiService');
        const updatedSesi = await sesiService.perpanjang(sesi.id, menit, pool);

        // Catat ke audit_admin
        await pool.query(
            `INSERT INTO audit_admin (admin_id, sesi_id, aksi, detail)
             VALUES (?, ?, 'tambah-waktu', ?)`,
            [
                req.session.adminId || null,
                sesiId,
                `Tambah waktu ${menit} menit untuk siswa NIS ${sesi.nis} (${sesi.nama}) pada ujian ${sesi.nama_ujian}`
            ]
        );

        logger.info(`Admin ${req.session.adminId || 'unknown'} menambah ${menit} menit untuk sesi ID ${sesiId} (Siswa: ${sesi.nis})`);

        // Siarkan pembaruan ke dashboard monitor admin
        const io = req.app.get('io');
        if (io) {
            await monitorService.siarkanUpdateSiswa(io, sesi.ujian_id, sesi.siswa_id, pool, {
                event: 'tambah_waktu',
                tambahan_menit: menit,
                batas_waktu: updatedSesi.batas_waktu
            });

            // Kirim notifikasi socket langsung ke siswa jika sedang terhubung
            if (sesi.socket_id) {
                const sisaDetik = sesiService.hitungSisaDetik(updatedSesi, new Date());
                io.to(sesi.socket_id).emit('tambah-waktu', {
                    menit,
                    sisa_detik: sisaDetik,
                    batas_waktu: updatedSesi.batas_waktu,
                    pesan: `Waktu ujian Anda telah ditambah ${menit} menit oleh pengawas.`
                });
            }
        }

        res.json({
            success: true,
            message: `Waktu berhasil ditambah ${menit} menit`,
            sesi_id: sesiId,
            tambahan_menit: updatedSesi.tambahan_menit,
            batas_waktu: updatedSesi.batas_waktu
        });

    } catch (err) {
        logger.error(`tambah-waktu sesi error: ${err.message}`);
        res.status(500).json({ error: 'Gagal menambah waktu sesi ujian' });
    }
});

// ─────────────────────────────────────────────
// POST /admin/api/sesi/:id/paksa-selesai (DESIGN §3.6, §4, T4.4)
// Memaksa finalisasi sesi ujian siswa dari dashboard admin
// ─────────────────────────────────────────────
router.post('/api/sesi/:id/paksa-selesai', async (req, res) => {
    const sesiId = parseInt(req.params.id, 10);
    if (isNaN(sesiId)) {
        return res.status(400).json({ error: 'ID sesi tidak valid' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT s.*, sw.nama, sw.nis, u.nama_ujian
             FROM sesi_ujian s
             JOIN siswa sw ON s.siswa_id = sw.id
             JOIN ujian u ON s.ujian_id = u.id
             WHERE s.id = ?`,
            [sesiId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
        }

        const sesi = rows[0];

        if (sesi.status === 'selesai') {
            return res.status(409).json({ error: 'Sesi ujian sudah dalam status selesai' });
        }

        const { finalizeSesi } = require('../services/finalizeService');
        await finalizeSesi(sesi.siswa_id, sesi.ujian_id, pool);

        // Catat ke audit_admin
        await pool.query(
            `INSERT INTO audit_admin (admin_id, sesi_id, aksi, detail)
             VALUES (?, ?, 'paksa-selesai', ?)`,
            [
                req.session.adminId || null,
                sesiId,
                `Paksa selesai sesi siswa NIS ${sesi.nis} (${sesi.nama}) pada ujian ${sesi.nama_ujian}`
            ]
        );

        logger.info(`Admin ${req.session.adminId || 'unknown'} memaksa selesai sesi ID ${sesiId} (Siswa: ${sesi.nis})`);

        // Notifikasi socket ke siswa jika terhubung
        const io = req.app.get('io');
        if (io) {
            if (sesi.socket_id) {
                io.to(sesi.socket_id).emit('paksa-submit', {
                    message: '⚠️ Ujian Anda telah diakhiri oleh pengawas.'
                });
            }

            // Siarkan ke dashboard admin
            await monitorService.siarkanUpdateSiswa(io, sesi.ujian_id, sesi.siswa_id, pool, { event: 'selesai' });
        }

        res.json({
            success: true,
            message: 'Sesi ujian berhasil dipaksa selesai',
            sesi_id: sesiId,
            status: 'selesai'
        });

    } catch (err) {
        logger.error(`paksa-selesai sesi error: ${err.message}`);
        res.status(500).json({ error: 'Gagal menyelesaikan sesi ujian' });
    }
});

// Reset ujian lama (diberi proteksi konfirmasi ekstra, bukan jalan utama — T1.9)
router.post('/reset-ujian', async (req, res) => {
    const { siswa_id, ujian_id, konfirmasi } = req.body;
    if (!siswa_id || !ujian_id) return res.redirect('/admin/hasil?error=Data tidak lengkap');

    // Jika konfirmasi disertakan namun tidak bernilai 'YAKIN', tolak penghapusan
    if (konfirmasi !== undefined && konfirmasi !== 'YAKIN') {
        return res.redirect('/admin/hasil?error=Konfirmasi reset harus berupa kata YAKIN');
    }

    try {
        await pool.query('DELETE FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?', [siswa_id, ujian_id]);
        await pool.query('DELETE FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswa_id, ujian_id]);
        await pool.query('DELETE FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswa_id, ujian_id]);
        res.redirect('/admin/hasil?msg=Reset berhasil untuk siswa tersebut');
    } catch (err) { console.error(err); res.redirect('/admin/hasil?error=Gagal reset: ' + encodeURIComponent(err.message)); }
});

router.post('/reset-ujian-semua', async (req, res) => {
    const { ujian_id } = req.body;
    if (!ujian_id) return res.redirect('/admin/hasil?error=Ujian tidak dipilih');
    try {
        await pool.query('DELETE FROM jawaban_siswa WHERE ujian_id = ?', [ujian_id]);
        await pool.query('DELETE FROM nilai_ujian WHERE ujian_id = ?', [ujian_id]);
        await pool.query('DELETE FROM sesi_ujian WHERE ujian_id = ?', [ujian_id]);
        res.redirect('/admin/hasil?msg=Semua data ujian berhasil direset');
    } catch (err) { console.error(err); res.redirect('/admin/hasil?error=Gagal reset semua: ' + encodeURIComponent(err.message)); }
});

router.get('/hasil/export', async (req, res) => {
    const { ujian } = req.query;
    let filter = '', params = [];
    if (ujian) { filter = 'WHERE n.ujian_id = ?'; params.push(ujian); }
    const [hasil] = await pool.query(`SELECT s.nis, s.nama as siswa_nama, s.kelas, u.nama_ujian, n.poin_otomatis, n.poin_essay, n.nilai, n.status_koreksi, n.benar, n.salah, n.kosong, n.selesai_pada FROM nilai_ujian n JOIN siswa s ON n.siswa_id = s.id JOIN ujian u ON n.ujian_id = u.id ${filter} ORDER BY n.selesai_pada DESC`, params);
    require('../utils/excelExport')(hasil, res, 'hasil_ujian.xlsx');
});

router.get('/hasil/cetak/:ujianId', async (req, res) => {
    try {
        const [ujian] = await pool.query('SELECT * FROM ujian WHERE id = ?', [req.params.ujianId]);
        if (ujian.length === 0) return res.status(404).send('Ujian tidak ditemukan');
        const [results] = await pool.query(`SELECT s.nis, s.nama as siswa_nama, s.kelas, u.nama_ujian, so.id as soal_id, so.teks_soal, so.tipe_soal, so.jawaban_benar, js.jawaban_dipilih, js.is_benar, n.poin_otomatis, n.poin_essay, n.status_koreksi, n.nilai, n.benar, n.salah, n.kosong, n.selesai_pada FROM nilai_ujian n JOIN siswa s ON n.siswa_id = s.id JOIN ujian u ON n.ujian_id = u.id LEFT JOIN jawaban_siswa js ON js.siswa_id = s.id AND js.ujian_id = u.id LEFT JOIN soal so ON so.id = js.soal_id WHERE n.ujian_id = ? ORDER BY s.nama, so.id`, [req.params.ujianId]);
        const siswaMap = new Map();
        results.forEach(row => {
            if (!siswaMap.has(row.siswa_nama)) siswaMap.set(row.siswa_nama, {
                nis: row.nis,
                nama: row.siswa_nama,
                kelas: row.kelas,
                poin_otomatis: row.poin_otomatis,
                poin_essay: row.poin_essay,
                status_koreksi: row.status_koreksi,
                nilai: row.nilai,
                benar: row.benar,
                salah: row.salah,
                kosong: row.kosong,
                selesai: row.selesai_pada,
                jawaban: []
            });
            if (row.soal_id) siswaMap.get(row.siswa_nama).jawaban.push({ soal_id: row.soal_id, teks_soal: row.teks_soal, tipe: row.tipe_soal, jawaban_benar: row.jawaban_benar, jawaban_siswa: row.jawaban_dipilih, is_benar: row.is_benar });
        });
        res.render('admin/cetak_hasil', { ujian: ujian[0], siswaList: Array.from(siswaMap.values()) });
    } catch (err) { console.error(err); res.status(500).send('Terjadi kesalahan'); }
});

module.exports = router;