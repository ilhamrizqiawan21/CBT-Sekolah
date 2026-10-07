const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function runMigrations(options = {}) {
    const targetDb = options.database || (() => {
        const dbArg = process.argv.slice(2).find(a => a.startsWith('--db='));
        return dbArg ? dbArg.split('=')[1] : process.env.DB_NAME;
    })();

    if (!targetDb) {
        throw new Error('Database target tidak ditentukan (cek DB_NAME di .env atau gunakan flag --db=<nama>)');
    }

    const host = options.host || process.env.DB_HOST || '127.0.0.1';
    const user = options.user || process.env.DB_USER || 'root';
    const password = options.password !== undefined ? options.password : (process.env.DB_PASSWORD || '');
    const migrationsDir = options.migrationsDir || path.join(__dirname, '..', 'database', 'migrations');

    console.log(`[MIGRATE] Menjalankan migrasi pada database: ${targetDb}`);

    const connection = await mysql.createConnection({
        host,
        user,
        password,
        database: targetDb,
        multipleStatements: true
    });

    try {
        // 1. Buat tabel schema_migrations jika belum ada
        await connection.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `);

        // 2. Ambil daftar migrasi yang sudah dieksekusi
        const [appliedRows] = await connection.query(`SELECT version FROM schema_migrations`);
        const appliedSet = new Set(appliedRows.map(r => r.version));

        // 3. Baca folder database/migrations
        if (!fs.existsSync(migrationsDir)) {
            fs.mkdirSync(migrationsDir, { recursive: true });
        }

        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        let appliedCount = 0;

        for (const file of files) {
            if (appliedSet.has(file)) {
                continue;
            }

            console.log(`[MIGRATE] Menerapkan migrasi: ${file}...`);
            const filePath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(filePath, 'utf8').trim();

            if (sql.length > 0) {
                await connection.query(sql);
            }

            await connection.query(`INSERT INTO schema_migrations (version) VALUES (?)`, [file]);
            console.log(`[MIGRATE] Selesai: ${file}`);
            appliedCount++;
        }

        if (appliedCount === 0) {
            console.log('[MIGRATE] Database sudah mutakhir. Tidak ada migrasi baru.');
        } else {
            console.log(`[MIGRATE] Berhasil menerapkan ${appliedCount} migrasi.`);
        }

        return { appliedCount, totalFiles: files.length };
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    runMigrations()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('[MIGRATE] Gagal menjalankan migrasi:', err.message);
            process.exit(1);
        });
}

module.exports = { runMigrations };
