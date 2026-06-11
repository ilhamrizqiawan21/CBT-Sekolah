# 🖥️ CBT Sekolah - Computer Based Test untuk MTs. AL-IHSAN BATUJAJAR

Sistem Ujian Berbasis Komputer (CBT) lengkap dengan tiga peran (Admin, Guru, Siswa), dukungan tiga tipe soal (Pilihan Ganda, Menjodohkan, Essay), deteksi kecurangan real-time, penyimpanan offline, dan laporan export Excel/PDF.

## ✨ Fitur Utama

### 👨‍💻 Admin
- Manajemen Guru, Siswa, Kelas, Mata Pelajaran
- CRUD Ujian & Soal (3 tipe + import batch via tabel)
- Reset ujian (perorangan/massal)
- Hasil ujian dengan filter, pagination, export Excel (ringkasan & detail)
- Cetak laporan PDF (print-friendly)
- Log kecurangan (pindah tab, copy-paste)
- Import siswa via Excel

### 👩‍🏫 Guru
- Dashboard dengan statistik (ujian diajar, soal, peserta, rata-rata nilai)
- Kelola soal (hanya untuk ujian yang diajar)
- Lihat hasil siswa (filter per ujian/kelas, export Excel)
- Log kecurangan untuk mata pelajaran yang diajar

### 🧑‍🎓 Siswa
- Login dengan NIS + PIN + pilih ujian
- Tampilan ujian minimalis (timer, progress bar, toast notifikasi)
- Tiga tipe soal: Pilihan Ganda, Menjodohkan, Essay
- **Penyimpanan offline** (jawaban disimpan di localStorage, dikirim saat koneksi pulih)
- Deteksi kecurangan: **pindah tab** & **copy-paste** (dibatasi konfigurasi per ujian)
- Paksa submit jika batas pelanggaran terlampaui

## 🛠️ Teknologi

| Stack | Keterangan |
|-------|-------------|
| **Backend** | Node.js, Express.js, Socket.io |
| **Database** | MySQL (MariaDB) |
| **Template Engine** | EJS |
| **Frontend** | Bootstrap 5, Bootstrap Icons, CSS3 |
| **Real-time** | Socket.io (deteksi pindah tab, paksa submit) |
| **Export** | ExcelJS (Excel), Print-friendly (PDF) |
| **Keamanan** | Bcrypt, express-session, prepared statements |

## 📦 Instalasi

### Prasyarat
- Node.js (v18+)
- MySQL (MariaDB)
- NPM

### Langkah-langkah

1. **Clone / download proyek** ke folder `D:\CBT-Sekolah` (atau sesuai keinginan).

2. **Import database**  
   - Buka phpMyAdmin, buat database baru `cbt_sekolah`
   - Import file `cbt_sekolah.sql` yang disertakan

3. **Instal dependensi**
   ```bash
   npm install
Konfigurasi environment
Buat file .env di root proyek:

env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=cbt_sekolah
SESSION_SECRET=rahasia_banget_cbt_sekolah
NODE_ENV=development
Jalankan server

bash
npm run dev   # menggunakan nodemon (auto restart)
# atau
node app.js
Akses aplikasi

Siswa: http://localhost:3000/login

Admin: http://localhost:3000/login-admin

Guru: http://localhost:3000/login-guru

Akun Default
Role	Username	Password
Admin	admin	admin123 (atau sesuai reset)
Guru	(buat melalui admin)	(sesuai input)
Siswa	NIS: 12345, PIN: 1234	-
Catatan: Password admin di database sudah di-hash. Jika tidak bisa login, gunakan endpoint reset sementara (lihat kode app.js).

📁 Struktur Proyek
text
CBT-Sekolah/
├── app.js                # Entry point, socket.io, middleware
├── .env                  # Konfigurasi
├── package.json
├── models/
│   └── db.js             # Koneksi MySQL pool
├── routes/
│   ├── index.js          # Login siswa, admin, guru
│   ├── admin.js          # CRUD semua entitas, export, reset
│   ├── guru.js           # Kelola soal, hasil, log
│   └── api.js            # Endpoint untuk ujian siswa (soal, jawaban, selesai)
├── controllers/
│   └── authController.js # Login siswa
├── views/
│   ├── partials/         # header, sidebar_admin, sidebar_guru, footer
│   ├── admin/            # dashboard, guru, kelas, mapel, ujian, soal, hasil, log, dll
│   ├── guru/             # dashboard, kelola_soal, hasil_siswa, log_kecurangan
│   ├── login.ejs, login-admin.ejs, login-guru.ejs
│   └── ujian.ejs         # Halaman ujian siswa
├── public/
│   ├── css/              # style.css
│   ├── js/               # ujian.js, admin.js, guru.js
│   └── images/           # logo-sekolah.png, favicon.png
├── utils/
│   ├── helper.js         # cekWaktuUjian
│   └── excelExport.js    # Export ke Excel
└── middleware/
    └── auth.js           # isAdmin, isGuru, isSiswaAPI
🧪 Uji Coba
Login sebagai siswa

NIS: 12345, PIN: 1234, pilih ujian "Try Out Ujian CBT"

Jawab soal, timer berjalan, coba pindah tab / copy-paste → muncul peringatan.

Matikan WiFi, jawab soal → tersimpan di localStorage, kirim ulang saat online.

Selesai ujian, nilai muncul.

Login sebagai admin

Buka menu Ujian → tambah ujian baru.

Menu Soal → tambah soal (PG / Menjodohkan / Essay) manual atau via batch.

Menu Hasil Ujian → filter ujian, export Excel detail, cetak PDF, reset per siswa.

Menu Log Kecurangan → lihat riwayat pelanggaran.

Login sebagai guru

Pastikan admin telah assign pengajaran (guru-mapel-kelas).

Kelola soal, lihat hasil siswa, lihat log kecurangan.

🔒 Keamanan & Catatan
Semua query menggunakan prepared statement (mysql2 pool) untuk mencegah SQL injection.

Password di-hash dengan bcrypt.

Session menggunakan express-session dengan cookie maxAge 1 hari.

Untuk production, aktifkan NODE_ENV=production, gunakan HTTPS, dan batasi akses dengan reverse proxy (Nginx).

Folder uploads/ digunakan sementara untuk import Excel (hapus berkala).

🤝 Kontribusi
Proyek ini dikembangkan untuk MTs. AL-IHSAN BATUJAJAR. Jika ingin mengembangkan lebih lanjut, silakan fork dan pull request.

📄 Lisensi
MIT License - bebas digunakan untuk tujuan pendidikan dan non-komersial.

Selamat menggunakan! 🎉
