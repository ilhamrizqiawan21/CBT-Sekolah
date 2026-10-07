# CBT Sekolah

> Sistem Computer Based Test (CBT) untuk sekolah dengan dukungan ujian daring, ketahanan sesi ujian, dan pemantauan aktivitas peserta secara real-time.

CBT Sekolah dikembangkan untuk lingkungan sekolah (di antaranya MTs Al-Ihsan Batujajar) dan menyediakan alur terpisah bagi admin, guru, serta siswa.

## Dokumentasi Proyek

Spesifikasi lengkap, keputusan teknis, arsitektur, dan status implementasi dapat dibaca di folder `docs/`:
- [PRD (Product Requirements)](docs/PRD.md) — Kebutuhan produk dan batas kemampuan sistem
- [DESIGN](docs/DESIGN.md) — Arsitektur sistem, alur sesi, kontrak API, dan pertimbangan teknis
- [ERD](docs/ERD.md) — Skema database dan relasi antar tabel
- [DECISION](docs/DECISION.md) — Catatan keputusan arsitektur (ADR)
- [RULES_AI](docs/RULES_AI.md) — Aturan teknis dan keamanan pengembangan
- [TODO](docs/TODO.md) — Rencana implementasi dan status eksekusi per fase

## Fitur Utama

### Admin
- Mengelola data guru, siswa, kelas, mata pelajaran, ujian, dan butir soal.
- Mendukung tipe soal pilihan ganda, menjodohkan, dan esai.
- Template & import data siswa via Excel (.xlsx) dengan validasi ukuran file.
- Melihat hasil ujian dan mengekspor laporan nilai.
- Memantau log aktivitas dan kecurangan peserta.

### Guru
- Mengelola soal untuk mata pelajaran yang diampu.
- Melihat statistik dan hasil ujian siswa per kelas.
- Mengekspor rekap hasil ujian ke Excel.

### Siswa
- Login menggunakan kombinasi NIS, PIN ujian, dan pilihan ujian yang aktif.
- Mengerjakan ujian dengan timer berbasis server dan indikator progres.
- Penyimpanan jawaban lokal saat offline dan sinkronisasi otomatis kembali ke server.

## Teknologi

| Komponen | Teknologi |
| --- | --- |
| Backend | Node.js (Express.js), express-session, express-mysql-session |
| Real-time | Socket.io |
| Database | MySQL / MariaDB (InnoDB, utf8mb4) |
| Frontend | EJS, Bootstrap 5, Vanilla JavaScript |
| Export | ExcelJS |
| Keamanan | bcrypt, express-rate-limit, session store terpusat, parameterized queries |
| Testing | Test runner bawaan Node.js (`node:test`) |

## Persyaratan Sistem

- Node.js 18 atau lebih baru (direkomendasikan Node.js 20+)
- npm
- MySQL 8.0+ atau MariaDB 10.5+

## Panduan Instalasi

1. Clone repositori:
```bash
git clone https://github.com/ilhamrizqiawan21/CBT-Sekolah.git
cd CBT-Sekolah
npm install
```

2. Konfigurasi Environment:
Salin berkas konfigurasi dari `.env.example`:
```bash
cp .env.example .env
```
Sesuaikan nilai `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, dan `SESSION_SECRET` di berkas `.env`.

3. Inisialisasi Database & Migrasi:
Import skema awal ke database pengembangan:
```bash
mysql -u <user> -p < database/schema.sql
```
Lalu jalankan runner migrasi otomatis:
```bash
npm run migrate
```

4. Menjalankan Server:
- Mode pengembangan:
```bash
npm run dev
```
- Mode produksi:
```bash
npm start
```

Aplikasi dapat diakses melalui peramban di `http://localhost:3000`.

## Pengujian Otomatis (Automated Testing)

Pengujian otomatis menggunakan database uji terpisah `cbt_sekolah_test` agar tidak mengganggu data pengembangan:

1. Buat database uji di MySQL jika belum ada:
```sql
CREATE DATABASE IF NOT EXISTS cbt_sekolah_test;
```
2. Import skema ke database uji:
```bash
mysql -u <user> -p cbt_sekolah_test < database/schema.sql
```
3. Jalankan pengujian:
```bash
npm test
```

## Struktur Proyek

```text
CBT-Sekolah/
├── controllers/          # Logika pengontrol alur (auth, dll.)
├── database/
│   ├── schema.sql        # Baseline skema database
│   └── migrations/       # Berkas migrasi database bertahap
├── docs/                 # Dokumentasi arsitektur, PRD, dan panduan (docs/)
├── middleware/           # Rate limiter, autentikasi sesi, dan role guard
├── models/               # Koneksi database pool (mysql2)
├── public/               # Asset statis: CSS, gambar, JS klien
├── routes/               # Routing rute HTTP (admin, guru, siswa, api)
├── scripts/              # Skrip otomasi (migrate.js, dll.)
├── tests/                # Automated test suite (node:test)
├── utils/                # Utilitas (logger winston, helper)
├── views/                # Template antarmuka EJS
├── app.js                # Server entry point
└── package.json
```

## Catatan Keamanan

- Jangan commit berkas `.env` atau credential rahasia ke repository.
- Selalu gunakan `SESSION_SECRET` yang panjang dan acak.
- Pada lingkungan produksi, jalankan di balik HTTPS (`NODE_ENV=production` mengaktifkan secure cookie flag).
- Otorisasi dan validasi selalu diperiksa di sisi server (server-authoritative).
