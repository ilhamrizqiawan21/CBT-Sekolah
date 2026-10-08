# Panduan Deployment & Operasional PM2

Dokumen ini menjelaskan tata cara deployment aplikasi **CBT Sekolah** di server produksi (laptop server lokal atau server mandiri) menggunakan **PM2** process manager, konfigurasi environment produksi, dan rotasi log.

---

## 1. Persiapan Environment Produksi

### A. Berkas `.env`
Pastikan berkas `.env` di server produksi telah disesuaikan:

```ini
PORT=3000
DB_HOST=127.0.0.1
# Opsional: UNIX domain socket (Fedora: /var/lib/mysql/mysql.sock, Ubuntu: /var/run/mysqld/mysqld.sock)
DB_SOCKET=/var/lib/mysql/mysql.sock
DB_USER=cbt_user
DB_PASSWORD=password_database_kuat
DB_NAME=cbt_sekolah
SESSION_SECRET=kunci_rahasia_acak_panjang_dan_aman_minimal_32_karakter
NODE_ENV=production
TAMPILKAN_NILAI_SISWA=false
```

> [!IMPORTANT]
> **Dampak `NODE_ENV=production`**:
> 1. Cookie sesi Express akan secara otomatis mengaktifkan flag `secure: true`.
> 2. Flag `secure: true` mensyaratkan koneksi HTTPS atau reverse proxy (Nginx / Caddy / Cloudflare Tunnel) dengan header `X-Forwarded-Proto: https`. Aplikasi telah menyertakan konfigurasi `app.set('trust proxy', 1)`.
> 3. Tampilan pesan stack trace error dimatikan demi keamanan.

---

## 2. Manajemen Proses Menggunakan PM2

### A. Instalasi PM2
Instal PM2 secara global di sistem:
```bash
npm install -g pm2
```
Atau gunakan runner npx:
```bash
npx pm2 --version
```

### B. Konfigurasi `ecosystem.config.js`
Aplikasi telah dilengkapi dengan berkas [ecosystem.config.js](../ecosystem.config.js) dengan spesifikasi:
- **Mode Eksekusi**: `fork` (1 instance). Sesuai [DESIGN.md](DESIGN.md), Socket.io mengelola pemetaan sesi di memori lokal server tunggal.
- **Auto-restart**: Otomatis restart jika aplikasi mengalami crash.
- **Batas Memori**: `max_memory_restart: '1G'` (restart otomatis jika memory leak melebihi 1 GB).
- **Log PM2**: Disimpan terpusat di direktori `logs/`.

### C. Menjalankan Aplikasi
Jalankan aplikasi dengan environment produksi:
```bash
pm2 start ecosystem.config.js --env production
```

Perintah manajemen proses lainnya:
```bash
# Cek status aplikasi
pm2 status

# Melihat log real-time
pm2 logs cbt-sekolah

# Restart aplikasi
pm2 restart cbt-sekolah

# Hentikan aplikasi
pm2 stop cbt-sekolah
```

---

## 3. Konfigurasi Start-on-Boot (Systemd)

Agar server CBT Sekolah otomatis aktif saat komputer dinyalakan atau setelah restart mendadak:

1. **Jalankan konfigurasi generator startup:**
   ```bash
   pm2 startup
   ```
2. Salin dan jalankan perintah `sudo env PATH=...` yang dimunculkan oleh terminal (disesuaikan dengan OS, misalnya systemd di Fedora/Ubuntu).
3. **Simpan daftar proses aktif ke sistem:**
   ```bash
   pm2 save
   ```

Setelah langkah ini, jika komputer server mati listrik atau reboot, proses `cbt-sekolah` akan langsung menyala otomatis di latar belakang.

---

## 4. Manajemen & Rotasi Log

Untuk mencegah penyimpanan laptop server penuh selama ujian berlangsung:

### A. Rotasi Log Internal Aplikasi (Winston)
Aplikasi menggunakan [utils/logger.js](../utils/logger.js) dengan mekanisme rotasi bawaan:
- `logs/error.log`: Maksimal **10 MB** per file, menyimpan **5** file rotasi riwayat terakhir.
- `logs/combined.log`: Maksimal **10 MB** per file, menyimpan **5** file rotasi riwayat terakhir.

### B. Rotasi Log PM2 (Konsol stdout/stderr)
Pasang modul rotasi log PM2 resmi:
```bash
pm2 install pm2-logrotate
```
Konfigurasi batas ukuran berkas log PM2:
```bash
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true
```

---

## 5. Ringkasan Checklist Sebelum Ujian

- [ ] Node.js (v18+) dan MySQL/MariaDB aktif.
- [ ] Database `cbt_sekolah` telah dimigrasi (`npm run migrate`).
- [ ] Berkas `.env` disetel `NODE_ENV=production` dan `SESSION_SECRET` kuat.
- [ ] Aplikasi berjalan via PM2 (`pm2 status` menampilkan status `online`).
- [ ] Konfigurasi `pm2 save` telah dijalankan untuk persistensi boot.

