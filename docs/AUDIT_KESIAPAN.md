# Audit Kesiapan Produksi

Tanggal audit: 2026-10-17 · Cakupan: seluruh kode (`app.js`, `routes/`, `controllers/`, `services/`, `middleware/`, `public/js`, `views/`, `scripts/`, skema & migrasi), dependensi, dan dokumen deployment.
Verifikasi: MariaDB 10.11 lokal, `npm test` (155 test) lulus, ditambah uji integrasi terhadap `app.js` asli dan uji browser (Chromium) untuk tampilan tanpa internet.

## A. Temuan yang sudah diperbaiki

| # | Tingkat | Temuan | Perbaikan |
|---|---------|--------|-----------|
| 1 | Tinggi | `GET /guru/api/soal/:ujianId` mengembalikan seluruh soal **beserta kunci jawaban** untuk ujian mana pun (IDOR antar-guru). | Cek guru pengampu (403/404). |
| 2 | Tinggi | Login dengan `NODE_ENV=production` di LAN tanpa HTTPS (`http://IP:3000`) gagal total karena cookie `Secure` ditolak peramban. | Override `COOKIE_SECURE`; didokumentasikan. |
| 3 | Tinggi | Bootstrap, ikon, dan Google Fonts dimuat dari internet; tanpa internet sekolah, UI ujian rusak. | Aset disajikan lokal di `public/vendor` (+ pengecualian `.gitignore`, sebelumnya `vendor/` ikut diabaikan). |
| 4 | Tinggi | Event socket `selesai-ujian` hanya mengubah status ke `selesai` tanpa menghitung nilai; klien juga tetap mengeluarkan event itu saat `/api/selesai-ujian` gagal. Job penutupan hanya memproses `sedang_ujian` → siswa **tidak pernah punya nilai**. | Socket memanggil `finalizeSesi`; klien tidak lagi menganggap selesai bila server gagal (jawaban lokal dipertahankan, ada coba ulang); job penutupan memulihkan sesi `selesai` tanpa nilai. |
| 5 | Tinggi | Form edit siswa mengisi kolom PIN dengan **hash bcrypt**, lalu server me-hash ulang → mengedit nama saja merusak PIN siswa. Tabel siswa juga menampilkan hash. | Kolom PIN kosong = tidak diubah; hash tidak ditampilkan. |
| 6 | Tinggi | PIN default `1234` saat PIN kosong (tambah/import Excel). Siapa pun yang tahu NIS dapat mengambil alih sesi teman. | PIN wajib diisi (≥ 4 karakter). |
| 7 | Sedang | Tab/perangkat lama yang sesinya sudah diambil alih masih dapat mengirim `pindah-tab`/`copy-paste` dan mengunci siswa di perangkat barunya. | `siswa-siap` memeriksa `device_token`; perangkat lama ditolak (409). |
| 8 | Sedang | Reset ujian: `nilai_essay` lama terbawa ke percobaan baru; hitungan pelanggaran lama tetap dihitung; tidak transaksional. | Hapus `nilai_essay`, beri penanda pelanggaran (log lama tetap sebagai bukti), semua dalam transaksi. |
| 9 | Sedang | Ganti nama kelas membuat siswa tidak cocok dengan ujian kelasnya (`siswa.kelas` menyimpan nama); hapus kelas berisi siswa meninggalkan siswa yatim. | Rename ikut memperbarui siswa (transaksi); hapus kelas berisi siswa ditolak. |
| 10 | Sedang | Cetak hasil menggabungkan dua siswa bernama sama. | Dikunci per NIS. |
| 11 | Sedang | Session fixation: ID sesi tidak diganti saat login. | `session.regenerate` di login admin/guru/siswa. |
| 12 | Sedang | `username[x]=y` (urlencoded extended) menjadi objek yang diperluas mysql2 menjadi fragmen SQL. | Login menolak input non-string. |
| 13 | Sedang | `SESSION_SECRET` tidak divalidasi; contoh `.env` ("ganti-dengan-…") bisa terpakai di produksi. | `utils/env.js`: server menolak menyala (production: < 32 karakter / placeholder / DB tanpa password). |
| 14 | Sedang | Satu-satunya cara membuat admin adalah `seed` dengan `admin/admin123`. | `npm run create-admin`; seed menolak berjalan di production. |
| 15 | Sedang | Endpoint lama `/api/simpan-jawaban` tidak memeriksa batas waktu pribadi siswa. | Memakai `bolehTerimaJawaban`. |
| 16 | Rendah | Login admin/guru membedakan "username salah" vs "password salah" (enumerasi akun). | Pesan seragam. |
| 17 | Rendah | Statistik essay guru melipatgandakan hitungan (fan-out JOIN). | `COUNT(DISTINCT …)`. |
| 18 | Rendah | Ujian dapat dibuat dengan tanggal selesai < mulai atau durasi ≤ 0. | Validasi tambah/edit. |
| 19 | Rendah | HTML di teks soal/pilihan dirender mentah ke siswa (stored XSS dari akun guru). | Di-escape; baris baru dipertahankan. |
| 20 | Rendah | Pesan error internal (SQL) tampil di halaman error produksi; tidak ada header keamanan dasar; `PORT` kosong → port acak. | Pesan generik untuk 5xx di production; `nosniff`, `X-Frame-Options`, `Referrer-Policy`; default 3000. |
| 21 | Rendah | `mysql2` (high) dan `uuid` rentan; README menyuruh mengimpor `schema.sql` ke DB uji padahal berisi `USE cbt_sekolah`. | `npm audit --omit=dev`: 0 kerentanan; README diperbaiki. |

Dokumen kerja (`.env`, MariaDB) hanya dipakai untuk audit lokal; tidak ikut di-commit.

## B. Belum diubah — perlu keputusan/tindakan pemilik

1. **Sesi `keluar_paksa` tanpa tindak lanjut tidak punya nilai.** Bila pengawas tidak "buka kunci" atau "paksa selesai", siswa itu tidak muncul di hasil. Tentukan kebijakan (mis. otomatis dinilai setelah ujian berakhir).
2. **Anti-curang bersifat best-effort.** Deteksi pindah-tab/copy-paste berasal dari peramban siswa dan dapat dilewati; pengawasan fisik tetap perlu.
3. **Satu proses saja** (state socket di memori). Jangan menjalankan lebih dari satu instance PM2. Uji beban asli (±400 siswa) belum dijalankan di perangkat keras sekolah: lakukan `npm run loadtest` di server sebenarnya sebelum hari-H.
4. **Zona waktu**: Node dan MySQL harus sama (`Asia/Jakarta`). Cek `SELECT NOW()` di server produksi.
5. **HTTPS / CSP**: tanpa HTTPS data login lewat jaringan lokal tidak terenkripsi (dapat diterima untuk LAN tertutup, tetapi putuskan secara sadar). Content-Security-Policy belum dipasang karena banyak skrip inline.
6. **Guru dapat mengubah/menghapus soal saat ujian berjalan** dan sesudah dinilai; pertimbangkan penguncian.
7. **Logout via GET**, ekspor Excel tanpa penetralan awalan `=` (formula injection pada nama siswa), `GET /api/soal` tidak mengecek batas waktu pribadi siswa — risiko kecil, belum ditangani.
8. **Backup terjadwal** belum aktif otomatis: pasang cron `scripts/backup.sh` dan uji pemulihan (`docs/BACKUP_RESTORE.md`).
9. `npm run test:ui` memerlukan Chromium yang cocok dengan versi Playwright (`npx playwright install`); tidak dijalankan di audit ini (diganti uji Chromium manual).

## C. Daftar periksa sebelum hari-H

- [ ] `.env` production: `SESSION_SECRET` ≥ 32 acak, `DB_PASSWORD` kuat, `COOKIE_SECURE` sesuai (HTTPS atau `false` untuk LAN)
- [ ] `npm run migrate`, lalu `npm run create-admin -- <user> <password>`
- [ ] PIN siswa unik/tidak mudah ditebak (jangan satu PIN untuk semua)
- [ ] `TZ`/`default-time-zone` = Asia/Jakarta di Node dan MySQL
- [ ] `npm run loadtest` di server sebenarnya + simulasi ujian dengan beberapa HP/laptop
- [ ] Cron backup + uji restore
- [ ] Matikan Wi-Fi sebentar di tengah simulasi (uji sinkron offline) dan uji tombol "Selesai & Kumpulkan"
