const defaultPool = require('../models/db');

/**
 * Menghitung status turunan untuk antarmuka monitor.
 * Kategori:
 * - 'belum_masuk': belum memiliki baris sesi_ujian
 * - 'selesai': sesi_ujian.status === 'selesai'
 * - 'terkunci': sesi_ujian.status === 'keluar_paksa'
 * - 'online': sesi_ujian.status === 'sedang_ujian' dan last_seen < 45 detik
 * - 'offline': sesi_ujian.status === 'sedang_ujian' dan last_seen >= 45 detik (atau null)
 *
 * @param {Object|null} sesi Baris sesi_ujian atau null
 * @param {Date|string|number} now Waktu acuan server
 * @returns {'online'|'offline'|'selesai'|'terkunci'|'belum_masuk'}
 */
function hitungStatusTurunan(sesi, now = new Date()) {
    if (!sesi) {
        return 'belum_masuk';
    }

    if (sesi.status === 'selesai') {
        return 'selesai';
    }

    if (sesi.status === 'keluar_paksa') {
        return 'terkunci';
    }

    if (sesi.status === 'sedang_ujian') {
        if (!sesi.last_seen) {
            return 'offline';
        }
        const lastSeenMs = new Date(sesi.last_seen).getTime();
        const nowMs = new Date(now).getTime();
        const diffDetik = (nowMs - lastSeenMs) / 1000;

        return (diffDetik >= 0 && diffDetik < 45) ? 'online' : 'offline';
    }

    return 'offline';
}

/**
 * Mengambil snapshot lengkap pemantauan ujian untuk admin:
 * - Detail ujian
 * - Total soal
 * - Ringkasan jumlah siswa per status
 * - Daftar per siswa: status turunan, progres (terjawab/total), pelanggaran aktif, perangkat
 *
 * @param {number} ujianId
 * @param {Object} db Pool / koneksi database
 * @param {Date} now Waktu acuan
 */
async function getMonitorSnapshot(ujianId, db = defaultPool, now = new Date()) {
    // 1. Ambil informasi ujian dan kelas terkait
    const [ujianRows] = await db.query(
        `SELECT u.id, u.nama_ujian, u.durasi, u.tanggal_mulai, u.tanggal_selesai,
                k.id AS kelas_id, k.nama_kelas, p.nama_mapel
         FROM ujian u
         JOIN pengajaran pg ON u.pengajaran_id = pg.id
         JOIN kelas k ON pg.kelas_id = k.id
         JOIN mata_pelajaran p ON pg.mapel_id = p.id
         WHERE u.id = ?`,
        [ujianId]
    );

    if (ujianRows.length === 0) {
        return null;
    }
    const ujian = ujianRows[0];

    // 2. Total soal pada ujian ini
    const [soalCountRows] = await db.query(
        'SELECT COUNT(*) AS total FROM soal WHERE ujian_id = ?',
        [ujianId]
    );
    const totalSoal = parseInt(soalCountRows[0].total, 10) || 0;

    // 3. Seluruh siswa yang terdaftar di kelas ujian ini
    const [siswaRows] = await db.query(
        'SELECT id, nis, nama, kelas FROM siswa WHERE kelas = ? ORDER BY nama ASC',
        [ujian.nama_kelas]
    );

    // 4. Sesi ujian yang ada untuk ujian ini
    const [sesiRows] = await db.query(
        'SELECT * FROM sesi_ujian WHERE ujian_id = ?',
        [ujianId]
    );
    const sesiMap = new Map();
    for (const s of sesiRows) {
        sesiMap.set(s.siswa_id, s);
    }

    // 5. Hitung jumlah soal terjawab per siswa
    const [jawabanRows] = await db.query(
        `SELECT siswa_id, COUNT(DISTINCT soal_id) AS terjawab
         FROM jawaban_siswa
         WHERE ujian_id = ? AND jawaban_dipilih IS NOT NULL AND TRIM(jawaban_dipilih) != ''
         GROUP BY siswa_id`,
        [ujianId]
    );
    const jawabanMap = new Map();
    for (const j of jawabanRows) {
        jawabanMap.set(j.siswa_id, parseInt(j.terjawab, 10) || 0);
    }

    // 6. Hitung pelanggaran aktif per siswa (mengabaikan ambil_alih dan mereset sejak buka_kunci)
    const [pelanggaranRows] = await db.query(
        `SELECT lk.siswa_id, COUNT(*) AS jumlah
         FROM log_kecurangan lk
         WHERE lk.ujian_id = ?
           AND lk.jenis_kecurangan IN ('pindah_tab', 'keluar_fullscreen', 'copy_paste')
           AND lk.id > COALESCE((
               SELECT MAX(id) FROM log_kecurangan bk
               WHERE bk.siswa_id = lk.siswa_id AND bk.ujian_id = ? AND bk.jenis_kecurangan = 'buka_kunci'
           ), 0)
         GROUP BY lk.siswa_id`,
        [ujianId, ujianId]
    );
    const pelanggaranMap = new Map();
    for (const p of pelanggaranRows) {
        pelanggaranMap.set(p.siswa_id, parseInt(p.jumlah, 10) || 0);
    }

    // 7. Bangun ringkasan dan data siswa
    const ringkasan = {
        total_siswa: siswaRows.length,
        online: 0,
        offline: 0,
        selesai: 0,
        terkunci: 0,
        belum_masuk: 0
    };

    const siswa = siswaRows.map(s => {
        const sesi = sesiMap.get(s.id) || null;
        const status = hitungStatusTurunan(sesi, now);
        const terjawab = jawabanMap.get(s.id) || 0;
        const pelanggaran = pelanggaranMap.get(s.id) || 0;

        if (ringkasan[status] !== undefined) {
            ringkasan[status]++;
        }

        return {
            id: s.id,
            nis: s.nis,
            nama: s.nama,
            kelas: s.kelas,
            status,
            progres: {
                terjawab,
                total: totalSoal
            },
            pelanggaran,
            perangkat: sesi ? (sesi.device_type || null) : null,
            sesi_id: sesi ? sesi.id : null,
            last_seen: sesi ? sesi.last_seen : null
        };
    });

    return {
        ujian,
        total_soal: totalSoal,
        ringkasan,
        siswa
    };
}

/**
 * Menyiarkan event monitor:update ke room admin:{ujian_id}.
 * Memperbarui status turunan siswa, progres, pelanggaran, dan perangkat secara real-time.
 */
async function siarkanUpdateSiswa(io, ujianId, siswaId, db = defaultPool, extraData = {}) {
    if (!io || !ujianId || !siswaId) return null;

    // Tidak ada admin yang memantau ujian ini: hindari 4 query per event
    const rooms = io.sockets && io.sockets.adapter && io.sockets.adapter.rooms;
    if (rooms && !rooms.has(`admin:${ujianId}`)) return null;

    try {
        const now = new Date();
        const [sesiRows] = await db.query(
            'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );
        const sesi = sesiRows.length > 0 ? sesiRows[0] : null;
        const status = hitungStatusTurunan(sesi, now);

        const [soalRows] = await db.query(
            'SELECT COUNT(*) AS total FROM soal WHERE ujian_id = ?',
            [ujianId]
        );
        const totalSoal = parseInt(soalRows[0]?.total, 10) || 0;

        const [jawabanRows] = await db.query(
            `SELECT COUNT(DISTINCT soal_id) AS terjawab FROM jawaban_siswa
             WHERE siswa_id = ? AND ujian_id = ? AND jawaban_dipilih IS NOT NULL AND TRIM(jawaban_dipilih) != ''`,
            [siswaId, ujianId]
        );
        const terjawab = parseInt(jawabanRows[0]?.terjawab, 10) || 0;

        const [pelanggaranRows] = await db.query(
            `SELECT COUNT(*) AS jumlah
             FROM log_kecurangan lk
             WHERE lk.siswa_id = ? AND lk.ujian_id = ?
               AND lk.jenis_kecurangan IN ('pindah_tab', 'keluar_fullscreen', 'copy_paste')
               AND lk.id > COALESCE((
                   SELECT MAX(id) FROM log_kecurangan bk
                   WHERE bk.siswa_id = ? AND bk.ujian_id = ? AND bk.jenis_kecurangan = 'buka_kunci'
               ), 0)`,
            [siswaId, ujianId, siswaId, ujianId]
        );
        const pelanggaran = parseInt(pelanggaranRows[0]?.jumlah, 10) || 0;

        const updatePayload = {
            ujian_id: parseInt(ujianId, 10),
            siswa_id: parseInt(siswaId, 10),
            sesi_id: sesi ? sesi.id : null,
            status,
            progres: {
                terjawab,
                total: totalSoal
            },
            pelanggaran,
            perangkat: sesi ? (sesi.device_type || null) : null,
            last_seen: sesi ? sesi.last_seen : null,
            ...extraData
        };

        io.to(`admin:${ujianId}`).emit('monitor:update', updatePayload);
        return updatePayload;
    } catch (err) {
        const logger = require('../utils/logger');
        logger.error(`siarkanUpdateSiswa error: ${err.message}`);
        return null;
    }
}

module.exports = {
    hitungStatusTurunan,
    getMonitorSnapshot,
    siarkanUpdateSiswa
};

