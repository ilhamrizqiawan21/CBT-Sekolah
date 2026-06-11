const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const { cekWaktuUjian } = require('../utils/helper');

// ─────────────────────────────────────────────
// FIX #3 — Rate limiter in-memory
// Maks 60 request /simpan-jawaban per menit per siswa
// ─────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_MAX    = 60;
const RATE_LIMIT_WINDOW = 60 * 1000;

function checkRateLimit(siswa_id) {
    const now   = Date.now();
    const entry = rateLimitMap.get(siswa_id);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(siswa_id, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap.entries()) {
        if (now > val.resetAt) rateLimitMap.delete(key);
    }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────
// FIX #11 — Seed acak soal & pilihan disimpan
// di memory server per siswa+ujian.
//
// Masalah sebelumnya: setiap kali loadSoal()
// dipanggil (termasuk saat reload), Math.random()
// menghasilkan urutan baru sehingga:
//   a) Siswa bisa reload untuk "ngulang dari awal"
//   b) Urutan soal tidak konsisten selama ujian
//
// Solusi: seed disimpan di seedMap.
// Seed dibuat SEKALI saat siswa pertama kali
// mengakses soal, lalu dipakai ulang di reload.
//
// Implementasi shuffle deterministik (seeded):
// menggunakan algoritma Mulberry32 — ringan,
// tidak butuh library tambahan.
// ─────────────────────────────────────────────
const seedMap = new Map(); // key: `${siswa_id}_${ujian_id}` → seed number

function mulberry32(seed) {
    // Seeded PRNG — mengembalikan fungsi random() yang deterministik
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function seededShuffle(array, rng) {
    // Fisher-Yates dengan seeded random
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getSeed(siswa_id, ujian_id) {
    const key = `${siswa_id}_${ujian_id}`;
    if (!seedMap.has(key)) {
        // Buat seed baru — kombinasi timestamp + random agar unik per siswa
        const seed = Math.floor(Math.random() * 2147483647);
        seedMap.set(key, seed);
    }
    return seedMap.get(key);
}

// Bersihkan seed yang sudah tidak diperlukan setiap 2 jam
// (setelah ujian selesai, siswa tidak akan akses lagi)
setInterval(() => {
    // Seed map ringan, cukup clear seluruhnya tiap 2 jam
    // Tidak masalah karena ujian yang sudah selesai tidak bisa diakses ulang
    seedMap.clear();
}, 2 * 60 * 60 * 1000);


// ─────────────────────────────────────────────
// Daftar ujian aktif (tanpa auth — untuk login)
// ─────────────────────────────────────────────
router.get('/daftar-ujian', async (req, res) => {
    const [rows] = await pool.query(
        `SELECT id, nama_ujian FROM ujian
         WHERE tanggal_mulai <= NOW() AND tanggal_selesai >= NOW()`
    );
    res.json(rows);
});


// ─────────────────────────────────────────────
// GET /api/soal/:ujianId
// FIX #1 — SELECT field eksplisit (jawaban_benar
//           tidak dikirim ke client)
// FIX #3 — Validasi ujianId milik session
// FIX #11 — Urutan acak konsisten via seeded RNG
// ─────────────────────────────────────────────
router.get('/soal/:ujianId', async (req, res) => {
    const ujianId  = req.params.ujianId;
    const siswa_id = req.session.siswaId;

    if (!siswa_id) {
        return res.status(401).json({ error: 'Silakan login ulang' });
    }

    // FIX #3 — ujianId harus cocok dengan session
    if (parseInt(ujianId) !== req.session.ujianId) {
        return res.status(403).json({ error: 'Akses ujian tidak diizinkan' });
    }

    const isValid = await cekWaktuUjian(ujianId);
    if (!isValid) {
        return res.status(403).json({ error: 'Ujian sudah berakhir atau belum dimulai' });
    }

    try {
        // FIX #1 — Tidak SELECT *, hanya kolom yang dibutuhkan client
        // jawaban_benar tidak diambil di sini
        let [soal] = await pool.query(
            `SELECT id, tipe_soal, teks_soal, gambar, poin,
                    pilihan_a, pilihan_b, pilihan_c, pilihan_d,
                    opsi_tambahan
             FROM soal WHERE ujian_id = ?`,
            [ujianId]
        );

        if (soal.length === 0) {
            return res.status(404).json({ error: 'Soal tidak ditemukan' });
        }

        const [ujianRow] = await pool.query(
            `SELECT acak_soal, acak_pilihan FROM ujian WHERE id = ?`,
            [ujianId]
        );
        const acakSoal    = ujianRow[0]?.acak_soal    == 1;
        const acakPilihan = ujianRow[0]?.acak_pilihan == 1;

        // FIX #11 — Ambil seed yang sudah ada atau buat baru
        // Seed SAMA untuk siswa yang sama di ujian yang sama
        const seed = getSeed(siswa_id, ujianId);
        const rng  = mulberry32(seed);

        if (acakSoal) {
            soal = seededShuffle(soal, rng);
        }

        const soalFormatted = soal.map(s => {
            // FIX #1 — Bangun objek eksplisit, tidak ada spread yang bisa bocorkan field
            const result = {
                id:        s.id,
                tipe:      s.tipe_soal,
                teks_soal: s.teks_soal,
                poin:      s.poin,
                gambar:    s.gambar || null
            };

            if (s.tipe_soal === 'pg') {
                let pilihan = [
                    { key: 'A', text: s.pilihan_a },
                    { key: 'B', text: s.pilihan_b },
                    { key: 'C', text: s.pilihan_c },
                    { key: 'D', text: s.pilihan_d }
                ];
                if (acakPilihan) {
                    // FIX #11 — Seed pilihan pakai seed yang sama + offset soal.id
                    // agar urutan pilihan tiap soal berbeda tapi konsisten
                    const rngPilihan = mulberry32(seed ^ s.id);
                    pilihan = seededShuffle(pilihan, rngPilihan);
                }
                result.pilihan = pilihan;
            }
            else if (s.tipe_soal === 'menjodohkan') {
                try {
                    const opsi = JSON.parse(s.opsi_tambahan || '{}');
                    result.pasangan = opsi.pasangan || [];
                    result.pengecoh = opsi.pengecoh || [];
                } catch {
                    result.pasangan = [];
                    result.pengecoh = [];
                }
            }
            // Essay: tidak ada field tambahan yang perlu dikirim ke client

            return result;
        });

        res.json(soalFormatted);

    } catch (err) {
        console.error('GET /soal error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// ─────────────────────────────────────────────
// POST /api/simpan-jawaban
// FIX #2 — Tidak ada data jawaban di response
// FIX #3 — Rate limit + validasi soal milik ujian
// ─────────────────────────────────────────────
router.post('/simpan-jawaban', async (req, res) => {
    const { ujian_id, soal_id, jawaban } = req.body;

    if (!req.session.siswaId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const siswa_id = req.session.siswaId;

    // FIX #3 — ujian_id harus cocok dengan session
    if (parseInt(ujian_id) !== req.session.ujianId) {
        return res.status(403).json({ error: 'Ujian tidak sesuai' });
    }

    // FIX #3 — Rate limit
    if (!checkRateLimit(siswa_id)) {
        return res.status(429).json({ error: 'Terlalu banyak permintaan. Tunggu sebentar.' });
    }

    const isValid = await cekWaktuUjian(ujian_id);
    if (!isValid) {
        return res.status(403).json({ error: 'Waktu ujian habis' });
    }

    if (!soal_id || jawaban === undefined || jawaban === null) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    try {
        // FIX #3 — Validasi soal_id MILIK ujian_id ini
        const [soal] = await pool.query(
            `SELECT tipe_soal, jawaban_benar, opsi_tambahan
             FROM soal WHERE id = ? AND ujian_id = ?`,
            [soal_id, ujian_id]
        );

        if (soal.length === 0) {
            return res.status(404).json({ error: 'Soal tidak ditemukan' });
        }

        let isBenar = 0;
        const tipe  = soal[0].tipe_soal;

        if (tipe === 'pg') {
            isBenar = (jawaban === soal[0].jawaban_benar) ? 1 : 0;
        }
        else if (tipe === 'menjodohkan') {
            try {
                const jawabanUser  = JSON.parse(jawaban || '[]');
                const jawabanBenar = JSON.parse(soal[0].jawaban_benar || '[]');
                isBenar = JSON.stringify(jawabanUser.sort()) === JSON.stringify(jawabanBenar.sort()) ? 1 : 0;
            } catch { isBenar = 0; }
        }
        else if (tipe === 'essay') {
            try {
                const opsi      = JSON.parse(soal[0].opsi_tambahan || '{}');
                const kataKunci = opsi.kata_kunci || [];
                if (kataKunci.length === 0) {
                    isBenar = 0;
                } else {
                    const jawabanLower = String(jawaban).toLowerCase();
                    const cocok = kataKunci.filter(k => jawabanLower.includes(k.toLowerCase())).length;
                    isBenar = (cocok / kataKunci.length) >= 0.6 ? 1 : 0;
                }
            } catch { isBenar = 0; }
        }

        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               jawaban_dipilih = VALUES(jawaban_dipilih),
               is_benar        = VALUES(is_benar)`,
            [
                siswa_id, ujian_id, soal_id,
                typeof jawaban === 'object' ? JSON.stringify(jawaban) : String(jawaban),
                isBenar
            ]
        );

        // FIX #2 — Kembalikan hanya flag sukses + soal_id (tanpa jawaban)
        res.json({ success: true, soal_id });

    } catch (err) {
        console.error('POST /simpan-jawaban error:', err);
        res.status(500).json({ error: 'Gagal simpan' });
    }
});


// ─────────────────────────────────────────────
// POST /api/selesai-ujian
// FIX #10 — Endpoint ini WAJIB dipanggil oleh
// client sebelum emit socket 'selesai-ujian'.
// Setelah nilai tersimpan, seed siswa dihapus
// dari seedMap (ujian sudah selesai).
// ─────────────────────────────────────────────
router.post('/selesai-ujian', async (req, res) => {
    if (!req.session.siswaId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const siswa_id = req.session.siswaId;
    const ujian_id = req.session.ujianId;

    const isValid = await cekWaktuUjian(ujian_id);
    if (!isValid) {
        return res.status(403).json({ error: 'Waktu ujian habis' });
    }

    try {
        const [jawaban] = await pool.query(
            `SELECT is_benar FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?`,
            [siswa_id, ujian_id]
        );
        const [totalSoalRow] = await pool.query(
            `SELECT COUNT(*) as total, SUM(poin) as total_poin FROM soal WHERE ujian_id = ?`,
            [ujian_id]
        );
        const total     = totalSoalRow[0].total;
        const totalPoin = totalSoalRow[0].total_poin || total;

        const benar  = jawaban.filter(j => j.is_benar === 1).length;
        const salah  = jawaban.filter(j => j.is_benar === 0).length;
        const kosong = total - (benar + salah);
        const nilai  = totalPoin > 0 ? Math.round((benar / total) * 100) : 0;

        await pool.query(
            `INSERT INTO nilai_ujian (siswa_id, ujian_id, nilai, benar, salah, kosong, selesai_pada)
             VALUES (?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               nilai        = VALUES(nilai),
               benar        = VALUES(benar),
               salah        = VALUES(salah),
               kosong       = VALUES(kosong),
               selesai_pada = NOW()`,
            [siswa_id, ujian_id, nilai, benar, salah, kosong]
        );

        // FIX #11 — Hapus seed dari map karena ujian sudah selesai
        seedMap.delete(`${siswa_id}_${ujian_id}`);

        res.json({ nilai, benar, salah, kosong });

    } catch (err) {
        console.error('POST /selesai-ujian error:', err);
        res.status(500).json({ error: 'Gagal simpan nilai' });
    }
});


// ─────────────────────────────────────────────
// GET /api/cek-status-ujian
// FIX #4 — Polling fallback server-side
// Dipanggil ujian.js setiap 15 detik
// ─────────────────────────────────────────────
router.get('/cek-status-ujian', async (req, res) => {
    if (!req.session.siswaId || !req.session.ujianId) {
        return res.status(401).json({ valid: false, reason: 'not_logged_in' });
    }

    const siswa_id = req.session.siswaId;
    const ujian_id = req.session.ujianId;

    try {
        const isValid = await cekWaktuUjian(ujian_id);
        if (!isValid) {
            return res.json({ valid: false, reason: 'waktu_habis' });
        }

        const [sesiRow] = await pool.query(
            `SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?`,
            [siswa_id, ujian_id]
        );

        if (sesiRow.length > 0 && sesiRow[0].status === 'keluar_paksa') {
            return res.json({ valid: false, reason: 'keluar_paksa' });
        }

        const [countRow] = await pool.query(
            `SELECT COUNT(*) AS jumlah FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ?`,
            [siswa_id, ujian_id]
        );
        const [ujianRow] = await pool.query(
            `SELECT batas_pelanggaran FROM ujian WHERE id = ?`,
            [ujian_id]
        );
        const batas  = ujianRow[0]?.batas_pelanggaran || 3;
        const jumlah = countRow[0].jumlah;

        res.json({
            valid:               true,
            jumlah_pelanggaran:  jumlah,
            batas,
            sisa:                Math.max(0, batas - jumlah)
        });

    } catch (err) {
        console.error('GET /cek-status-ujian error:', err);
        res.status(500).json({ valid: false, reason: 'server_error' });
    }
});

module.exports = router;