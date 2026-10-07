const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const {
    TEST_DB_NAME,
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('Database Uji & Autentikasi Siswa (cbt_sekolah_test)', () => {
    let pool;
    let seeded;

    before(async () => {
        pool = getTestPool();
        // Pastikan kita selalu berada di database test
        const [dbRow] = await pool.query('SELECT DATABASE() AS current_db');
        assert.strictEqual(dbRow[0].current_db, TEST_DB_NAME, 'Harus terhubung ke database test!');
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
    });

    test('DB Uji memuat tabel yang diperlukan', async () => {
        const [tables] = await pool.query('SHOW TABLES');
        assert.ok(tables.length >= 12, 'Jumlah tabel harus minimal 12');
    });

    test('Data sintetis berhasil di-seed dengan benar', async () => {
        const [siswa] = await pool.query('SELECT * FROM siswa WHERE nis = ?', ['T0001']);
        assert.strictEqual(siswa.length, 1);
        assert.strictEqual(siswa[0].nama, 'Siswa Test 1');
        assert.strictEqual(siswa[0].kelas, 'X-A');

        const isPinValid = await bcrypt.compare('1234', siswa[0].pin_ujian);
        assert.strictEqual(isPinValid, true, 'PIN hash harus cocok dengan 1234');
    });

    test('Validasi login siswa: PIN benar & kelas cocok', async () => {
        const [siswaRows] = await pool.query('SELECT * FROM siswa WHERE nis = ?', ['T0001']);
        const siswa = siswaRows[0];

        // 1. PIN Benar
        const match = await bcrypt.compare('1234', siswa.pin_ujian);
        assert.strictEqual(match, true);

        // 2. Kelas Cocok dengan Ujian
        const [ujianRows] = await pool.query(
            `SELECT u.id, k.nama_kelas
             FROM ujian u
             JOIN pengajaran p ON u.pengajaran_id = p.id
             JOIN kelas k ON p.kelas_id = k.id
             WHERE u.id = ?`,
            [seeded.ujianId]
        );
        assert.strictEqual(ujianRows.length, 1);
        assert.strictEqual(siswa.kelas, ujianRows[0].nama_kelas);
    });

    test('Validasi login siswa: ditolak jika PIN salah', async () => {
        const [siswaRows] = await pool.query('SELECT * FROM siswa WHERE nis = ?', ['T0001']);
        const match = await bcrypt.compare('wrong_pin', siswaRows[0].pin_ujian);
        assert.strictEqual(match, false);
    });

    test('Validasi login siswa: ditolak jika kelas tidak cocok dengan ujian', async () => {
        // Siswa T0002 berada di kelas X-B, sedangkan ujian adalah kelas X-A
        const [siswaRows] = await pool.query('SELECT * FROM siswa WHERE nis = ?', ['T0002']);
        const siswa = siswaRows[0];
        assert.strictEqual(siswa.kelas, 'X-B');

        const [ujianRows] = await pool.query(
            `SELECT u.id, k.nama_kelas
             FROM ujian u
             JOIN pengajaran p ON u.pengajaran_id = p.id
             JOIN kelas k ON p.kelas_id = k.id
             WHERE u.id = ?`,
            [seeded.ujianId]
        );
        assert.notStrictEqual(siswa.kelas, ujianRows[0].nama_kelas);
    });
});
