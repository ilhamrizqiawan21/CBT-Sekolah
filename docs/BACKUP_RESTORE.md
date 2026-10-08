# Panduan Backup & Pemulihan Database (Backup & Disaster Recovery)

Dokumen ini menjelaskan strategi cadangan data (backup), rotasi arsip, jadwal otomatis, dan prosedur pemulihan (restore) database **CBT Sekolah** sesuai [DESIGN.md](DESIGN.md) §7.

---

## 1. Skrip Cadangan: `scripts/backup.sh`

Aplikasi menyediakan skrip otomasi [scripts/backup.sh](../scripts/backup.sh) yang memanfaatkan utilitas `mariadb-dump` atau `mysqldump` dengan kompresi `gzip` dan rotasi retensi file.

### Fitur Utama:
- **Konsistensi Data**: Menggunakan flag `--single-transaction --quick --routines --triggers` sehingga tidak mengunci tabel saat siswa sedang ujian.
- **Koneksi Fleksibel**: Otomatis membaca konfigurasi `.env` (`DB_SOCKET`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), atau menerima argumen CLI.
- **Kompresi Gzip**: Menghasilkan berkas terkompresi `.sql.gz` untuk menghemat ruang penyimpanan server.
- **Rotasi Otomatis**: Membatasi jumlah file cadangan yang disimpan (default 30 berkas terakhir) dan menghapus berkas tertua secara otomatis.

### Cara Menjalankan Manual:
```bash
# Menggunakan konfigurasi dari .env
./scripts/backup.sh

# Menentukan parameter kustom
./scripts/backup.sh --db=cbt_sekolah --keep=50 --out-dir=./backups
```

---

## 2. Penjadwalan Backup Otomatis (Cron Job)

Untuk memastikan data siswa dan jawaban ujian tersimpan aman tanpa mengandalkan tindakan manual, pasang penjadwalan crontab di laptop server:

Buka crontab:
```bash
crontab -e
```

Tambahkan baris berikut:

```cron
# 1. Saat Ujian Berlangsung: Backup setiap 10 menit (Senin - Sabtu, pukul 07:00 - 16:00)
*/10 7-16 * * 1-6 /home/ilhamrizqiawan/Projects/CBT-Sekolah/scripts/backup.sh >> /home/ilhamrizqiawan/Projects/CBT-Sekolah/logs/backup.log 2>&1

# 2. Harian: Backup lengkap setiap malam pukul 23:00
0 23 * * * /home/ilhamrizqiawan/Projects/CBT-Sekolah/scripts/backup.sh --keep=60 >> /home/ilhamrizqiawan/Projects/CBT-Sekolah/logs/backup.log 2>&1
```

> [!TIP]
> Sesuaikan path `/home/ilhamrizqiawan/Projects/CBT-Sekolah` dengan lokasi absolut direktori proyek pada komputer server yang digunakan.

---

## 3. Prosedur Pemulihan (Disaster Recovery / Restore)

Jika terjadi kendala pada server (misalnya kegagalan perangkat keras, data korup, atau perpindahan ke komputer cadangan), ikuti langkah berikut:

### Langkah 1: Pilih Berkas Backup yang Akan Dipulihkan
Periksa daftar berkas cadangan yang tersedia di folder `backups/`:
```bash
ls -lht backups/
```
Pilih berkas dengan timestamp terbaru sebelum insiden terjadi (misal: `backups/cbt_cbt_sekolah_20261009_080000.sql.gz`).

### Langkah 2: Buat Database Bersih (Jika Diperlukan)
Jika database rusak atau memulai di server baru:
```bash
mariadb -u <user> -p -e "CREATE DATABASE IF NOT EXISTS cbt_sekolah CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### Langkah 3: Eksekusi Pemulihan (Restore)
Ekstrak dan masukkan dump SQL langsung ke database:

- **Menggunakan UNIX domain socket (Fedora / Linux lokal):**
  ```bash
  gunzip -c backups/cbt_cbt_sekolah_YYYYMMDD_HHMMSS.sql.gz | mariadb -u <user> -p -S /var/lib/mysql/mysql.sock cbt_sekolah
  ```

- **Menggunakan TCP Host:**
  ```bash
  gunzip -c backups/cbt_cbt_sekolah_YYYYMMDD_HHMMSS.sql.gz | mariadb -u <user> -p -h 127.0.0.1 cbt_sekolah
  ```

### Langkah 4: Verifikasi Hasil Pemulihan
Pastikan tabel utama dan data siswa terisi:
```bash
mariadb -u <user> -p cbt_sekolah -e "SELECT COUNT(*) AS total_siswa FROM siswa; SELECT COUNT(*) AS total_jawaban FROM jawaban_siswa;"
```

---

## 4. Pengujian Otomatis

Prosedur backup dan pemulihan telah memiliki suite pengujian otomatis mandiri di [tests/backup_restore.test.js](../tests/backup_restore.test.js):
```bash
node --test tests/backup_restore.test.js
```
Tes ini memverifikasi secara langsung siklus penuh: pembuatan dump `.sql.gz`, eksekusi rotasi berkas `--keep`, pengosongan database uji, dan pemulihan penuh data siswa/soal.

