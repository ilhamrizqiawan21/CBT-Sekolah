const defaultPool = require('../models/db');
const { DEFAULT_GRACE_DETIK } = require('./sesiService');

/**
 * Memfinalisasi satu sesi ujian siswa (DESIGN §3.4, §3.5, T1.8):
 * - Menghitung nilai dari jawaban_siswa vs soal
 * - Menyimpan ke tabel nilai_ujian (idempoten)
 * - Mengubah status sesi_ujian menjadi 'selesai' dan mengisi 'selesai_pada'
 */
async function finalizeSesi(siswaId, ujianId, db = defaultPool) {
    // 1. Ambil data sesi
    const [sesiRows] = await db.query(
        'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
        [siswaId, ujianId]
    );

    // 2. Ambil soal ujian
    const [soalRows] = await db.query(
        'SELECT id, poin, tipe_soal FROM soal WHERE ujian_id = ?',
        [ujianId]
    );
    const totalSoal = soalRows.length;
    const totalPoin = soalRows.reduce((sum, s) => sum + (s.poin || 1), 0);

    // 3. Ambil jawaban siswa
    const [jawabanRows] = await db.query(
        'SELECT soal_id, is_benar FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?',
        [siswaId, ujianId]
    );

    let benar = 0;
    let salah = 0;

    for (const j of jawabanRows) {
        if (j.is_benar === 1) {
            benar++;
        } else if (j.is_benar === 0) {
            salah++;
        }
    }

    const kosong = Math.max(0, totalSoal - (benar + salah));
    const nilai = totalSoal > 0 ? Math.round((benar / totalSoal) * 100) : 0;

    // 4. Simpan nilai_ujian (idempoten via ON DUPLICATE KEY UPDATE)
    await db.query(
        `INSERT INTO nilai_ujian (siswa_id, ujian_id, nilai, benar, salah, kosong, selesai_pada)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           nilai        = VALUES(nilai),
           benar        = VALUES(benar),
           salah        = VALUES(salah),
           kosong       = VALUES(kosong),
           selesai_pada = COALESCE(selesai_pada, NOW())`,
        [siswaId, ujianId, nilai, benar, salah, kosong]
    );

    // 5. Perbarui sesi_ujian menjadi 'selesai'
    if (sesiRows.length > 0) {
        await db.query(
            `UPDATE sesi_ujian
             SET status = 'selesai',
                 selesai_pada = COALESCE(selesai_pada, NOW())
             WHERE siswa_id = ? AND ujian_id = ?`,
            [siswaId, ujianId]
        );
    }

    return {
        siswaId,
        ujianId,
        nilai,
        benar,
        salah,
        kosong,
        totalSoal
    };
}

/**
 * Memeriksa dan memfinalisasi seluruh sesi yang telah melewati batas_waktu + grace period (D-009).
 */
async function tutupSesiKadaluarsa(db = defaultPool, graceDetik = null) {
    const grace = graceDetik !== null ? graceDetik : (parseInt(process.env.GRACE_PERIOD_DETIK, 10) || DEFAULT_GRACE_DETIK || 120);

    // Cari sesi berstatus sedang_ujian yang batas_waktu + grace sudah terlewat
    const [expiredSessions] = await db.query(
        `SELECT siswa_id, ujian_id, batas_waktu
         FROM sesi_ujian
         WHERE status = 'sedang_ujian'
           AND batas_waktu IS NOT NULL
           AND NOW() > DATE_ADD(batas_waktu, INTERVAL ? SECOND)`,
        [grace]
    );

    const hasil = [];
    for (const sesi of expiredSessions) {
        try {
            const res = await finalizeSesi(sesi.siswa_id, sesi.ujian_id, db);
            hasil.push(res);
        } catch (err) {
            console.error(`[AUTO-FINALIZE] Gagal memfinalisasi sesi siswa ${sesi.siswa_id} ujian ${sesi.ujian_id}:`, err);
        }
    }

    return hasil;
}

/**
 * Menjalankan interval background job penutupan otomatis (setiap 30 detik).
 */
function startAutoFinalizeJob(db = defaultPool, intervalMs = 30000) {
    const timer = setInterval(async () => {
        try {
            await tutupSesiKadaluarsa(db);
        } catch (err) {
            console.error('[AUTO-FINALIZE JOB ERROR]:', err);
        }
    }, intervalMs);

    if (timer.unref) {
        timer.unref();
    }
    return timer;
}

module.exports = {
    finalizeSesi,
    tutupSesiKadaluarsa,
    startAutoFinalizeJob
};

