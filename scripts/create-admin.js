// Membuat atau mereset akun admin untuk produksi (tanpa data contoh).
// Pakai: npm run create-admin -- --username=admin [--reset]
// Password dibaca dari prompt tersembunyi, atau dari env ADMIN_PASSWORD (non-interaktif).
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const readline = require('readline');
require('dotenv').config();

const MIN_PASSWORD = 8;

async function buatAdmin({ username, password, reset = false }, db) {
    username = String(username || '').trim();
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
        throw new Error('Username harus 3–50 karakter (huruf, angka, titik, garis bawah, strip)');
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        throw new Error(`Password minimal ${MIN_PASSWORD} karakter`);
    }
    if (password.toLowerCase() === 'admin123') {
        throw new Error('Password terlalu mudah ditebak');
    }

    const hash = await bcrypt.hash(password, 10);
    const [rows] = await db.query('SELECT id FROM admin WHERE username = ?', [username]);
    if (rows.length > 0) {
        if (!reset) throw new Error(`Admin "${username}" sudah ada. Tambahkan --reset untuk mengganti passwordnya`);
        await db.query('UPDATE admin SET password = ? WHERE id = ?', [hash, rows[0].id]);
        return { aksi: 'reset', username };
    }
    await db.query('INSERT INTO admin (username, password) VALUES (?, ?)', [username, hash]);
    return { aksi: 'dibuat', username };
}

function tanyaPassword(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const write = rl._writeToOutput;
        rl._writeToOutput = (s) => { if (s.includes(prompt)) write.call(rl, s); };
        rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    });
}

async function main() {
    const args = process.argv.slice(2);
    const arg = (name) => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
    const username = arg('username') || 'admin';
    const reset = args.includes('--reset');

    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
        password = await tanyaPassword('Password admin baru: ');
        const ulang = await tanyaPassword('Ulangi password     : ');
        if (password !== ulang) throw new Error('Password tidak sama');
    }

    const config = { user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME };
    if (process.env.DB_SOCKET) config.socketPath = process.env.DB_SOCKET;
    else {
        config.host = process.env.DB_HOST || '127.0.0.1';
        if (process.env.DB_PORT) config.port = Number(process.env.DB_PORT);
    }
    const db = await mysql.createConnection(config);
    try {
        const hasil = await buatAdmin({ username, password, reset }, db);
        console.log(`[ADMIN] Akun "${hasil.username}" ${hasil.aksi === 'dibuat' ? 'berhasil dibuat' : 'passwordnya berhasil direset'}.`);
    } finally {
        await db.end();
    }
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((err) => {
        console.error(`[ADMIN] Gagal: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { buatAdmin };
