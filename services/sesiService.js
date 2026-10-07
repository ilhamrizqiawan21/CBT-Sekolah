const crypto = require('crypto');
const defaultPool = require('../models/db');
require('dotenv').config();

const DEFAULT_GRACE_DETIK = parseInt(process.env.GRACE_PERIOD_DETIK, 10) || 120;

/**
 * Menghitung batas waktu ujian.
 * batas_waktu = waktu_mulai + durasi + tambahan_menit,
 * tidak melewati ujian.tanggal_selesai (D-007).
 */
function hitungBatasWaktu(waktuMulai, durasiMenit, tambahanMenit = 0, tanggalSelesaiUjian = null) {
    const startMs = new Date(waktuMulai).getTime();
    let batasMs = startMs + (durasiMenit + tambahanMenit) * 60 * 1000;

    if (tanggalSelesaiUjian) {
        const selesaiUjianMs = new Date(tanggalSelesaiUjian).getTime();
        if (batasMs > selesaiUjianMs) {
            batasMs = selesaiUjianMs;
        }
    }

    return new Date(batasMs);
}

/**
 * Menghitung sisa waktu dalam detik.
 * Server-authoritative: sisa_detik = max(0, batas_waktu - now).
 */
function hitungSisaDetik(sesi, now = new Date()) {
    if (!sesi || !sesi.batas_waktu) return 0;
    const batasMs = new Date(sesi.batas_waktu).getTime();
    const nowMs = new Date(now).getTime();
    return Math.max(0, Math.floor((batasMs - nowMs) / 1000));
}

/**
 * Memvalidasi apakah jawaban boleh diterima oleh server.
 * - Tolak jika status sesi keluar_paksa atau selesai.
 * - Jika now <= batas_waktu: terima.
 * - Jika now > batas_waktu tetapi now <= batas_waktu + grace:
 *     hanya terima jika clientTs <= batas_waktu.
 * - Jika now > batas_waktu + grace: tolak.
 */
function bolehTerimaJawaban(sesi, clientTs, now = new Date(), configGraceDetik = null) {
    const graceDetik = configGraceDetik !== null ? configGraceDetik : DEFAULT_GRACE_DETIK;

    if (!sesi) {
        return { boleh: false, alasan: 'sesi_tidak_ditemukan' };
    }

    if (sesi.status === 'keluar_paksa') {
        return { boleh: false, alasan: 'keluar_paksa' };
    }

    if (sesi.status === 'selesai') {
        return { boleh: false, alasan: 'selesai' };
    }

    if (sesi.status !== 'sedang_ujian') {
        return { boleh: false, alasan: 'status_tidak_valid' };
    }

    const batasMs = new Date(sesi.batas_waktu).getTime();
    const nowMs = new Date(now).getTime();
    const clientMs = clientTs ? new Date(clientTs).getTime() : nowMs;

    // Normal: server masih dalam batas waktu
    if (nowMs <= batasMs) {
        return { boleh: true, grace: false };
    }

    // Server lewat batas waktu: cek jendela toleransi grace period (D-009)
    const selisihDetik = (nowMs - batasMs) / 1000;
    if (selisihDetik <= graceDetik) {
        if (clientMs <= batasMs) {
            return { boleh: true, grace: true };
        }
        return { boleh: false, alasan: 'client_ts_melewati_batas' };
    }

    return { boleh: false, alasan: 'melewati_grace_period' };
}

/**
 * Mengambil alih sesi yang aktif (mis. siswa login ulang di perangkat baru/tab baru).
 * Menghasilkan device_token baru sehingga perangkat sebelumnya menerima 409.
 */
async function ambilAlih(sesiOrId, deviceType = null, db = defaultPool) {
    const sesiId = typeof sesiOrId === 'object' ? sesiOrId.id : sesiOrId;
    const deviceToken = crypto.randomUUID();

    const [rows] = await db.query('SELECT * FROM sesi_ujian WHERE id = ?', [sesiId]);
    if (rows.length === 0) {
        throw new Error('Sesi ujian tidak ditemukan');
    }
    const sesi = rows[0];

    await db.query(
        `UPDATE sesi_ujian
         SET device_token = ?,
             device_type = COALESCE(?, device_type),
             last_seen = NOW()
         WHERE id = ?`,
        [deviceToken, deviceType, sesiId]
    );

    const [updatedRows] = await db.query('SELECT * FROM sesi_ujian WHERE id = ?', [sesiId]);
    return updatedRows[0];
}

/**
 * Memperpanjang waktu ujian untuk sebuah sesi (mis. oleh aksi admin).
 * Menambahkan menit ke tambahan_menit dan memajukan batas_waktu.
 */
async function perpanjang(sesiOrId, menit, db = defaultPool) {
    const sesiId = typeof sesiOrId === 'object' ? sesiOrId.id : sesiOrId;
    const [rows] = await db.query('SELECT * FROM sesi_ujian WHERE id = ?', [sesiId]);
    if (rows.length === 0) {
        throw new Error('Sesi ujian tidak ditemukan');
    }
    const sesi = rows[0];

    const tambahanMenit = (sesi.tambahan_menit || 0) + parseInt(menit, 10);
    const currentBatas = new Date(sesi.batas_waktu);
    const newBatas = new Date(currentBatas.getTime() + parseInt(menit, 10) * 60 * 1000);

    await db.query(
        `UPDATE sesi_ujian
         SET tambahan_menit = ?,
             batas_waktu = ?
         WHERE id = ?`,
        [tambahanMenit, newBatas, sesiId]
    );

    const [updatedRows] = await db.query('SELECT * FROM sesi_ujian WHERE id = ?', [sesiId]);
    return updatedRows[0];
}

/**
 * Memulai sesi ujian baru atau melanjutkan sesi yang sudah ada.
 */
async function mulaiAtauLanjut(siswaId, ujianId, deviceType = null, db = defaultPool) {
    // 1. Cek sesi yang sudah ada
    const [sesiRows] = await db.query(
        `SELECT s.*, u.durasi, u.tanggal_mulai, u.tanggal_selesai
         FROM sesi_ujian s
         JOIN ujian u ON s.ujian_id = u.id
         WHERE s.siswa_id = ? AND s.ujian_id = ?`,
        [siswaId, ujianId]
    );

    if (sesiRows.length > 0) {
        const sesi = sesiRows[0];
        if (sesi.status === 'keluar_paksa') {
            return {
                status: 'keluar_paksa',
                sesi,
                message: 'Akses ujian Anda telah dicabut karena pelanggaran. Hubungi pengawas.'
            };
        }
        if (sesi.status === 'selesai') {
            return {
                status: 'selesai',
                sesi,
                message: 'Anda sudah menyelesaikan ujian ini.'
            };
        }
        if (sesi.status === 'sedang_ujian') {
            // Ambil alih sesi (take-over)
            const updated = await ambilAlih(sesi.id, deviceType, db);
            return {
                status: 'lanjut',
                takeOver: true,
                sesi: updated
            };
        }
    }

    // 2. Buat sesi baru jika belum ada
    const [ujianRows] = await db.query(
        `SELECT id, durasi, tanggal_mulai, tanggal_selesai
         FROM ujian
         WHERE id = ?`,
        [ujianId]
    );
    if (ujianRows.length === 0) {
        throw new Error('Ujian tidak ditemukan');
    }
    const ujian = ujianRows[0];

    const [[timeRow]] = await db.query('SELECT NOW() AS now');
    const waktuMulai = new Date(timeRow.now);
    const batasWaktu = hitungBatasWaktu(waktuMulai, ujian.durasi, 0, ujian.tanggal_selesai);
    const deviceToken = crypto.randomUUID();
    const seed = crypto.randomInt(1, 2147483647);

    const [insertResult] = await db.query(
        `INSERT INTO sesi_ujian
         (siswa_id, ujian_id, waktu_mulai, batas_waktu, tambahan_menit, seed, device_token, device_type, last_seen, status)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'sedang_ujian')`,
        [siswaId, ujianId, waktuMulai, batasWaktu, seed, deviceToken, deviceType, waktuMulai]
    );

    const [newSesiRows] = await db.query('SELECT * FROM sesi_ujian WHERE id = ?', [insertResult.insertId]);

    return {
        status: 'baru',
        takeOver: false,
        sesi: newSesiRows[0]
    };
}

module.exports = {
    DEFAULT_GRACE_DETIK,
    hitungBatasWaktu,
    hitungSisaDetik,
    bolehTerimaJawaban,
    ambilAlih,
    perpanjang,
    mulaiAtauLanjut
};
