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

module.exports = { cekWaktuUjian };