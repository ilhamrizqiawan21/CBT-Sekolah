// utils/helper.js
const pool = require('../models/db');

async function cekWaktuUjian(ujian_id) {
    try {
        const [rows] = await pool.query(
            `SELECT tanggal_mulai, tanggal_selesai FROM ujian WHERE id = ?`,
            [ujian_id]
        );
        if (rows.length === 0) return false;
        const now = new Date();
        const mulai = new Date(rows[0].tanggal_mulai);
        const selesai = new Date(rows[0].tanggal_selesai);
        return (now >= mulai && now <= selesai);
    } catch (err) {
        console.error('Error cek waktu:', err);
        return false;
    }
}

// Bobot default per tipe soal (D-004): PG 2, menjodohkan 2, essay 4
function poinDefault(tipe, poin) {
    const n = parseInt(poin, 10);
    if (Number.isInteger(n) && n > 0) return n;
    return tipe === 'essay' ? 4 : 2;
}

module.exports = { cekWaktuUjian, poinDefault };