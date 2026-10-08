const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

const TEST_DB_NAME = process.env.DB_NAME_TEST || 'cbt_sekolah_test';
process.env.DB_NAME = TEST_DB_NAME;

let testPool = null;

function getTestPool() {
    if (!testPool) {
        const poolConfig = {
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: TEST_DB_NAME,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        };

        if (process.env.DB_SOCKET) {
            poolConfig.socketPath = process.env.DB_SOCKET;
        } else {
            poolConfig.host = process.env.DB_HOST || '127.0.0.1';
            if (process.env.DB_PORT) {
                poolConfig.port = Number(process.env.DB_PORT);
            }
        }

        testPool = mysql.createPool(poolConfig);
    }
    return testPool;
}

async function cleanDatabase(pool = getTestPool()) {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    const [tables] = await pool.query('SHOW TABLES');
    if (tables.length > 0) {
        const dbKey = Object.keys(tables[0])[0];
        for (const row of tables) {
            const table = row[dbKey];
            if (table !== 'schema_migrations') {
                await pool.query(`TRUNCATE TABLE \`${table}\``);
            }
        }
    }
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function seedSyntheticData(pool = getTestPool()) {
    // 1. Kelas
    const [resKelasA] = await pool.query("INSERT INTO kelas (nama_kelas) VALUES ('X-A')");
    const [resKelasB] = await pool.query("INSERT INTO kelas (nama_kelas) VALUES ('X-B')");
    const kelasAId = resKelasA.insertId;
    const kelasBId = resKelasB.insertId;

    // 2. Mata Pelajaran
    const [resMapel] = await pool.query("INSERT INTO mata_pelajaran (nama_mapel) VALUES ('Matematika')");
    const mapelId = resMapel.insertId;

    // 3. Guru & Admin
    const hashedPin = await bcrypt.hash('1234', 10);
    const [resGuru] = await pool.query(
        "INSERT INTO guru (nip, nama, username, password) VALUES ('19800101', 'Guru Penguji', 'guru_uji', ?)",
        [hashedPin]
    );
    const guruId = resGuru.insertId;

    await pool.query(
        "INSERT INTO admin (username, password) VALUES ('admin_uji', ?)",
        [hashedPin]
    );

    // 4. Pengajaran
    const [resPengajaran] = await pool.query(
        "INSERT INTO pengajaran (guru_id, mapel_id, kelas_id) VALUES (?, ?, ?)",
        [guruId, mapelId, kelasAId]
    );
    const pengajaranId = resPengajaran.insertId;

    // 5. Siswa sintetis
    const [resSiswa1] = await pool.query(
        "INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0001', 'Siswa Test 1', 'X-A', ?)",
        [hashedPin]
    );
    const [resSiswa2] = await pool.query(
        "INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0002', 'Siswa Test 2', 'X-B', ?)",
        [hashedPin]
    );

    // 6. Ujian (berlangsung saat ini)
    const [resUjian] = await pool.query(
        `INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, batas_pelanggaran)
         VALUES (?, 'Ujian Harian Matematika', 60, NOW() - INTERVAL 10 MINUTE, NOW() + INTERVAL 50 MINUTE, 3)`,
        [pengajaranId]
    );
    const ujianId = resUjian.insertId;

    // 7. Soal sintetis
    const [resSoal] = await pool.query(
        `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
         VALUES (?, 'pg', '1 + 1 = ?', 2, '1', '2', '3', '4', 'B')`,
        [ujianId]
    );

    return {
        kelasAId,
        kelasBId,
        mapelId,
        guruId,
        pengajaranId,
        ujianId,
        soalId: resSoal.insertId,
        siswa1Id: resSiswa1.insertId,
        siswa2Id: resSiswa2.insertId,
        defaultPin: '1234'
    };
}

async function closeTestPool() {
    if (testPool) {
        await testPool.end();
        testPool = null;
    }
    try {
        const modelsPool = require('../../models/db');
        if (modelsPool && typeof modelsPool.end === 'function') {
            await modelsPool.end();
        }
    } catch (_) {}
}

module.exports = {
    TEST_DB_NAME,
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
};
