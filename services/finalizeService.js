const defaultPool = require('../models/db');
const { DEFAULT_GRACE_DETIK } = require('./sesiService');

/**
 * Menghitung ulang nilai dari jawaban_siswa + nilai_essay dan menyimpannya ke
 * nilai_ujian (idempoten). TIDAK mengubah status sesi_ujian — aman dipanggil
 * untuk sesi yang masih berjalan (mis. setelah guru menyimpan nilai essay).
 */
async function hitungUlangNilai(siswaId, ujianId, db = defaultPool) {
    // 2. Ambil soal ujian lengkap
    const [soalRows] = await db.query(
        'SELECT id, tipe_soal, poin, jawaban_benar FROM soal WHERE ujian_id = ?',
        [ujianId]
    );

    // 3. Ambil jawaban siswa
    const [jawabanRows] = await db.query(
        'SELECT soal_id, jawaban_dipilih FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?',
        [siswaId, ujianId]
    );
    const jawabanMap = {};
    for (const j of jawabanRows) {
        jawabanMap[j.soal_id] = j.jawaban_dipilih;
    }

    // 4. Ambil skor essay (jika sudah dinilai guru)
    const [essayRows] = await db.query(
        'SELECT soal_id, skor FROM nilai_essay WHERE siswa_id = ? AND ujian_id = ?',
        [siswaId, ujianId]
    );
    const skorEssay = {};
    for (const e of essayRows) {
        skorEssay[e.soal_id] = e.skor;
    }

    // 5. Hitung menggunakan penilaianService (DESIGN §3.5, T3.2, T3.4)
    const penilaianService = require('./penilaianService');
    const hasil = penilaianService.hitung({
        soalList: soalRows,
        jawabanMap,
        skorEssay
    });

    // 6. Simpan nilai_ujian (idempoten via ON DUPLICATE KEY UPDATE)
    await db.query(
        `INSERT INTO nilai_ujian (siswa_id, ujian_id, poin_otomatis, poin_essay, poin_maks, nilai, benar, salah, kosong, status_koreksi, selesai_pada)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           poin_otomatis  = VALUES(poin_otomatis),
           poin_essay     = VALUES(poin_essay),
           poin_maks      = VALUES(poin_maks),
           nilai          = VALUES(nilai),
           benar          = VALUES(benar),
           salah          = VALUES(salah),
           kosong         = VALUES(kosong),
           status_koreksi = VALUES(status_koreksi),
           selesai_pada   = COALESCE(selesai_pada, NOW())`,
        [
            siswaId,
            ujianId,
            hasil.poin_otomatis,
            hasil.poin_essay,
            hasil.poin_maks,
            hasil.nilai,
            hasil.benar,
            hasil.salah,
            hasil.kosong,
            hasil.status_koreksi
        ]
    );

    return {
        siswaId,
        ujianId,
        poin_otomatis: hasil.poin_otomatis,
        poin_essay: hasil.poin_essay,
        poin_maks: hasil.poin_maks,
        nilai: hasil.nilai,
        benar: hasil.benar,
        salah: hasil.salah,
        kosong: hasil.kosong,
        status_koreksi: hasil.status_koreksi,
        totalSoal: soalRows.length
    };
}

/**
 * Memfinalisasi satu sesi ujian siswa (DESIGN §3.4, §3.5, T1.8):
 * - Menghitung nilai (hitungUlangNilai) dan menyimpannya ke nilai_ujian
 * - Mengubah status sesi_ujian menjadi 'selesai' dan mengisi 'selesai_pada'
 */
async function finalizeSesi(siswaId, ujianId, db = defaultPool) {
    const hasil = await hitungUlangNilai(siswaId, ujianId, db);
    await db.query(
        `UPDATE sesi_ujian
         SET status = 'selesai',
             selesai_pada = COALESCE(selesai_pada, NOW())
         WHERE siswa_id = ? AND ujian_id = ?`,
        [siswaId, ujianId]
    );
    return hasil;
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
    hitungUlangNilai,
    finalizeSesi,
    tutupSesiKadaluarsa,
    startAutoFinalizeJob
};

