const express = require('express');
const router  = express.Router();
const pool    = require('../models/db');
const { cekWaktuUjian } = require('../utils/helper');
const { isSiswaAPI } = require('../middleware/auth');

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
}, 5 * 60 * 1000).unref();

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


// ─────────────────────────────────────────────
// Daftar ujian aktif (tanpa auth — untuk login)
// ─────────────────────────────────────────────
router.get('/daftar-ujian', async (req, res) => {
    const [rows] = await pool.query(
        `SELECT u.id, u.nama_ujian, k.nama_kelas
         FROM ujian u
         JOIN pengajaran p ON u.pengajaran_id = p.id
         JOIN kelas k ON p.kelas_id = k.id
         WHERE u.tanggal_mulai <= NOW() AND u.tanggal_selesai >= NOW()`
    );
    res.json(rows);
});


// ─────────────────────────────────────────────
// GET /api/sesi (DESIGN §4)
// { status, sisa_detik, batas_waktu, jawaban_tersimpan }
// ─────────────────────────────────────────────
router.get('/sesi', isSiswaAPI, async (req, res) => {
    try {
        const siswaId = req.session.siswaId;
        const ujianId = req.session.ujianId;
        const sesiService = require('../services/sesiService');

        const [sesiRows] = await pool.query(
            'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );

        if (sesiRows.length === 0) {
            return res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
        }

        const sesi = sesiRows[0];
        const sisa_detik = sesiService.hitungSisaDetik(sesi, new Date());

        const [jawabanRows] = await pool.query(
            'SELECT soal_id, jawaban_dipilih FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );

        const jawaban_tersimpan = {};
        for (const row of jawabanRows) {
            jawaban_tersimpan[row.soal_id] = row.jawaban_dipilih;
        }

        res.json({
            status: sesi.status,
            sisa_detik,
            batas_waktu: sesi.batas_waktu,
            jawaban_tersimpan
        });
    } catch (err) {
        console.error('GET /api/sesi error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// ─────────────────────────────────────────────
// GET /api/soal/:ujianId
// FIX #1 — SELECT field eksplisit (jawaban_benar
//           tidak dikirim ke client)
// FIX #3 — Validasi ujianId milik session
// FIX #11 — Urutan acak konsisten via seeded RNG
// ─────────────────────────────────────────────
router.get('/soal/:ujianId', isSiswaAPI, async (req, res) => {
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

        // T1.5 — Ambil seed acak persisten dari database sesi_ujian
        const [sesiSeedRows] = await pool.query(
            `SELECT seed FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?`,
            [siswa_id, ujianId]
        );
        let seed = sesiSeedRows[0]?.seed;
        if (!seed) {
            seed = Math.floor(Math.random() * 2147483647);
            await pool.query(
                `UPDATE sesi_ujian SET seed = ? WHERE siswa_id = ? AND ujian_id = ?`,
                [seed, siswa_id, ujianId]
            );
        }
        const rng = mulberry32(seed);

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


function hitungIsBenar(soal, jawaban) {
    if (!soal) return 0;
    const tipe = soal.tipe_soal;
    if (tipe === 'pg') {
        const jUser = String(jawaban !== undefined && jawaban !== null ? jawaban : '').trim().toUpperCase();
        const jBenar = String(soal.jawaban_benar || '').trim().toUpperCase();
        return jUser === jBenar ? 1 : 0;
    }
    if (tipe === 'menjodohkan') {
        try {
            const jUser = typeof jawaban === 'string' ? JSON.parse(jawaban || '[]') : (jawaban || []);
            const jBenar = JSON.parse(soal.jawaban_benar || '[]');
            if (!Array.isArray(jUser) || !Array.isArray(jBenar)) return 0;
            const sortPairs = arr => [...arr].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
            return JSON.stringify(sortPairs(jUser)) === JSON.stringify(sortPairs(jBenar)) ? 1 : 0;
        } catch {
            return 0;
        }
    }
    if (tipe === 'essay') {
        // D-006: Essay dijawab di kertas, dinilai guru per soal (0–4)
        return null;
    }
    return 0;
}

// ─────────────────────────────────────────────
// POST /api/sinkron-jawaban (DESIGN §3.3, §4, T1.6)
// Batch upsert idempoten, validasi soal, timer server
// ─────────────────────────────────────────────
router.post('/sinkron-jawaban', isSiswaAPI, async (req, res) => {
    try {
        const siswa_id = req.session.siswaId;
        const ujian_id = req.session.ujianId;
        const sesiService = require('../services/sesiService');

        const items = Array.isArray(req.body)
            ? req.body
            : (req.body.jawaban || req.body.items || null);

        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'Format data tidak valid, harus berupa array jawaban' });
        }

        // Batasi ukuran batch (maksimal 100)
        if (items.length > 100) {
            return res.status(400).json({ error: 'Ukuran batch melebihi batas maksimal 100 item' });
        }

        if (items.length === 0) {
            return res.json({ success: true, tersinkron: 0, diabaikan: 0, total: 0 });
        }

        // Ambil sesi ujian siswa
        const [sesiRows] = await pool.query(
            'SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswa_id, ujian_id]
        );
        if (sesiRows.length === 0) {
            return res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
        }
        const sesi = sesiRows[0];
        const now = new Date();

        if (sesi.status !== 'sedang_ujian') {
            return res.status(403).json({ error: 'Sesi ujian tidak aktif atau sudah selesai' });
        }

        // Cek apakah waktu server sudah melewati batas_waktu + grace period (D-009)
        const batasMs = new Date(sesi.batas_waktu).getTime();
        const graceMs = (parseInt(process.env.GRACE_PERIOD_DETIK, 10) || sesiService.DEFAULT_GRACE_DETIK || 120) * 1000;
        if (now.getTime() > (batasMs + graceMs)) {
            return res.status(403).json({
                error: 'Waktu ujian telah berakhir dan melewati batas toleransi',
                code: 'waktu_habis'
            });
        }

        // Validasi semua soal_id di batch
        const soalIds = [];
        for (const item of items) {
            if (!item || item.soal_id === undefined || item.soal_id === null || isNaN(parseInt(item.soal_id))) {
                return res.status(400).json({ error: 'Item jawaban tidak lengkap atau soal_id tidak valid' });
            }
            soalIds.push(parseInt(item.soal_id));
        }

        const uniqueSoalIds = [...new Set(soalIds)];
        const [soalRows] = await pool.query(
            `SELECT id, tipe_soal, jawaban_benar, opsi_tambahan
             FROM soal
             WHERE id IN (?) AND ujian_id = ?`,
            [uniqueSoalIds, ujian_id]
        );

        const soalMap = new Map();
        for (const s of soalRows) {
            soalMap.set(s.id, s);
        }

        // Validasi bahwa SEMUA soal_id milik ujian_id ini (soal ujian lain ditolak)
        for (const sid of uniqueSoalIds) {
            if (!soalMap.has(sid)) {
                return res.status(400).json({
                    error: `Soal ID ${sid} tidak ditemukan atau bukan milik ujian ini`
                });
            }
        }

        // Ambil jawaban yang sudah tersimpan saat ini untuk mengecek timestamp
        const [existingJawaban] = await pool.query(
            `SELECT soal_id, jawaban_dipilih, client_ts
             FROM jawaban_siswa
             WHERE siswa_id = ? AND ujian_id = ? AND soal_id IN (?)`,
            [siswa_id, ujian_id, uniqueSoalIds]
        );

        const existingMap = new Map();
        for (const row of existingJawaban) {
            existingMap.set(row.soal_id, row);
        }

        let tersinkronCount = 0;
        let diabaikanCount = 0;

        for (const item of items) {
            const sid = parseInt(item.soal_id);
            const soal = soalMap.get(sid);

            const rawTs = item.client_ts ? new Date(item.client_ts) : now;
            // Klien tidak boleh mengklaim waktu di masa depan (mengunci jawaban berikutnya)
            const clientTs = isNaN(rawTs.getTime()) || rawTs.getTime() > now.getTime() ? now : rawTs;

            // Cek apakah jawaban boleh diterima (timer & grace period)
            const izin = sesiService.bolehTerimaJawaban(sesi, clientTs, now);
            if (!izin.boleh) {
                diabaikanCount++;
                continue;
            }

            // Cek client_ts: timestamp yang lebih lama TIDAK boleh menimpa yang lebih baru
            const existing = existingMap.get(sid);
            if (existing && existing.client_ts) {
                const existingTime = new Date(existing.client_ts).getTime();
                const incomingTime = clientTs.getTime();
                if (incomingTime < existingTime) {
                    diabaikanCount++;
                    continue;
                }
            }

            // Hitung is_benar di sisi server (kunci jawaban tidak dibocorkan)
            const isBenar = hitungIsBenar(soal, item.jawaban);
            const jawabanStr = typeof item.jawaban === 'object'
                ? JSON.stringify(item.jawaban)
                : (item.jawaban !== undefined && item.jawaban !== null ? String(item.jawaban) : '');

            await pool.query(
                `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar, client_ts)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   jawaban_dipilih = VALUES(jawaban_dipilih),
                   is_benar        = VALUES(is_benar),
                   client_ts       = VALUES(client_ts)`,
                [siswa_id, ujian_id, sid, jawabanStr, isBenar, clientTs]
            );

            existingMap.set(sid, {
                soal_id: sid,
                jawaban_dipilih: jawabanStr,
                client_ts: clientTs
            });

            tersinkronCount++;
        }

        // Perbarui last_seen pada sesi_ujian
        await pool.query(
            'UPDATE sesi_ujian SET last_seen = NOW() WHERE id = ?',
            [sesi.id]
        );

        // Berikan respons konfirmasi tanpa membocorkan jawaban_benar / kunci
        res.json({
            success: true,
            tersinkron: tersinkronCount,
            diabaikan: diabaikanCount,
            total: items.length
        });

    } catch (err) {
        console.error('POST /sinkron-jawaban error:', err);
        res.status(500).json({ error: 'Gagal sinkron jawaban' });
    }
});


// ─────────────────────────────────────────────
// POST /api/heartbeat (DESIGN §3.3, §4)
// Perbarui last_seen sesi siswa
// ─────────────────────────────────────────────
router.post('/heartbeat', isSiswaAPI, async (req, res) => {
    try {
        const siswa_id = req.session.siswaId;
        const ujian_id = req.session.ujianId;
        await pool.query(
            'UPDATE sesi_ujian SET last_seen = NOW() WHERE siswa_id = ? AND ujian_id = ?',
            [siswa_id, ujian_id]
        );
        res.json({ success: true, timestamp: new Date() });
    } catch (err) {
        console.error('POST /heartbeat error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});


// ─────────────────────────────────────────────
// POST /api/simpan-jawaban
// FIX #2 — Tidak ada data jawaban di response
// FIX #3 — Rate limit + validasi soal milik ujian
// ─────────────────────────────────────────────
router.post('/simpan-jawaban', isSiswaAPI, async (req, res) => {
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
// POST /api/selesai-ujian (DESIGN §3.4, §3.5, T1.8)
// Finalisasi sesi ujian siswa dan simpan nilai
// ─────────────────────────────────────────────
router.post('/selesai-ujian', isSiswaAPI, async (req, res) => {
    const siswa_id = req.session.siswaId;
    const ujian_id = req.session.ujianId;

    try {
        const { finalizeSesi } = require('../services/finalizeService');
        const hasil = await finalizeSesi(siswa_id, ujian_id, pool);
        res.json(hasil);
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

        const [ujianRow] = await pool.query(
            `SELECT batas_pelanggaran FROM ujian WHERE id = ?`,
            [ujian_id]
        );
        const batas  = ujianRow[0]?.batas_pelanggaran || 3;
        const jumlah = await require('../services/sesiService').hitungPelanggaran(siswa_id, ujian_id, pool);

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