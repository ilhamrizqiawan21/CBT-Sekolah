# Panduan Operasional Hari-H Ujian

Dokumen ini adalah prosedur standar operasional (SOP) bagi administrator dan tim teknis saat pelaksanaan ujian CBT di sekolah (misal: MTs Al-Ihsan Batujajar) menggunakan server laptop tunggal sesuai [PRD.md](PRD.md) dan [DESIGN.md](DESIGN.md).

---

## 1. Checklist Kesiapan Laptop Server (H-1 Jam)

Sebelum ujian dimulai, pastikan kondisi fisik dan sistem operasi laptop server memenuhi checklist berikut:

- [ ] **Sumber Daya / Listrik**:
  - Adaptor charger laptop selalu terhubung ke stopkontak (disarankan menggunakan UPS / stabilizer bila tersedia).
  - Baterai laptop terisi minimal 80% sebagai cadangan jika listrik padam sejenak.
- [ ] **Manajemen Daya OS (Sleep & Hibernate OFF)**:
  - Matikan fitur otomatis: *Sleep*, *Hibernate*, *Screen Saver*, dan *Auto-Lock*.
  - Pada pengaturan baterai: atur *"When lid is closed: Do nothing"*.
- [ ] **Konektivitas Jaringan**:
  - Hubungkan laptop server ke router / access point menggunakan **kabel LAN** (hindari Wi-Fi untuk server).
  - Catat IP lokal laptop server (jalankan `ip a` atau `hostname -I`, misal `192.168.1.100`).
  - Pastikan seluruh access point di ruang ujian dapat melakukan ping ke IP server.
- [ ] **Kapasitas Penyimpanan**:
  - Periksa sisa ruang disk (`df -h`). Pastikan tersedia minimal **5 GB** free space.
- [ ] **Layanan Database**:
  - Pastikan MySQL / MariaDB aktif: `systemctl status mariadb` (atau `systemctl status mysqld`).

---

## 2. Urutan Menyalakan Server & Aplikasi

Jalankan urutan berikut dari terminal proyek `/home/ilhamrizqiawan/Projects/CBT-Sekolah`:

### Langkah 1: Cek & Terapkan Migrasi Database
Pastikan database sudah termigrasi penuh ke versi mutakhir:
```bash
npm run migrate
```

### Langkah 2: Nyalakan Aplikasi dengan PM2
Gunakan PM2 dalam mode produksi agar auto-restart dan manajemen memori aktif:
```bash
npm run start:prod
```
Periksa status:
```bash
pm2 status
```
*Pastikan proses `cbt-sekolah` berstatus `online`.*

### Langkah 3: Periksa Log Awal
```bash
pm2 logs cbt-sekolah --lines 30
```
*Pastikan muncul log: `Server berjalan di http://localhost:3000` tanpa adanya error.*

### Langkah 4: Pastikan Crontab Backup Otomatis Aktif
Pastikan skrip backup terjadwal setiap 10 menit telah terpasang:
```bash
crontab -l
```
*(Bila belum, ikuti panduan di [docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md)).*

---

## 3. Pengaturan Token Ujian (Sebelum Siswa Masuk)

Jika ujian menggunakan token keamanan (fitur T5.3):

1. Masuk ke halaman admin: `http://localhost:3000/login-admin`.
2. Buka menu **Kelola Ujian** (`/admin/ujian`).
3. Pilih tombol **Edit** pada ujian yang akan berlangsung hari ini.
4. Pada kolom **Token Ujian (Opsional)**:
   - Masukkan token yang diinginkan (misal: `AL-IHSAN01`), atau klik tombol acak token.
5. Klik **Simpan Perubahan**.
6. **Umumkan token kepada pengawas ruang tepat 5 menit sebelum ujian dimulai** agar siswa tidak login sebelum waktu yang ditentukan.

---

## 4. Alur Pemantauan Real-time Pengawas / Admin

1. Buka halaman pemantauan di peramban laptop server:
   ```text
   http://localhost:3000/admin/monitor/<ujianId>
   ```
2. **Indikator Status Peserta**:
   - 🟢 **Online**: Siswa sedang aktif terhubung (heartbeat < 45 detik).
   - ⚪ **Offline**: Sinyal siswa terputus / koneksi Wi-Fi bermasalah.
   - 🔵 **Selesai**: Siswa telah mengklik selesai atau waktu habis otomatis.
   - 🔴 **Terkunci**: Siswa melebihi batas toleransi kecurangan (pindah tab / keluar layar).
3. **Fitur Pengawasan**:
   - Gunakan filter kelas dan status di bagian atas tabel untuk memantau per ruang.
   - Log pelanggaran akan muncul secara real-time via WebSocket tanpa perlu memuat ulang halaman.

---

## 5. Penanganan Masalah & Insiden Siswa

### A. Siswa Terkunci (`keluar_paksa`)
- **Penyebab**: Siswa melakukan pelanggaran melebihi `batas_pelanggaran` (misal 3× pindah tab/aplikasi).
- **Solusi**:
  1. Pengawas ruang memverifikasi alasan siswa.
  2. Admin membuka dashboard monitor, cari baris nama siswa terkait.
  3. Klik tombol **"Buka Kunci"**.
  4. Status sesi siswa langsung pulih menjadi `sedang_ujian`, jatah pelanggaran di-reset dari titik tersebut, dan seluruh jawaban sebelumnya tetap tersimpan utuh.

### B. Perangkat Siswa Mati / Restart / Tertutup Browser
- **Solusi**:
  1. Siswa menyalakan kembali perangkat atau meminjam perangkat pengganti.
  2. Buka halaman login CBT: `http://<IP_Server>:3000`.
  3. Siswa login kembali dengan NIS, PIN, dan Token yang sama.
  4. Sistem secara otomatis melakukan **Take-Over Sesi**:
     - Waktu ujian **tidak** kembali dari awal (tetap menghitung sisa waktu server).
     - Jawaban yang sudah tersinkron otomatis termuat kembali.

### C. Siswa Terkendala Teknis & Butuh Waktu Tambahan
- **Solusi**:
  1. Pada dashboard monitor, klik tombol **"Tambah Waktu"** pada baris siswa terkait.
  2. Masukkan durasi tambahan (misal: 10 atau 15 menit).
  3. Batas waktu sesi siswa di database otomatis diperpanjang dan timer di layar siswa langsung diperbarui.

---

## 6. Rencana Kontingensi (Disaster Recovery)

### Skenario A: Laptop Server Reboot / Restart Mendadak
1. Nyalakan kembali laptop server.
2. Karena konfigurasi `pm2 startup` dan `pm2 save` sudah aktif, aplikasi akan langsung berjalan otomatis.
3. Siswa yang sedang mengerjakan ujian tidak kehilangan jawaban:
   - Klien browser memiliki antrean penyimpanan lokal `localStorage`.
   - Begitu server kembali aktif, klien otomatis melakukan reconnect dan mengirimkan sisa antrean jawaban.
   - Sisa waktu ujian tetap akurat karena dihitung dari kolom `batas_waktu` persisten di database.

### Skenario B: Laptop Server Utama Rusak Fisik (Pindah ke Laptop Cadangan)
1. Siapkan laptop cadangan yang sudah terinstal Node.js dan MariaDB/MySQL.
2. Ambil berkas cadangan terbaru dari folder `backups/` di flashdisk atau drive cadangan (misal: `cbt_cbt_sekolah_YYYYMMDD_HHMMSS.sql.gz`).
3. Pulihkan database di laptop cadangan:
   ```bash
   gunzip -c cbt_cbt_sekolah_*.sql.gz | mariadb -u root -p cbt_sekolah
   ```
4. Jalankan aplikasi di laptop cadangan:
   ```bash
   npm run start:prod
   ```
5. Pastikan laptop cadangan menggunakan IP yang sama (atau umumkan IP baru kepada ruang ujian).
6. Siswa cukup me-refresh browser atau login kembali untuk melanjutkan ujian.

