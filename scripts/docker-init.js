// Inisialisasi untuk docker compose: tunggu DB, muat skema bila kosong, migrasi,
// dan (opsional, DEMO_SEED=true) buat data demo dengan kredensial acak yang dicetak ke log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

const config = () => ({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
    multipleStatements: true
});

async function tungguDb(maxDetik = 60) {
    for (let i = 0; i < maxDetik; i++) {
        try {
            const c = await mysql.createConnection(config());
            return c;
        } catch (err) {
            if (i === 0) console.log(`[INIT] Menunggu database (${err.code || err.message})...`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw new Error('Database tidak dapat dihubungi dalam 60 detik');
}

async function main() {
    const db = await tungguDb();
    try {
        const [ada] = await db.query("SHOW TABLES LIKE 'admin'");
        if (ada.length === 0) {
            console.log('[INIT] Database kosong, memuat database/schema.sql');
            // schema.sql berisi CREATE DATABASE/USE cbt_sekolah; ganti ke DB yang dikonfigurasi
            const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8')
                .replace(/^CREATE DATABASE.*?;\s*$/ms, '')
                .replace(/^USE\s+\w+;\s*$/m, '');
            await db.query(sql);
        }
    } finally {
        await db.end();
    }

    await require('./migrate').runMigrations();

    if (process.env.DEMO_SEED === 'true') {
        const cek = await mysql.createConnection(config());
        const [[{ n }]] = await cek.query('SELECT COUNT(*) AS n FROM admin');
        await cek.end();
        if (n > 0) {
            console.log('[INIT] Data demo sudah ada, dilewati (akun demo hanya dicetak saat pertama dibuat)');
            return;
        }

        const prev = process.env.NODE_ENV;
        const log = console.log;
        process.env.NODE_ENV = 'development'; // seed menolak jalan di production
        console.log = () => {}; // sembunyikan pesan seed yang memuat password bawaan
        try {
            await require('./seed').seedDevelopmentData();
        } finally {
            console.log = log;
            process.env.NODE_ENV = prev;
        }
        const rnd = (n) => crypto.randomBytes(n).toString('base64url').slice(0, n);
        const cred = { admin: rnd(10), guru: rnd(10), pin: String(crypto.randomInt(100000, 999999)) };
        const d = await mysql.createConnection(config());
        try {
            await d.query('UPDATE admin SET password = ? WHERE username = ?', [await bcrypt.hash(cred.admin, 10), 'admin']);
            await d.query('UPDATE guru SET password = ? WHERE username = ?', [await bcrypt.hash(cred.guru, 10), 'guru']);
            await d.query("UPDATE siswa SET pin_ujian = ? WHERE nis IN ('1001', '1002')", [await bcrypt.hash(cred.pin, 10)]);
        } finally {
            await d.end();
        }
        console.log('==================== AKUN DEMO ====================');
        console.log(`Admin : admin / ${cred.admin}   (http://localhost:3000/login-admin)`);
        console.log(`Guru  : guru  / ${cred.guru}   (http://localhost:3000/login-guru)`);
        console.log(`Siswa : NIS 1001 atau 1002, PIN ${cred.pin}   (http://localhost:3000/login)`);
        console.log('===================================================');
    }
}

main().catch((err) => {
    console.error('[INIT] Gagal:', err.message);
    process.exit(1);
});
