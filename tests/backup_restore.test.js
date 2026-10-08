const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const {
    TEST_DB_NAME,
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('T6.2 Backup Database & Pemulihan (scripts/backup.sh)', () => {
    let pool;
    const tempBackupDir = path.join(__dirname, 'temp_backups');
    const backupScript = path.join(__dirname, '..', 'scripts', 'backup.sh');

    before(async () => {
        pool = getTestPool();
        if (fs.existsSync(tempBackupDir)) {
            fs.rmSync(tempBackupDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempBackupDir, { recursive: true });
    });

    after(async () => {
        if (fs.existsSync(tempBackupDir)) {
            fs.rmSync(tempBackupDir, { recursive: true, force: true });
        }
        await cleanDatabase(pool);
        await closeTestPool();
    });

    test('1. Skrip backup menghasilkan berkas .sql.gz valid', async () => {
        await cleanDatabase(pool);
        await seedSyntheticData(pool);

        const stdout = execFileSync(backupScript, [
            `--db=${TEST_DB_NAME}`,
            `--out-dir=${tempBackupDir}`,
            '--keep=5'
        ], { encoding: 'utf8' });

        assert.match(stdout, /\[BACKUP\] Selesai:/);

        const files = fs.readdirSync(tempBackupDir).filter(f => f.endsWith('.sql.gz'));
        assert.strictEqual(files.length, 1, 'Harus ada tepat 1 file backup');

        const stat = fs.statSync(path.join(tempBackupDir, files[0]));
        assert.ok(stat.size > 1000, `Ukuran file backup (${stat.size} bytes) harus > 1000 bytes`);
    });

    test('2. Rotasi backup menghapus backup lama dan mematuhi batas --keep', async () => {
        // Buat backup kedua dan ketiga dengan jeda agar timestamp berbeda
        execFileSync('sleep', ['1']);
        execFileSync(backupScript, [
            `--db=${TEST_DB_NAME}`,
            `--out-dir=${tempBackupDir}`,
            '--keep=2'
        ], { encoding: 'utf8' });

        execFileSync('sleep', ['1']);
        execFileSync(backupScript, [
            `--db=${TEST_DB_NAME}`,
            `--out-dir=${tempBackupDir}`,
            '--keep=2'
        ], { encoding: 'utf8' });

        const files = fs.readdirSync(tempBackupDir).filter(f => f.endsWith('.sql.gz'));
        assert.strictEqual(files.length, 2, 'Harus mempertahankan tepat 2 berkas backup setelah rotasi');
    });

    test('3. Pemulihan (restore) mengembalikan seluruh tabel dan data sintetis ke DB uji', async () => {
        // Ambil file backup terbaru
        const files = fs.readdirSync(tempBackupDir)
            .filter(f => f.endsWith('.sql.gz'))
            .sort();
        const latestBackup = path.join(tempBackupDir, files[files.length - 1]);

        // Bersihkan seluruh data di DB uji
        await cleanDatabase(pool);

        const [tablesEmpty] = await pool.query('SELECT COUNT(*) as cnt FROM siswa');
        assert.strictEqual(tablesEmpty[0].cnt, 0, 'Tabel siswa harus kosong sebelum dipulihkan');

        // Eksekusi pemulihan (restore) via pipe gunzip ke client mariadb / mysql
        const clientBin = execSync('which mariadb 2>/dev/null || which mysql 2>/dev/null', { encoding: 'utf8' }).trim();
        const user = process.env.DB_USER || 'root';
        const pass = process.env.DB_PASSWORD ? `-p${process.env.DB_PASSWORD}` : '';
        const socket = process.env.DB_SOCKET ? `-S ${process.env.DB_SOCKET}` : `-h ${process.env.DB_HOST || '127.0.0.1'}`;

        const restoreCmd = `gunzip -c "${latestBackup}" | "${clientBin}" -u "${user}" ${pass} ${socket} "${TEST_DB_NAME}"`;
        execSync(restoreCmd, { stdio: 'pipe' });

        // Verifikasi bahwa data siswa dan soal berhasil dipulihkan
        const [siswaRows] = await pool.query('SELECT * FROM siswa WHERE nis = ?', ['T0001']);
        assert.strictEqual(siswaRows.length, 1, 'Data siswa T0001 harus berhasil dipulihkan');
        assert.strictEqual(siswaRows[0].nama, 'Siswa Test 1');

        const [soalRows] = await pool.query('SELECT * FROM soal');
        assert.ok(soalRows.length >= 1, 'Data soal harus berhasil dipulihkan');

        const [kelasRows] = await pool.query('SELECT * FROM kelas');
        assert.ok(kelasRows.length >= 2, 'Data kelas harus berhasil dipulihkan');
    });
});

