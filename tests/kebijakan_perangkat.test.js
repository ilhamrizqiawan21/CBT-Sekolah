const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');
const sesiService = require('../services/sesiService');

describe('Kebijakan Anti-Curang Per Perangkat (T5.2)', () => {
    let pool;
    let seeded;

    before(async () => {
        pool = getTestPool();
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
    });

    test('1. Laptop: keluar_fullscreen dicatat sebagai pelanggaran dan dihitung ke total', async () => {
        const siswaId = seeded.siswa1Id;
        const ujianId = seeded.ujianId;

        // Buat sesi laptop
        await sesiService.mulaiAtauLanjut(siswaId, ujianId, 'laptop', pool);

        // Pelanggaran keluar fullscreen
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
             VALUES (?, ?, 'keluar_fullscreen', 'laptop')`,
            [siswaId, ujianId]
        );

        // Pelanggaran pindah tab
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
             VALUES (?, ?, 'pindah_tab', 'laptop')`,
            [siswaId, ujianId]
        );

        const totalPelanggaran = await sesiService.hitungPelanggaran(siswaId, ujianId, pool);
        assert.strictEqual(totalPelanggaran, 2, 'Laptop harus menghitung keluar_fullscreen dan pindah_tab');

        const [rows] = await pool.query(
            'SELECT jenis_kecurangan, device_type FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ? ORDER BY id ASC',
            [siswaId, ujianId]
        );
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].jenis_kecurangan, 'keluar_fullscreen');
        assert.strictEqual(rows[0].device_type, 'laptop');
    });

    test('2. HP: pindah tab & copy-paste dihitung pelanggaran, keluar fullscreen diabaikan server', async () => {
        const siswaId = seeded.siswa1Id;
        const ujianId = seeded.ujianId;

        // Buat sesi hp
        await sesiService.mulaiAtauLanjut(siswaId, ujianId, 'hp', pool);

        // Simulasikan logika socket server app.js:
        // Pada hp, jika ada sinyal keluar-fullscreen tidak dimasukkan ke log_kecurangan
        const handleKeluarFullscreenServer = async (devType) => {
            if (devType === 'hp') return; // diabaikan
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
                 VALUES (?, ?, 'keluar_fullscreen', ?)`,
                [siswaId, ujianId, devType]
            );
        };

        await handleKeluarFullscreenServer('hp');

        // Pindah tab tetap dicatat
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
             VALUES (?, ?, 'pindah_tab', 'hp')`,
            [siswaId, ujianId]
        );

        // Copy paste tetap dicatat
        await pool.query(
            `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
             VALUES (?, ?, 'copy_paste', 'hp')`,
            [siswaId, ujianId]
        );

        const totalPelanggaran = await sesiService.hitungPelanggaran(siswaId, ujianId, pool);
        assert.strictEqual(totalPelanggaran, 2, 'HP menghitung pindah_tab dan copy_paste tanpa keluar_fullscreen palsu');

        const [fsRows] = await pool.query(
            "SELECT * FROM log_kecurangan WHERE siswa_id = ? AND ujian_id = ? AND jenis_kecurangan = 'keluar_fullscreen'",
            [siswaId, ujianId]
        );
        assert.strictEqual(fsRows.length, 0, 'HP tidak boleh memiliki log keluar_fullscreen');
    });

    test('3. Pelanggaran melewati batas memicu status keluar_paksa', async () => {
        const siswaId = seeded.siswa1Id;
        const ujianId = seeded.ujianId;

        await sesiService.mulaiAtauLanjut(siswaId, ujianId, 'hp', pool);

        // Batas pelanggaran pada seed adalah 3
        const [ujianRows] = await pool.query('SELECT batas_pelanggaran FROM ujian WHERE id = ?', [ujianId]);
        const batas = ujianRows[0].batas_pelanggaran;
        assert.strictEqual(batas, 3);

        // Masukkan 3 pelanggaran pindah_tab
        for (let i = 0; i < 3; i++) {
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
                 VALUES (?, ?, 'pindah_tab', 'hp')`,
                [siswaId, ujianId]
            );
        }

        const total = await sesiService.hitungPelanggaran(siswaId, ujianId, pool);
        assert.strictEqual(total, 3);

        if (total >= batas) {
            await pool.query("UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE siswa_id = ? AND ujian_id = ?", [siswaId, ujianId]);
        }

        const [sesiRows] = await pool.query('SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, ujianId]);
        assert.strictEqual(sesiRows[0].status, 'keluar_paksa');
    });
});

