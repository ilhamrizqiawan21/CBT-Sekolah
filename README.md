# CBT Sekolah

> Sistem Computer Based Test untuk sekolah dengan dukungan ujian daring, penyimpanan jawaban offline, dan pemantauan aktivitas peserta secara real-time.

CBT Sekolah dikembangkan untuk MTs Al-Ihsan Batujajar dan menyediakan alur terpisah bagi admin, guru, serta siswa.

## Fitur utama

### Admin

- Mengelola guru, siswa, kelas, mata pelajaran, ujian, dan soal.
- Mendukung soal pilihan ganda, menjodohkan, dan esai.
- Import siswa serta input soal secara batch.
- Melihat hasil, melakukan reset ujian, dan mengekspor laporan.
- Memantau log perpindahan tab dan aktivitas copy-paste.

### Guru

- Mengelola soal untuk mata pelajaran yang diampu.
- Melihat statistik, hasil siswa, dan log aktivitas ujian.
- Mengekspor hasil sesuai ujian dan kelas.

### Siswa

- Login menggunakan NIS dan PIN.
- Mengerjakan ujian dengan timer dan indikator progres.
- Menyimpan jawaban pada `localStorage` ketika koneksi terputus.
- Mengirim ulang jawaban setelah koneksi tersedia.
- Melihat hasil setelah ujian selesai sesuai konfigurasi.

## Teknologi

| Bagian | Teknologi |
| --- | --- |
| Backend | Node.js, Express.js |
| Real-time | Socket.io |
| Database | MySQL atau MariaDB |
| Frontend | EJS, Bootstrap 5, JavaScript |
| Export | ExcelJS dan tampilan print-friendly |
| Keamanan | bcrypt, session, prepared statements |

## Persyaratan

- Node.js 18 atau lebih baru
- npm
- MySQL atau MariaDB

## Instalasi

```bash
git clone https://github.com/ilhamrizqiawan21/CBT-Sekolah.git
cd CBT-Sekolah
npm install
```

Buat file `.env` berdasarkan konfigurasi lingkungan lokal:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_USER=root
DB_PASSWORD=
DB_NAME=cbt_sekolah
SESSION_SECRET=ganti-dengan-secret-yang-kuat
NODE_ENV=development
```

Buat database, lalu import schema SQL yang tersedia di repository. Jangan gunakan data produksi atau data pribadi siswa pada lingkungan pengembangan.

Jalankan aplikasi:

```bash
npm run dev
```

Jika script development tidak tersedia:

```bash
node app.js
```

Akses aplikasi melalui `http://localhost:3000`.

## Struktur proyek

```text
CBT-Sekolah/
├── controllers/    # Logika autentikasi dan request
├── middleware/     # Pemeriksaan role dan session
├── models/         # Koneksi serta akses database
├── public/         # CSS, JavaScript, dan gambar
├── routes/         # Route admin, guru, siswa, dan API
├── utils/          # Helper dan export
├── views/          # Template EJS
├── app.js          # Entry point aplikasi
└── package.json
```

## Pengujian manual

1. Buat pengguna dan ujian melalui akun admin.
2. Tetapkan guru, mata pelajaran, kelas, serta peserta.
3. Login sebagai siswa dan kerjakan setiap tipe soal.
4. Putuskan koneksi sementara untuk memeriksa penyimpanan offline.
5. Periksa pengiriman ulang jawaban setelah koneksi pulih.
6. Verifikasi hasil, export, reset ujian, dan log aktivitas.

Repository ini belum mendokumentasikan automated test. Pengujian manual diperlukan sebelum deployment.

## Catatan keamanan

- Gunakan `SESSION_SECRET` yang unik dan kuat.
- Aktifkan HTTPS serta secure cookie pada production.
- Hapus akun, endpoint reset, dan data demo sebelum deployment.
- Batasi ukuran dan jenis file import.
- Pastikan otorisasi diperiksa pada server, bukan hanya pada tampilan.
- Lakukan backup database sebelum reset ujian massal.

## Lisensi

Lihat file lisensi repository jika tersedia. Penggunaan data sekolah harus mengikuti kebijakan privasi institusi.
