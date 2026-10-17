const defaultPool = require('../models/db');
const logger = require('../utils/logger');

/**
 * Catat satu aksi CRUD admin ke log_aktivitas_admin.
 * Kegagalan logging tidak boleh menggagalkan aksi utama admin, jadi
 * error di sini hanya dicatat ke logger, tidak dilempar ke pemanggil.
 *
 * @param {number|null} adminId
 * @param {'tambah'|'edit'|'hapus'} aksi
 * @param {string} entitas nama tabel/entitas, misal 'guru', 'siswa', 'soal'
 * @param {number|string|null} entitasId
 * @param {string} detail ringkasan singkat yang mudah dibaca
 * @param {import('mysql2/promise').Pool} pool
 */
async function catatAktivitas(adminId, aksi, entitas, entitasId, detail, pool = defaultPool) {
    try {
        await pool.query(
            'INSERT INTO log_aktivitas_admin (admin_id, aksi, entitas, entitas_id, detail) VALUES (?, ?, ?, ?, ?)',
            [adminId || null, aksi, entitas, entitasId || null, detail || null]
        );
    } catch (err) {
        logger.error(`Gagal mencatat log aktivitas admin (${aksi} ${entitas}): ${err.message}`);
    }
}

module.exports = { catatAktivitas };
