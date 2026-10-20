const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seedDevelopmentData() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Seed data pengembangan tidak boleh dijalankan pada NODE_ENV=production. Buat admin dengan: node scripts/create-admin.js <username> <password>');
    }
    const host = process.env.DB_HOST || '127.0.0.1';
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'cbt_sekolah';
    const socketPath = process.env.DB_SOCKET;

    console.log(`[SEED] Menyiapkan data dummy untuk demo pada database: ${database}...`);

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
        // Matikan FK sementara untuk pembersihan data lama secara aman
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');
        const tablesToClean = [
            'audit_admin',
            'log_aktivitas_admin',
            'log_kecurangan',
            'nilai_essay',
            'nilai_ujian',
            'jawaban_siswa',
            'sesi_ujian',
            'soal',
            'ujian',
            'pengajaran',
            'siswa',
            'mata_pelajaran',
            'kelas',
            'guru',
            'admin',
            'sessions'
        ];
        for (const tbl of tablesToClean) {
            try {
                await pool.query(`TRUNCATE TABLE \`${tbl}\``);
            } catch (_) {}
        }
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('[SEED] Basis data lama berhasil dibersihkan.');

        // 1. Pengaturan Identitas Sekolah Default
        await pool.query(
            `INSERT INTO pengaturan (kunci, nilai) VALUES
             ('nama_sekolah', 'SMP Nusantara Mandiri'),
             ('logo_sekolah', '')
             ON DUPLICATE KEY UPDATE nilai = VALUES(nilai)`
        );
        console.log('[SEED] Identitas sekolah diset: "SMP Nusantara Mandiri" (Logo Default SVG)');

        // 2. Akun Admin (admin / admin123)
        const adminPass = await bcrypt.hash('admin123', 10);
        await pool.query('INSERT INTO admin (username, password) VALUES (?, ?)', ['admin', adminPass]);
        console.log('[SEED] Akun Admin dibuat: username=admin, password=admin123');

        // 3. Kelas Dummy
        const classes = ['VII-A', 'VII-B', 'VIII-A', 'IX-A'];
        const kelasMap = {};
        for (const k of classes) {
            const [res] = await pool.query('INSERT INTO kelas (nama_kelas) VALUES (?)', [k]);
            kelasMap[k] = res.insertId;
        }
        console.log('[SEED] Kelas dibuat: ' + classes.join(', '));

        // 4. Mata Pelajaran Dummy
        const mapels = ['Matematika', 'Bahasa Indonesia', 'Ilmu Pengetahuan Alam', 'Bahasa Arab'];
        const mapelMap = {};
        for (const m of mapels) {
            const [res] = await pool.query('INSERT INTO mata_pelajaran (nama_mapel) VALUES (?)', [m]);
            mapelMap[m] = res.insertId;
        }
        console.log('[SEED] Mata pelajaran dibuat: ' + mapels.join(', '));

        // 5. Akun Guru Dummy (password: guru123)
        const guruPass = await bcrypt.hash('guru123', 10);
        const guruData = [
            { nip: '198501012010011001', nama: 'Budi Santoso, S.Pd.', user: 'guru' },
            { nip: '199003152015022002', nama: 'Nurul Hidayah, M.Pd.', user: 'guru2' },
            { nip: '197805202005011003', nama: 'Drs. Hendra Setiawan', user: 'guru3' }
        ];
        const guruMap = {};
        for (const g of guruData) {
            const [res] = await pool.query(
                'INSERT INTO guru (nip, nama, username, password) VALUES (?, ?, ?, ?)',
                [g.nip, g.nama, g.user, guruPass]
            );
            guruMap[g.user] = res.insertId;
        }
        console.log('[SEED] Akun Guru dibuat:');
        console.log('       1. guru  / guru123 (Budi Santoso - Matematika)');
        console.log('       2. guru2 / guru123 (Nurul Hidayah - Bahasa Arab & B. Indonesia)');
        console.log('       3. guru3 / guru123 (Drs. Hendra Setiawan - IPA)');

        // 6. Pengajaran (Hubungan Guru - Mapel - Kelas)
        const pengajaranList = [
            { guru: 'guru', mapel: 'Matematika', kelas: 'VII-A' },
            { guru: 'guru', mapel: 'Matematika', kelas: 'VII-B' },
            { guru: 'guru2', mapel: 'Bahasa Indonesia', kelas: 'VII-A' },
            { guru: 'guru2', mapel: 'Bahasa Arab', kelas: 'VII-A' },
            { guru: 'guru3', mapel: 'Ilmu Pengetahuan Alam', kelas: 'VIII-A' }
        ];
        const pengajaranMap = {};
        for (const p of pengajaranList) {
            const [res] = await pool.query(
                'INSERT INTO pengajaran (guru_id, mapel_id, kelas_id) VALUES (?, ?, ?)',
                [guruMap[p.guru], mapelMap[p.mapel], kelasMap[p.kelas]]
            );
            pengajaranMap[`${p.guru}_${p.mapel}_${p.kelas}`] = res.insertId;
        }
        console.log('[SEED] Jadwal Pengajaran berhasil dikaitkan.');

        // 7. Akun Siswa Dummy (PIN: 1234)
        const pinHash = await bcrypt.hash('1234', 10);
        const siswaList = [
            // Kelas VII-A
            { nis: '1001', nama: 'Ahmad Rizki', kelas: 'VII-A' },
            { nis: '1002', nama: 'Siti Rahma', kelas: 'VII-A' },
            { nis: '1003', nama: 'Bima Pratama', kelas: 'VII-A' },
            { nis: '1004', nama: 'Cantika Dewi', kelas: 'VII-A' },
            { nis: '1005', nama: 'Dedi Kurniawan', kelas: 'VII-A' },
            // Kelas VII-B
            { nis: '2001', nama: 'Fajar Nugraha', kelas: 'VII-B' },
            { nis: '2002', nama: 'Gita Permata', kelas: 'VII-B' },
            // Kelas VIII-A
            { nis: '3001', nama: 'Hendra Wijaya', kelas: 'VIII-A' }
        ];
        const siswaMap = {};
        for (const s of siswaList) {
            const [res] = await pool.query(
                'INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES (?, ?, ?, ?)',
                [s.nis, s.nama, s.kelas, pinHash]
            );
            siswaMap[s.nis] = res.insertId;
        }
        console.log('[SEED] 8 Siswa dummy dibuat (PIN default semua siswa: 1234):');
        console.log('       - Ahmad Rizki  (NIS: 1001, Kelas VII-A) -> Siap untuk live test login & ujian');
        console.log('       - Siti Rahma   (NIS: 1002, Kelas VII-A) -> Memiliki riwayat hasil ujian demo');
        console.log('       - Bima Pratama (NIS: 1003, Kelas VII-A)');
        console.log('       - Cantika Dewi (NIS: 1004, Kelas VII-A)');
        console.log('       - Dedi Kurnia  (NIS: 1005, Kelas VII-A)');
        console.log('       - Fajar & Gita (NIS: 2001 & 2002, Kelas VII-B)');

        // 8. Ujian Demo 1: Penilaian Tengah Semester - Matematika (Kelas VII-A)
        // Token ujian: MTK26
        const pengajaranMtk = pengajaranMap['guru_Matematika_VII-A'];
        const [resUjian1] = await pool.query(
            `INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal, acak_pilihan, batas_pelanggaran, token_ujian)
             VALUES (?, 'Penilaian Tengah Semester - Matematika', 60, NOW() - INTERVAL 2 HOUR, NOW() + INTERVAL 24 HOUR, 1, 1, 3, 'MTK26')`,
            [pengajaranMtk]
        );
        const ujian1Id = resUjian1.insertId;

        // Soal Ujian 1: PG, Menjodohkan, Essay
        const [soal1] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Hasil dari 15 + 27 adalah...', 2, '40', '42', '44', '46', 'B')`,
            [ujian1Id]
        );
        const [soal2] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Nilai x yang memenuhi persamaan 3x + 6 = 21 adalah...', 2, '5', '7', '9', '11', 'A')`,
            [ujian1Id]
        );
        const [soal3] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Sebuah persegi memiliki panjang sisi 8 cm. Luas persegi tersebut adalah...', 2, '32 cm²', '48 cm²', '64 cm²', '81 cm²', 'C')`,
            [ujian1Id]
        );

        // Soal Menjodohkan Matematika
        const pasanganMtk = [
            { kiri: '7 x 8', kanan: '56' },
            { kiri: '144 : 12', kanan: '12' },
            { kiri: '2³ + 5', kanan: '13' }
        ];
        const pengecohMtk = ['48', '20'];
        const [soal4] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan)
             VALUES (?, 'menjodohkan', 'Pasangkanlah operasi hitung berikut dengan hasil yang tepat!', 6, ?, ?)`,
            [ujian1Id, JSON.stringify(pasanganMtk), JSON.stringify({ pasangan: pasanganMtk, pengecoh: pengecohMtk })]
        );

        // Soal Essay Matematika
        const [soal5] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan)
             VALUES (?, 'essay', 'Jelaskan langkah-langkah untuk mencari Kelipatan Persekutuan Terkecil (KPK) dari bilangan 12 dan 18!', 4, '[]', '{}')`,
            [ujian1Id]
        );
        console.log('[SEED] Ujian 1 dibuat: "Penilaian Tengah Semester - Matematika" (Kelas VII-A, Token: MTK26, 5 Soal: 3 PG, 1 Menjodohkan, 1 Essay)');

        // 9. Ujian Demo 2: Simulasi CBT Bahasa Arab (Kelas VII-A)
        // Tanpa token ujian (Akses langsung)
        const pengajaranArab = pengajaranMap['guru2_Bahasa Arab_VII-A'];
        const [resUjian2] = await pool.query(
            `INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, acak_soal, acak_pilihan, batas_pelanggaran, token_ujian)
             VALUES (?, 'Simulasi CBT Bahasa Arab', 45, NOW() - INTERVAL 1 HOUR, NOW() + INTERVAL 48 HOUR, 1, 1, 3, NULL)`,
            [pengajaranArab]
        );
        const ujian2Id = resUjian2.insertId;

        // Soal Ujian 2 (Arab): PG Arab & Menjodohkan Arab
        await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES
             (?, 'pg', 'هَذَا كِتَابٌ وَذَلِكَ ...', 2, 'قَلَمٌ', 'مَدْرَسَةٌ', 'حَقِيبَةٌ', 'مِسْطَرَةٌ', 'A'),
             (?, 'pg', 'مَا مَعْنَى كَلِمَة "فَصْلٌ" بِاللُّغَةِ الإِنْدُونِيسِيَّةِ؟', 2, 'Kelas', 'Rumah', 'Masjid', 'Perpustakaan', 'A')`,
            [ujian2Id, ujian2Id]
        );

        const pasanganArab = [
            { kiri: 'كِتَابٌ', kanan: 'Buku' },
            { kiri: 'قَلَمٌ', kanan: 'Pena' },
            { kiri: 'بَابٌ', kanan: 'Pintu' }
        ];
        const pengecohArab = ['Meja'];
        await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan)
             VALUES (?, 'menjodohkan', 'Pasangkan kosakata bahasa Arab berikut dengan artinya yang sesuai!', 6, ?, ?)`,
            [ujian2Id, JSON.stringify(pasanganArab), JSON.stringify({ pasangan: pasanganArab, pengecoh: pengecohArab })]
        );
        console.log('[SEED] Ujian 2 dibuat: "Simulasi CBT Bahasa Arab" (Kelas VII-A, Tanpa Token, 3 Soal: 2 PG Arab, 1 Menjodohkan Arab)');

        // 10. Contoh Rekap Hasil Ujian Demo untuk Siswa Siti Rahma (NIS: 1002) pada Ujian Matematika
        const sitiId = siswaMap['1002'];
        await pool.query(
            `INSERT INTO sesi_ujian (siswa_id, ujian_id, waktu_mulai, batas_waktu, status, selesai_pada)
             VALUES (?, ?, NOW() - INTERVAL 40 MINUTE, NOW() + INTERVAL 20 MINUTE, 'selesai', NOW() - INTERVAL 10 MINUTE)`,
            [sitiId, ujian1Id]
        );

        // Jawaban siswa Siti
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar) VALUES
             (?, ?, ?, 'B', 1),
             (?, ?, ?, 'A', 1),
             (?, ?, ?, 'C', 1),
             (?, ?, ?, ?, 1)`,
            [
                sitiId, ujian1Id, soal1.insertId,
                sitiId, ujian1Id, soal2.insertId,
                sitiId, ujian1Id, soal3.insertId,
                sitiId, ujian1Id, soal4.insertId, JSON.stringify(pasanganMtk)
            ]
        );

        // Nilai essay yang sudah dikoreksi guru
        await pool.query(
            `INSERT INTO nilai_essay (siswa_id, ujian_id, soal_id, skor, dinilai_oleh, dinilai_pada)
             VALUES (?, ?, ?, 4, ?, NOW() - INTERVAL 5 MINUTE)`,
            [sitiId, ujian1Id, soal5.insertId, guruMap['guru']]
        );

        // Nilai akhir ujian (100)
        await pool.query(
            `INSERT INTO nilai_ujian (siswa_id, ujian_id, poin_otomatis, poin_essay, poin_maks, nilai, benar, salah, kosong, status_koreksi, selesai_pada)
             VALUES (?, ?, 12, 4, 16, 100, 4, 0, 0, 'selesai', NOW() - INTERVAL 10 MINUTE)`,
            [sitiId, ujian1Id]
        );
        console.log('[SEED] Riwayat hasil ujian demo ditambahkan untuk Siti Rahma (Nilai: 100, status: selesai).');

        // 11. Log Aktivitas Admin Demo
        await pool.query(
            `INSERT INTO log_aktivitas_admin (admin_id, aksi, entitas, entitas_id, detail, dibuat_pada) VALUES
             (1, 'tambah', 'ujian', ?, 'Menambahkan ujian baru: Penilaian Tengah Semester - Matematika', NOW() - INTERVAL 2 HOUR),
             (1, 'tambah', 'ujian', ?, 'Menambahkan ujian baru: Simulasi CBT Bahasa Arab', NOW() - INTERVAL 1 HOUR),
             (1, 'tambah', 'siswa', ?, 'Mengimpor daftar siswa kelas VII-A', NOW() - INTERVAL 3 HOUR)`,
            [ujian1Id, ujian2Id, sitiId]
        );
        console.log('[SEED] Log aktivitas admin demo berhasil dicatat.');

        console.log('============================================================');
        console.log('[SEED] PENGISIAN DATA DUMMY DEMO SELESAI DENGAN SUKSES!');
        console.log('============================================================');
    } catch (err) {
        console.error('[SEED] Gagal mengisi data dummy:', err.message);
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
