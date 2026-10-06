# DECISION — Catatan Keputusan Desain

Format: ID · Status · Keputusan · Alasan · Konsekuensi. Status: **Final**, **Ditunda**, **Usulan**. Perubahan keputusan Final harus dicatat sebagai entri baru yang menggantikan, jangan dihapus.

| ID | Status | Keputusan |
|----|--------|-----------|
| D-001 | Final | Server berjalan di **satu laptop khusus milik sekolah**; tanpa VPS berbayar |
| D-002 | **Ditunda** | Cara akses publik (tunnel gratis, alamat tetap) |
| D-003 | Final | Menjodohkan: satu soal = 2 poin jika **semua** pasangan benar, selain itu 0 |
| D-004 | Final | Bobot: PG 2, menjodohkan 2, essay 4 per soal (5 soal = 20) |
| D-005 | Final | Nilai akhir = total poin / total poin maks × 100, dibulatkan |
| D-006 | Final | Essay dijawab di kertas, dinilai guru **per soal (0–4)**; aplikasi tidak menerima jawaban essay |
| D-007 | Final | Timer **server-authoritative**; `batas_waktu` tidak melewati `tanggal_selesai` ujian kecuali admin menambah waktu |
| D-008 | Final | Login pada sesi aktif **mengambil alih** (perangkat lama keluar), bukan ditolak |
| D-009 | Final | Sinkron jawaban batch idempoten; grace 120 detik setelah batas, hanya untuk `client_ts ≤ batas_waktu` |
| D-010 | Final | Session disimpan di MySQL (`express-mysql-session`) |
| D-011 | Final | Pengunci perangkat memakai Exambro (HP) / SEB (laptop); aplikasi tidak mengklaim mendeteksi HP kedua |
| D-012 | Final | Tetap Express + EJS + MySQL; tidak ada rewrite |
| D-013 | Final | Perubahan skema lewat migrasi SQL bernomor; `schema.sql` = baseline |
| D-014 | Final | Font Arab dilayani lokal (tanpa CDN) |
| D-015 | Final | Pembagian kerja: **Gemini mengeksekusi TODO, Claude mereview** |
| D-016 | Final | `xlsx` diganti `exceljs`; upgrade major `ejs`/`dotenv` ditunda |
| D-017 | Usulan | Siswa tidak melihat nilai setelah ujian (hanya konfirmasi terkirim) |
| D-018 | Final | Rate limit login per NIS, bukan hanya per IP |
| D-019 | Final | Pemantauan hanya untuk **admin** (guru tidak punya dashboard live di v1) |

## Rincian

### D-001 Hosting
- **Alasan:** tidak ada anggaran hosting; sekolah tidak punya server tetapi bisa menyediakan satu laptop yang menyala selama ujian.
- **Konsekuensi:** laptop menjadi titik gagal tunggal → wajib ada auto-restart (pm2), backup berkala, ketahanan sesi (D-007–D-009), dan uji beban. Cadangan: VM cloud gratis (perlu verifikasi syarat terbaru).

### D-002 Tunnel — DITUNDA
- Alamat tunnel gratis tanpa domain umumnya berubah tiap restart sehingga tidak praktis bagi siswa. Opsi yang dinilai: domain murah (~Rp150 ribu/tahun) + Cloudflare Tunnel bernama; layanan tunnel gratis dengan alamat tetap.
- **Tidak memblokir** Fase 0–5. Hanya T6.5 yang menunggu keputusan ini. Aplikasi harus berfungsi di balik proxy (`trust proxy`, `secure` cookie via env).

### D-003/D-004/D-005 Penilaian
- Sesuai penjelasan sekolah. Implementasi menjodohkan di kode saat ini sudah all-or-nothing; yang diperbaiki adalah pemakaian `poin` dalam rumus nilai.
- Skala nilai tetap 100 sehingga cocok dengan susunan 40 soal PG/menjodohkan × 2 + essay 20.

### D-006 Essay
- Penilaian objektif essay digital sulit; kertas sudah menjadi praktik sekolah. Aplikasi hanya menampilkan soal dan menyediakan input nilai.
- Kolom/logika kata kunci essay dihapus dari UI; data lama tidak dimigrasi.

### D-007 Timer
- Alasan: akar masalah "mengulang dari 0" adalah timer di klien. `sisa = batas_waktu − NOW()` di server.

### D-008 Take-over
- Alasan: HP yang mati/browser tertutup tidak boleh mengunci siswa. Risiko berbagi akun dimitigasi dengan `device_token` dan pencatatan log pada setiap pengambilalihan (admin melihat di monitor).

### D-009 Grace
- Alasan: jawaban yang dibuat sebelum waktu habis tetapi baru terkirim setelah sinyal pulih tidak boleh hilang. `client_ts` tidak sepenuhnya tepercaya; risiko diterima karena batas grace pendek dan sesi tetap dibatasi `batas_waktu`.

### D-011 Anti-curang
- Alasan: aplikasi web di HP tidak dapat mengunci perangkat. Exambro sudah dikenal sekolah. Laptop kelas 9 mendapat kebijakan ketat karena fullscreen API andal di desktop.

### D-017 Nilai ke siswa — USULAN
- Menunggu konfirmasi sekolah (PRD O-2). Implementasi dibuat dengan flag konfigurasi sehingga mudah diubah.
