const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedDevelopmentData() {
    const host = process.env.DB_HOST || '127.0.0.1';
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'cbt_sekolah';
    const socketPath = process.env.DB_SOCKET;

    console.log(`[SEED] Seeding data pengembangan ke database: ${database}...`);

    const poolConfig = {
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 5
    };

    if (socketPath) {
        poolConfig.socketPath = socketPath;
    } else {
        poolConfig.host = host;
        if (process.env.DB_PORT) {
            poolConfig.port = Number(process.env.DB_PORT);
        }
    }

    const pool = await mysql.createPool(poolConfig);

    try {
        // 1. Admin default (admin / admin123)
        const [existingAdmin] = await pool.query('SELECT id FROM admin WHERE username = ?', ['admin']);
        if (existingAdmin.length === 0) {
            const adminPass = await bcrypt.hash('admin123', 10);
            await pool.query('INSERT INTO admin (username, password) VALUES (?, ?)', ['admin', adminPass]);
            console.log('[SEED] Akun Admin dibuat: username=admin, password=admin123');
        } else {
            console.log('[SEED] Akun Admin sudah ada (username=admin)');
        }

        // 2. Kelas
        const classes = ['VII-A', 'VII-B', 'VIII-A', 'IX-A'];
        for (const kelas of classes) {
            await pool.query('INSERT IGNORE INTO kelas (nama_kelas) VALUES (?)', [kelas]);
        }
        console.log('[SEED] Kelas contoh dibuat: ' + classes.join(', '));

        // 3. Mata Pelajaran
        const mapels = ['Matematika', 'Bahasa Indonesia', 'Ilmu Pengetahuan Alam'];
        for (const mapel of mapels) {
            const [exist] = await pool.query('SELECT id FROM mata_pelajaran WHERE nama_mapel = ?', [mapel]);
            if (exist.length === 0) {
                await pool.query('INSERT INTO mata_pelajaran (nama_mapel) VALUES (?)', [mapel]);
            }
        }
        console.log('[SEED] Mata pelajaran dibuat: ' + mapels.join(', '));

        // 4. Guru default (guru / guru123)
        const [existingGuru] = await pool.query('SELECT id FROM guru WHERE username = ?', ['guru']);
        let guruId;
        if (existingGuru.length === 0) {
            const guruPass = await bcrypt.hash('guru123', 10);
            const [resGuru] = await pool.query(
                'INSERT INTO guru (nip, nama, username, password) VALUES (?, ?, ?, ?)',
                ['198501012010011001', 'Budi Santoso, S.Pd.', 'guru', guruPass]
            );
            guruId = resGuru.insertId;
            console.log('[SEED] Akun Guru dibuat: username=guru, password=guru123');
        } else {
            guruId = existingGuru[0].id;
            console.log('[SEED] Akun Guru sudah ada (username=guru)');
        }

        // 5. Pengajaran (Hubungkan Guru, Mapel Matematika, Kelas VII-A)
        const [kelasRow] = await pool.query("SELECT id FROM kelas WHERE nama_kelas = 'VII-A' LIMIT 1");
        const [mapelRow] = await pool.query("SELECT id FROM mata_pelajaran WHERE nama_mapel = 'Matematika' LIMIT 1");
        let pengajaranId;
        if (kelasRow.length > 0 && mapelRow.length > 0) {
            const [existPengajaran] = await pool.query(
                'SELECT id FROM pengajaran WHERE guru_id = ? AND mapel_id = ? AND kelas_id = ?',
                [guruId, mapelRow[0].id, kelasRow[0].id]
            );
            if (existPengajaran.length === 0) {
                const [resPengajaran] = await pool.query(
                    'INSERT INTO pengajaran (guru_id, mapel_id, kelas_id) VALUES (?, ?, ?)',
                    [guruId, mapelRow[0].id, kelasRow[0].id]
                );
                pengajaranId = resPengajaran.insertId;
            } else {
                pengajaranId = existPengajaran[0].id;
            }
        }

        // 6. Siswa default (NIS 1001 & 1002, PIN 1234)
        const defaultPin = await bcrypt.hash('1234', 10);
        const [existSiswa1] = await pool.query('SELECT id FROM siswa WHERE nis = ?', ['1001']);
        if (existSiswa1.length === 0) {
            await pool.query(
                'INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES (?, ?, ?, ?)',
                ['1001', 'Ahmad Rizki', 'VII-A', defaultPin]
            );
            console.log('[SEED] Akun Siswa dibuat: NIS=1001, PIN=1234, Kelas=VII-A');
        }
        const [existSiswa2] = await pool.query('SELECT id FROM siswa WHERE nis = ?', ['1002']);
        if (existSiswa2.length === 0) {
            await pool.query(
                'INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES (?, ?, ?, ?)',
                ['1002', 'Siti Rahma', 'VII-A', defaultPin]
            );
            console.log('[SEED] Akun Siswa dibuat: NIS=1002, PIN=1234, Kelas=VII-A');
        }

        // 7. Ujian contoh aktif untuk kelas VII-A
        if (pengajaranId) {
            const [existUjian] = await pool.query(
                'SELECT id FROM ujian WHERE pengajaran_id = ? AND nama_ujian = ?',
                [pengajaranId, 'Simulasi CBT Matematika']
            );
            let ujianId;
            if (existUjian.length === 0) {
                const [resUjian] = await pool.query(
                    `INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal, acak_pilihan, batas_pelanggaran)
                     VALUES (?, 'Simulasi CBT Matematika', 60, NOW() - INTERVAL 1 HOUR, NOW() + INTERVAL 24 HOUR, 1, 1, 3)`,
                    [pengajaranId]
                );
                ujianId = resUjian.insertId;
                console.log('[SEED] Ujian simulasi aktif dibuat: ID=' + ujianId);

                // Tambahkan beberapa butir soal
                await pool.query(
                    `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
                     VALUES
                     (?, 'pg', 'Hasil dari 15 + 27 adalah...', 2, '40', '42', '44', '46', 'B'),
                     (?, 'pg', 'Ibu kota negara Indonesia adalah...', 2, 'Bandung', 'Surabaya', 'Nusantara / Jakarta', 'Medan', 'C'),
                     (?, 'pg', 'Rumus luas persegi adalah...', 2, 's x s', '2 x s', '4 x s', 's + s', 'A')`,
                    [ujianId, ujianId, ujianId]
                );
                console.log('[SEED] 3 soal contoh pilihan ganda ditambahkan');
            }
        }

        console.log('[SEED] Seeding selesai dengan sukses!');
    } catch (err) {
        console.error('[SEED] Gagal seeding:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    seedDevelopmentData()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { seedDevelopmentData };

