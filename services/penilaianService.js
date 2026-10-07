/**
 * services/penilaianService.js
 * Logika murni penilaian ujian CBT (DESIGN §3.5, PRD, T3.2)
 */

/**
 * Menilai satu jawaban PG.
 * Benar jika jawaban sama persis dengan jawaban_benar (case-insensitive).
 */
function cekJawabanPG(jawabanUser, jawabanBenar) {
    if (jawabanUser === undefined || jawabanUser === null) return false;
    const jUser = String(jawabanUser).trim().toUpperCase();
    const jBenar = String(jawabanBenar || '').trim().toUpperCase();
    return jUser.length > 0 && jUser === jBenar;
}

/**
 * Menilai satu jawaban Menjodohkan (all-or-nothing, D-006, PRD, DESIGN §3.5).
 * Semua pasangan harus cocok persis. Jika salah satu pasangan salah, bernilai 0.
 */
function cekJawabanMenjodohkan(jawabanUser, jawabanBenar) {
    try {
        const jUser = typeof jawabanUser === 'string' ? JSON.parse(jawabanUser || '[]') : (jawabanUser || []);
        const jBenar = typeof jawabanBenar === 'string' ? JSON.parse(jawabanBenar || '[]') : (jawabanBenar || []);
        if (!Array.isArray(jUser) || !Array.isArray(jBenar)) return false;
        if (jUser.length !== jBenar.length || jBenar.length === 0) return false;

        // Normalisasi: urutan pasangan dan urutan key objek tidak berpengaruh
        const norm = arr => arr
            .map(p => JSON.stringify([String(p && p.kiri).trim(), String(p && p.kanan).trim()]))
            .sort();
        return JSON.stringify(norm(jUser)) === JSON.stringify(norm(jBenar));
    } catch {
        return false;
    }
}

/**
 * Menghitung penilaian ujian secara murni (pure function):
 * @param {Object} params
 * @param {Array}  params.soalList     Array of { id, tipe_soal, poin, jawaban_benar }
 * @param {Object|Map} params.jawabanMap Map / object: { [soal_id]: jawaban_dipilih }
 * @param {Object|Map} params.skorEssay  Map / object: { [soal_id]: skor (0..poin) }
 *
 * @returns {Object} {
 *   poin_otomatis: number,
 *   poin_essay: number,
 *   poin_maks: number,
 *   nilai: number (0..100),
 *   benar: number,
 *   salah: number,
 *   kosong: number,
 *   status_koreksi: 'menunggu_essay' | 'selesai',
 *   detailPerSoal: Array
 * }
 */
function hitung({ soalList = [], jawabanMap = {}, skorEssay = {} }) {
    let poinOtomatis = 0;
    let poinEssay = 0;
    let poinMaks = 0;
    let benar = 0;
    let salah = 0;
    let kosong = 0;

    let adaEssayBelumDinilai = false;
    const detailPerSoal = [];

    // Helper untuk mengambil jawaban & skor
    const getJawaban = sid => (jawabanMap instanceof Map ? jawabanMap.get(sid) : jawabanMap[sid]);
    const getSkorEssay = sid => (skorEssay instanceof Map ? skorEssay.get(sid) : skorEssay[sid]);

    for (const soal of soalList) {
        const sid = soal.id;
        const tipe = soal.tipe_soal;
        const maxPoin = parseInt(soal.poin, 10) || (tipe === 'essay' ? 4 : 2);
        poinMaks += maxPoin;

        const jUser = getJawaban(sid);

        if (tipe === 'pg') {
            const isDijawab = jUser !== undefined && jUser !== null && String(jUser).trim() !== '';
            if (!isDijawab) {
                kosong++;
                detailPerSoal.push({ soal_id: sid, tipe, is_benar: 0, poin_didapat: 0, status: 'kosong' });
            } else if (cekJawabanPG(jUser, soal.jawaban_benar)) {
                benar++;
                poinOtomatis += maxPoin;
                detailPerSoal.push({ soal_id: sid, tipe, is_benar: 1, poin_didapat: maxPoin, status: 'benar' });
            } else {
                salah++;
                detailPerSoal.push({ soal_id: sid, tipe, is_benar: 0, poin_didapat: 0, status: 'salah' });
            }
        }
        else if (tipe === 'menjodohkan') {
            const isDijawab = jUser !== undefined && jUser !== null && String(jUser).trim() !== '' && String(jUser).trim() !== '[]';
            if (!isDijawab) {
                kosong++;
                detailPerSoal.push({ soal_id: sid, tipe, is_benar: 0, poin_didapat: 0, status: 'kosong' });
            } else if (cekJawabanMenjodohkan(jUser, soal.jawaban_benar)) {
                benar++;
                poinOtomatis += maxPoin;
                detailPerSoal.push({ soal_id: sid, tipe, is_benar: 1, poin_didapat: maxPoin, status: 'benar' });
            } else {
                salah++;
                detailPerSoal.push({ soal_id: sid, tipe, is_benar: 0, poin_didapat: 0, status: 'salah' });
            }
        }
        else if (tipe === 'essay') {
            const skor = getSkorEssay(sid);
            if (skor === undefined || skor === null) {
                adaEssayBelumDinilai = true;
                detailPerSoal.push({ soal_id: sid, tipe, skor: null, poin_didapat: 0, status: 'menunggu_koreksi' });
            } else {
                const skorNum = Math.max(0, Math.min(maxPoin, parseInt(skor, 10) || 0));
                poinEssay += skorNum;
                detailPerSoal.push({ soal_id: sid, tipe, skor: skorNum, poin_didapat: skorNum, status: 'dinilai' });
            }
        }
    }

    const totalDidapat = poinOtomatis + poinEssay;
    const nilaiAkhir = poinMaks > 0 ? Math.round((totalDidapat / poinMaks) * 100) : 0;
    const statusKoreksi = adaEssayBelumDinilai ? 'menunggu_essay' : 'selesai';

    return {
        poin_otomatis: poinOtomatis,
        poin_essay: poinEssay,
        poin_maks: poinMaks,
        nilai: nilaiAkhir,
        benar,
        salah,
        kosong,
        status_koreksi: statusKoreksi,
        detailPerSoal
    };
}

module.exports = {
    hitung,
    cekJawabanPG,
    cekJawabanMenjodohkan
};
