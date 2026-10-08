# DESIGN — CBT Sekolah

Dokumen terkait: [PRD](PRD.md), [ERD](ERD.md), [DECISION](DECISION.md), [TODO](TODO.md)

## 1. Kondisi sekarang (hasil audit kode)
| Temuan | Lokasi | Dampak |
|--------|--------|--------|
| Login membandingkan PIN teks biasa dengan hash bcrypt | `controllers/authController.js:18-22` | Tidak ada siswa yang bisa login |
| Login tidak memeriksa kelas siswa vs ujian | `controllers/authController.js` | Siswa bisa memilih ujian kelas lain |
| `disconnect` hanya `console.log`; status sesi tetap `sedang_ujian` | `app.js:266` | Siswa putus koneksi terkunci saat login ulang |
| Setiap `siswa-siap` mengirim `durasi` penuh; timer di klien | `app.js:163`, `public/js/ujian.js:249` | Timer mulai ulang dari awal tiap sambung ulang |
| Reset ujian menghapus jawaban, nilai, sesi | `routes/admin.js:388-401` | Satu-satunya jalan keluar adalah mengulang dari 0 |
| `seedMap` (urutan acak) di memori proses | `routes/api.js:50` | Urutan soal berubah setelah restart |
| Session di memori, `secure:false`, `saveUninitialized:true` | `app.js:34-39` | Restart = semua logout; cookie tidak aman |
| Nilai = `benar/jumlah soal×100`, abaikan `poin` | `routes/api.js` (≈ baris 333) | Bobot 2 poin tidak berlaku |
| Essay dinilai kata kunci 60% | `routes/api.js` (≈ baris 262-275) | Bertentangan dengan alur kertas |
| Belum ada event socket/endpoint pemantauan admin | `app.js` | Admin tidak bisa memantau live |
| `xlsx` rentan (tanpa perbaikan di npm) | `routes/admin.js:262-309` | Risiko keamanan upload Excel |
| Penilaian menjodohkan sudah "semua benar atau 0" | `routes/api.js` (≈ baris 256-262) | **Sudah sesuai**, pertahankan |

## 2. Arsitektur target
```
Siswa (HP/Laptop, kuota/WiFi) ──HTTPS──► Tunnel ──► Laptop server sekolah
                                                     ├─ Node.js (Express + Socket.io)
Admin / Guru (browser) ─────────HTTPS──────────────► ├─ MySQL/MariaDB
                                                     └─ pm2 + backup terjadwal
```
- Tetap **monolit** Express + EJS + MySQL (D-012). Tidak ada rewrite.
- Logika baru ditaruh di `services/` (fungsi murni dan mudah di-test); route tipis.
- Konfigurasi dari `.env`.

### Struktur tambahan
```
services/        sesiService.js, penilaianService.js, finalizeService.js, monitorService.js
database/        schema.sql (baseline), migrations/NNN_nama.sql
scripts/         migrate.js, backup.sh, loadtest.js
tests/           *.test.js (node:test)
public/fonts/    font Arab lokal
docs/            dokumen ini
```

## 3. Alur utama

### 3.1 Login dan lanjut sesi
1. Siswa mengirim NIS, PIN, `ujian_id` → server ambil siswa **berdasarkan NIS**, `bcrypt.compare` PIN.
2. Validasi: ujian dalam jendela waktu, **kelas siswa = kelas pengajaran ujian**, token ujian (jika diaktifkan), belum ada `nilai_ujian` final.
3. Cek `sesi_ujian`:
   - Tidak ada → buat sesi baru (`waktu_mulai = NOW()`, `batas_waktu`, `seed` acak, `device_token`).
   - Ada `sedang_ujian` → **ambil alih**: terbitkan `device_token` baru; perangkat lama menerima 409 dan keluar.
   - `keluar_paksa` → tolak, tampilkan pesan hubungi pengawas.
   - `selesai` → tolak (sudah dikerjakan).
4. Klien menerima paket soal + jawaban tersimpan + `sisa_detik`.

### 3.2 Timer server-authoritative
- `batas_waktu = waktu_mulai + durasi + tambahan_menit` (juga tidak melewati `ujian.tanggal_selesai`, lihat D-007).
- `sisa_detik = max(0, batas_waktu − NOW())` dihitung server di `GET /api/sesi`.
- Klien menampilkan hitung mundur lokal, **resinkron** tiap 30 detik, setiap sambung ulang, dan saat tab kembali aktif.
- Klien tidak pernah menjadi sumber kebenaran waktu.

### 3.3 Sinkronisasi jawaban (offline-tolerant)
- Paket soal (tanpa kunci jawaban) diunduh sekali saat masuk.
- Tiap jawaban disimpan ke `localStorage` (kunci per siswa+ujian) dan masuk antrean.
- `POST /api/sinkron-jawaban` mengirim batch `[{soal_id, jawaban, client_ts}]`; server **upsert** (idempoten), simpan yang `client_ts` terbaru per soal.
- Server menolak jawaban jika sesi sudah `selesai`/`keluar_paksa`. Setelah `batas_waktu`, masih menerima selama **grace 120 detik** (D-009) hanya jika `client_ts ≤ batas_waktu`.
- Klien mencoba ulang dengan backoff; indikator "tersimpan / menunggu sinyal".
- Heartbeat tiap 20 detik memperbarui `sesi_ujian.last_seen` (REST atau socket).

### 3.4 Penutupan otomatis
Job server tiap 30 detik: untuk sesi `sedang_ujian` dengan `NOW() > batas_waktu + grace`, panggil `finalizeSesi` → hitung nilai, set `status='selesai'`, `selesai_pada`. Hasil: siswa yang offline tetap punya nilai. Tombol "Selesai" siswa memanggil fungsi yang sama.

### 3.5 Penilaian
`penilaianService.hitung({soalList, jawabanMap, skorEssay})` — fungsi murni:
- PG: `jawaban === jawaban_benar` → `poin` (default 2).
- Menjodohkan: kumpulan pasangan terurut sama persis → `poin` (default 2), selain itu 0.
- Essay: skor dari `nilai_essay` (0..poin soal, default 4); belum diisi = belum dinilai.
- `total_poin_maks = Σ poin semua soal ujian`; `nilai_akhir = round(total_didapat / total_poin_maks × 100)`.
- `status_koreksi = 'menunggu_essay'` bila ada soal essay yang belum ada skornya; `selesai` bila lengkap (atau ujian tanpa essay).
- Penyimpanan di `nilai_ujian` (lihat ERD). Menyimpan skor essay memanggil ulang hitung.

### 3.6 Pemantauan admin
- Socket.io room `admin:{ujian_id}`; hanya sesi admin yang boleh bergabung.
- Server menyiarkan `monitor:update` saat: siswa masuk/sambung ulang/keluar, jawaban tersinkron (progres), pelanggaran, selesai.
- `GET /admin/api/monitor/:ujianId` mengembalikan snapshot awal.
- Status tampilan: `online` (last_seen < 45 dtk), `offline`, `selesai`, `terkunci`, `belum_masuk`.
- Aksi (POST, hanya admin): `buka-kunci`, `tambah-waktu` (menit), `paksa-selesai`. Semua dicatat ke `audit_admin`.

### 3.7 Anti-curang per perangkat
- `device_type` ditentukan klien (`laptop` jika pointer halus + layar ≥ 1024px, selain itu `hp`) dan dicatat; server hanya memakainya untuk memilih kebijakan, bukan keamanan.
- **Laptop**: wajib fullscreen, pindah tab/keluar fullscreen/copy-paste dihitung pelanggaran.
- **HP**: pindah tab/aplikasi dihitung; fullscreen tidak diwajibkan; copy-paste tetap diblokir.
- `ujian.batas_pelanggaran` tetap; melewati batas → `keluar_paksa` + notifikasi ke dashboard.
- Pengunci utama di HP adalah **Exambro** (atau SEB di laptop) yang membuka URL aplikasi (D-011). Aplikasi tidak mengklaim bisa mendeteksi HP kedua.
- Acak soal/pilihan per siswa memakai `seed` di DB.

## 4. Kontrak API (target)
| Method | Path | Auth | Fungsi |
|--------|------|------|--------|
| POST | `/login-siswa` | publik + rate limit | Login/lanjut sesi |
| GET | `/api/sesi` | siswa | `{status, sisa_detik, batas_waktu, jawaban_tersimpan}` |
| GET | `/api/soal/:ujianId` | siswa | Paket soal tanpa kunci; urutan sesuai seed |
| POST | `/api/sinkron-jawaban` | siswa + `device_token` | Upsert batch jawaban |
| POST | `/api/selesai-ujian` | siswa | Finalisasi |
| POST | `/api/heartbeat` | siswa | Perbarui `last_seen` |
| GET | `/admin/api/monitor/:ujianId` | admin | Snapshot pemantauan |
| POST | `/admin/api/sesi/:id/buka-kunci` | admin | `keluar_paksa → sedang_ujian` |
| POST | `/admin/api/sesi/:id/tambah-waktu` | admin | `{menit}` |
| POST | `/admin/api/sesi/:id/paksa-selesai` | admin | Finalisasi paksa |
| GET/POST | `/guru/essay/:ujianId` | guru pengampu | Form/simpan nilai essay (+ impor Excel) |

`/api/simpan-jawaban` (lama) dipertahankan sementara sebagai pembungkus ke logika yang sama, lalu dihapus setelah klien baru lolos review.

## 5. Antarmuka
- **Arab/RTL**: font lokal (Amiri atau Noto Naskh Arabic) via `@font-face` di `public/fonts/`; `dir="auto"` pada teks soal dan pilihan; ukuran dasar teks Arab lebih besar; kontrol A−/A+ (disimpan di `localStorage`); harakat harus tampil benar.
- **Responsif**: target 360×640; tombol minimal 44px; tidak ada scroll horizontal.
- **Essay**: kartu bacaan bertanda "Dijawab di lembar kertas"; tanpa textarea.
- **Indikator**: status sinkron, sisa waktu, jumlah soal terjawab.
- **Admin monitor**: tabel dengan filter kelas dan status, penanda warna, aksi per baris.

## 6. Keamanan
- Session disimpan di MySQL; cookie `httpOnly`, `sameSite=lax`, `secure` bila `NODE_ENV=production` di balik HTTPS; `app.set('trust proxy', 1)`.
- `saveUninitialized:false`.
- Rate limit login: per **NIS** (mis. 10 percobaan/15 menit) dan per IP yang longgar (≥ 300/15 menit) karena IP sekolah dipakai bersama.
- Pemeriksaan `Origin`/`Referer` pada POST berbasis session (pengganti CSRF token; `csurf` sudah deprecated).
- Kunci jawaban tidak pernah dikirim ke klien. Semua otorisasi di server (guru hanya mapel miliknya).
- Upload Excel: batasi ukuran dan ekstensi; hapus file setelah diproses.
- Tanpa akun/endpoint demo; secret hanya dari `.env`.

## 7. Deployment
- Satu laptop khusus server: sleep/hibernate dimatikan, daya selalu tersambung, jaringan kabel bila ada.
- `pm2` untuk auto-restart dan start saat boot (`ecosystem.config.js`, panduan di `docs/DEPLOYMENT.md`); log rotasi (winston `maxsize: 10MB`, `maxFiles: 5`).
- Backup: `scripts/backup.sh` (mysqldump / mariadb-dump + gzip) tiap 10 menit saat ujian dan harian di luar ujian, rotasi berkas otomatis (panduan di `docs/BACKUP_RESTORE.md`).
- Akses publik via tunnel gratis — **belum diputuskan** (D-002).
- Uji beban sebelum hari-H: skrip yang mensimulasikan 410 klien (`scripts/loadtest.js`: login serentak, unduh soal, sinkron jawaban, heartbeat, putus-sambung).

## 8. Strategi pengujian
- `node:test` untuk `penilaianService`, `sesiService` (hitung sisa waktu, takeover, grace), dan finalisasi.
- Test integrasi terhadap DB uji terpisah (`DB_NAME=cbt_sekolah_test`).
- Verifikasi UI dengan Playwright (layar 360px, teks Arab, alur putus-sambung).
- Uji beban 410 klien.
