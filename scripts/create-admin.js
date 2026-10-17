// scripts/create-admin.js — buat / reset akun admin untuk produksi
// Pemakaian:
//   node scripts/create-admin.js <username> <password>
//   ADMIN_PASSWORD='...' node scripts/create-admin.js <username>
// Bila username sudah ada, password-nya diganti.
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function buatAdmin(username, password, opsi = {}) {
    if (!username || !/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
        throw new Error('Username 3–50 karakter (huruf, angka, titik, garis bawah, strip)');
    }
    if (!password || password.length < 8) {
        throw new Error('Password minimal 8 karakter');
    }

    const config = {
        user: opsi.user || process.env.DB_USER || 'root',
        password: opsi.password !== undefined ? opsi.password : (process.env.DB_PASSWORD || ''),
        database: opsi.database || process.env.DB_NAME
    };
    if (process.env.DB_SOCKET) config.socketPath = process.env.DB_SOCKET;
    else {
        config.host = process.env.DB_HOST || '127.0.0.1';
        if (process.env.DB_PORT) config.port = Number(process.env.DB_PORT);
    }

    const conn = await mysql.createConnection(config);
    try {
        const hash = await bcrypt.hash(password, 10);
        const [ada] = await conn.query('SELECT id FROM admin WHERE username = ?', [username]);
        if (ada.length > 0) {
            await conn.query('UPDATE admin SET password = ? WHERE id = ?', [hash, ada[0].id]);
            return 'diperbarui';
        }
        await conn.query('INSERT INTO admin (username, password) VALUES (?, ?)', [username, hash]);
        return 'dibuat';
    } finally {
        await conn.end();
    }
}

if (require.main === module) {
    const [username, passwordArg] = process.argv.slice(2);
    const password = passwordArg || process.env.ADMIN_PASSWORD;
    buatAdmin(username, password)
        .then(hasil => { console.log(`[ADMIN] Akun "${username}" berhasil ${hasil}.`); process.exit(0); })
        .catch(err => { console.error('[ADMIN] Gagal:', err.message); process.exit(1); });
}

module.exports = { buatAdmin };
