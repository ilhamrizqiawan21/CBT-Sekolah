const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runMigrations } = require('../scripts/migrate');
const { getTestPool, closeTestPool, TEST_DB_NAME } = require('./helpers/db');

describe('Infrastruktur Migrasi (scripts/migrate.js)', () => {
    let pool;
    const tempMigrationsDir = path.join(__dirname, 'temp_migrations');

    before(async () => {
        pool = getTestPool();
        // Bersihkan tabel schema_migrations di DB test jika ada
        await pool.query('DROP TABLE IF EXISTS schema_migrations');
        await pool.query('DROP TABLE IF EXISTS _test_migration_table');

        if (fs.existsSync(tempMigrationsDir)) {
            fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempMigrationsDir, { recursive: true });
    });

    after(async () => {
        await pool.query('DROP TABLE IF EXISTS _test_migration_table');
        await pool.query('DROP TABLE IF EXISTS schema_migrations');
        if (fs.existsSync(tempMigrationsDir)) {
            fs.rmSync(tempMigrationsDir, { recursive: true, force: true });
        }
        await closeTestPool();
    });

    test('Menjalankan migrasi pertama kali membuat tabel dan mencatat versi', async () => {
        // Buat file migrasi contoh
        const sampleSql = `
            CREATE TABLE IF NOT EXISTS _test_migration_table (
                id INT AUTO_INCREMENT PRIMARY KEY,
                val VARCHAR(50) NOT NULL
            );
        `;
        fs.writeFileSync(path.join(tempMigrationsDir, '000_sample_test.sql'), sampleSql);

        const result1 = await runMigrations({
            database: TEST_DB_NAME,
            migrationsDir: tempMigrationsDir
        });

        assert.strictEqual(result1.appliedCount, 1, 'Harus mencatat 1 migrasi yang diterapkan');

        // Verifikasi tabel terbentuk
        const [tables] = await pool.query("SHOW TABLES LIKE '_test_migration_table'");
        assert.strictEqual(tables.length, 1);

        // Verifikasi tercatat di schema_migrations
        const [rows] = await pool.query("SELECT * FROM schema_migrations WHERE version = '000_sample_test.sql'");
        assert.strictEqual(rows.length, 1);
    });

    test('Menjalankan migrasi kedua kali tidak error dan tidak menerapkan ulang (idempoten)', async () => {
        const result2 = await runMigrations({
            database: TEST_DB_NAME,
            migrationsDir: tempMigrationsDir
        });

        assert.strictEqual(result2.appliedCount, 0, 'Tidak boleh ada migrasi baru yang diterapkan');

        const [rows] = await pool.query("SELECT COUNT(*) AS total FROM schema_migrations WHERE version = '000_sample_test.sql'");
        assert.strictEqual(rows[0].total, 1, 'Migrasi tetap tercatat tepat sekali');
    });
});

