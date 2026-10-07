# TODO — Rencana Implementasi

Eksekutor: **Gemini** · Reviewer: **Claude** (R-FINAL di akhir) · Aturan: [GEMINI.md](GEMINI.md), [RULES_AI.md](RULES_AI.md)
Acuan: [PRD](PRD.md) · [DESIGN](DESIGN.md) · [ERD](ERD.md) · [DECISION](DECISION.md)
Status: `TODO` `IN_PROGRESS` `DONE` `BLOCKED` `NEEDS_USER` `REVIEW_FIX`

Kolom **Dep** = item yang harus `DONE` lebih dulu. **Owner** `G` = Gemini, `U` = user.

## Status saat dokumen dibuat (sudah selesai sebelum Fase 0)
- `package.json`: `main`, script `start`/`dev` ✔
- `.env.example` ✔ · `database/schema.sql` (baseline, **belum diuji di MySQL**) ✔
- `.gitignore` mengecualikan `database/schema.sql` ✔
- `npm install` ✔ (bcrypt berfungsi)

---
## Fase 0 — Fondasi

### T0.1 Terapkan schema ke database dev — Owner: U lalu G — Dep: —
- User: `sudo mysql < database/schema.sql`, buat `.env` dari `.env.example`, buat DB uji `cbt_sekolah_test`.
- G: verifikasi semua tabel terbentuk; perbaiki `schema.sql` bila ada error sintaks/FK.
- **Terima:** `SHOW TABLES` memuat 12 tabel; impor ulang tidak error (`IF NOT EXISTS`).
- Status: `DONE`

### T0.2 Bersihkan file nyasar — Owner: U (hapus) — Dep: —
- Hapus: `routes/admin.ejs`, `routes/guru.ejs`, `views/ujian ejs .js`, `controllers/ujianController.js` (kosong, tak direferensikan). `CBT-Sekolah.txt` diarsipkan/dihapus (rencana lama, sudah digantikan docs/).
- G **tidak** menghapus sendiri (RULES_AI §2); G memverifikasi tidak ada referensi tersisa (`grep`).
- **Terima:** `grep` tidak menemukan referensi ke file-file itu; aplikasi tetap `node --check` bersih.
- Status: `DONE`

### T0.3 Perbaiki login siswa — Owner: G — Dep: T0.1
- `controllers/authController.js`: ambil siswa **berdasarkan NIS**, `bcrypt.compare(pin, pin_ujian)`; validasi kelas siswa = `kelas.nama_kelas` dari pengajaran ujian (join `ujian → pengajaran → kelas`); pesan error generik ("NIS atau PIN salah").
- Cek juga `routes/index.js` (`/daftar-ujian` / daftar ujian di halaman login) agar hanya menampilkan ujian yang relevan.
- **Terima:** test: PIN benar + kelas cocok → lolos; PIN salah → ditolak; kelas berbeda → ditolak.
- Status: `DONE`

### T0.4 Ganti `xlsx` → `exceljs` — Owner: G — Dep: T0.1
- `routes/admin.js`: template siswa (±296-300) dan import siswa (±309). Batasi ukuran file (mis. 2 MB) dan ekstensi `.xlsx`; hapus file upload setelah diproses (juga saat error).
- `npm uninstall xlsx`.
- **Terima:** unduh template; impor 3 baris sintetis berhasil; `npm ls xlsx` kosong; `npm audit` tidak lagi melaporkan SheetJS.
- Status: `DONE`

### T0.5 Session store MySQL + cookie aman — Owner: G — Dep: T0.1
- `npm i express-mysql-session` (verifikasi API terbaru lewat Context7). `app.js:34-39`: store MySQL, `saveUninitialized:false`, cookie `httpOnly`, `sameSite:'lax'`, `secure` bila `NODE_ENV==='production'`, `app.set('trust proxy', 1)`.
- **Terima:** login → restart server → tetap login; tabel `sessions` terisi; header `Set-Cookie` berisi `HttpOnly; SameSite=Lax`.
- Status: `DONE`

### T0.6 Rate limit login — Owner: G — Dep: T0.3
- `express-rate-limit`: `/login-siswa` kunci per **NIS** (10/15 menit) + per IP longgar (300/15 menit); `/login-admin`, `/login-guru` per IP+username (10/15 menit). Pesan dalam Bahasa Indonesia.
- **Terima:** test/skrip: 11 percobaan salah untuk NIS yang sama → ke-11 ditolak (429); NIS lain dari IP yang sama tetap bisa login.
- Status: `DONE`

### T0.7 Infrastruktur test — Owner: G — Dep: T0.1
- `tests/` dengan `node:test`; helper DB uji (migrasi + seed sintetis + bersihkan); script `"test": "node --test tests/"`.
- **Terima:** `npm test` berjalan, minimal 1 test contoh lulus, memakai `cbt_sekolah_test`.
- Status: `DONE`

### T0.8 Infrastruktur migrasi — Owner: G — Dep: T0.1
- `scripts/migrate.js` + tabel `schema_migrations`; folder `database/migrations/`; script `npm run migrate`. Pengecualian `.gitignore` `!database/migrations/*.sql` (butuh persetujuan user — RULES_AI §2).
- **Terima:** menjalankan dua kali tidak error; migrasi tercatat sekali.
- Status: `DONE`

### T0.9 Perbarui README — Owner: G — Dep: T0.1, T0.8
- Instalasi memakai `database/schema.sql` + `npm run migrate`; tautkan ke `docs/`; hapus klaim yang tidak berlaku.
- Status: `DONE`

---
## Fase 1 — Ketahanan sesi (prioritas utama)

### T1.1 Migrasi 001 — Owner: G — Dep: T0.8
- Sesuai ERD §3 (`001_ketahanan_sesi.sql`).
- **Terima:** migrasi berjalan di DB dev dan uji; kolom sesuai ERD; data lama tidak hilang.
- Status: `DONE`

### T1.2 `services/sesiService.js` — Owner: G — Dep: T1.1, T0.7
- Fungsi: `mulaiAtauLanjut(siswaId, ujianId, deviceType)`, `hitungSisaDetik(sesi, now)`, `ambilAlih(sesi)`, `perpanjang(sesi, menit)`, `bolehTerimaJawaban(sesi, clientTs, now)` (grace 120 dtk dari config).
- `batas_waktu = waktu_mulai + durasi + tambahan_menit`, tidak melewati `ujian.tanggal_selesai` (D-007).
- **Terima:** unit test: sisa waktu tidak berubah saat dipanggil ulang; take-over mengganti `device_token`; jawaban dengan `client_ts` ≤ batas diterima dalam grace dan ditolak sesudahnya; `keluar_paksa`/`selesai` ditolak.
- Status: `DONE`

### T1.3 Login melanjutkan sesi — Owner: G — Dep: T1.2, T0.3
- `authController`: ganti blokir "sesi aktif" dengan take-over (DESIGN §3.1); simpan `device_token` di session; catat pengambilalihan ke `log_kecurangan` atau log khusus.
- **Terima:** login → tutup tab → login lagi: sesi berlanjut, `waktu_mulai` tidak berubah; perangkat lama menerima 409 pada request berikutnya.
- Status: `DONE`

### T1.4 `GET /api/sesi` dan socket tanpa durasi penuh — Owner: G — Dep: T1.3
- `routes/api.js`: endpoint sesuai DESIGN §4. `app.js`: `siswa-siap` tidak lagi mengirim `durasi` penuh; kirim `sisa_detik`; `disconnect` memperbarui `last_seen` (tanpa mengubah status).
- **Terima:** sambung ulang socket tidak mereset hitung mundur (uji manual + test).
- Status: `DONE`

### T1.5 Seed acak di DB — Owner: G — Dep: T1.1
- Hapus `seedMap` di `routes/api.js`; pakai `sesi_ujian.seed`.
- **Terima:** urutan soal/pilihan identik sebelum dan sesudah restart server untuk siswa yang sama; berbeda antar siswa.
- Status: `DONE`

### T1.6 `POST /api/sinkron-jawaban` — Owner: G — Dep: T1.2
- Batch upsert idempoten, cek `device_token`, `bolehTerimaJawaban`, validasi `soal_id` milik ujian; **hitung `is_benar` di server**; jangan kembalikan kunci. Batasi ukuran batch (mis. 100).
- **Terima:** test: kirim batch yang sama dua kali → hasil sama; `client_ts` lebih lama tidak menimpa yang baru; soal ujian lain ditolak.
- Status: `TODO`

### T1.7 Klien: paket soal, antrean, heartbeat — Owner: G — Dep: T1.4, T1.6
- `public/js/ujian.js` dan `views/ujian.ejs`: unduh paket sekali; simpan jawaban lokal; antrean sinkron dengan backoff; heartbeat 20 dtk; resinkron timer tiap 30 dtk dan saat tab aktif; indikator "tersimpan/menunggu sinyal"; tangani 409 (login di perangkat lain).
- **Terima (Playwright):** matikan jaringan 60 dtk (emulasi offline) sambil menjawab → nyalakan → semua jawaban tersinkron, timer benar, tidak mulai dari awal.
- Status: `TODO`

### T1.8 Job penutupan otomatis — Owner: G — Dep: T1.2, T3.2
- `services/finalizeService.js` + interval 30 dtk di `app.js`; panggil `finalizeSesi` yang sama dengan tombol "Selesai". (Dep T3.2: gunakan `penilaianService`; bila belum selesai, stub dengan antarmuka yang sama lalu selaraskan di T3.2.)
- **Terima:** sesi yang melewati batas+grace otomatis `selesai` dan punya `nilai_ujian`; idempoten.
- Status: `TODO`

### T1.9 Buka kunci tanpa hapus data — Owner: G — Dep: T1.2
- `POST /admin/api/sesi/:id/buka-kunci` (hanya admin; audit). Reset ujian yang ada (`routes/admin.js:388-401`) diberi konfirmasi ekstra dan tidak lagi jalan utama.
- **Terima:** sesi `keluar_paksa` → `sedang_ujian`, jawaban tetap ada.
- Status: `TODO`

### T1.10 Pengujian ketahanan end-to-end — Owner: G — Dep: T1.1–T1.9
- Skenario: login, jawab, putus (tutup browser), login ulang, lanjut; restart server saat ujian; sesi kedaluwarsa tanpa siswa online.
- **Terima:** semua skenario lulus; hasil dicantumkan.
- Status: `TODO`

> **Checkpoint review (opsional, atas permintaan user):** Claude mereview Fase 1 sebelum lanjut.

---
## Fase 2 — Soal Arab dan tampilan HP

### T2.1 Font Arab lokal — Owner: G — Dep: T0.1
- Unduh font berlisensi terbuka (Amiri atau Noto Naskh Arabic, format woff2) ke `public/fonts/`; `@font-face` di `public/css/style.css`; sertakan berkas lisensi. Tanpa CDN (D-014).
- **Terima:** font termuat dari server sendiri (tab Network); ukuran total font wajar (< 500 KB).
- Status: `TODO`

### T2.2 RTL dan kontrol ukuran — Owner: G — Dep: T2.1, T1.7
- `dir="auto"` pada teks soal, pilihan, dan pasangan menjodohkan; kelas `.ar` dengan ukuran/leading lebih besar; tombol A−/A+ (simpan di `localStorage`, bungkus try/catch).
- **Terima (Playwright 360×640):** teks Arab bersambung, rata kanan, harakat tampak; A+/A− bekerja dan bertahan setelah reload; tanpa scroll horizontal.
- Status: `TODO`

### T2.3 Responsif HP — Owner: G — Dep: T2.2
- Tombol ≥ 44px, navigasi soal nyaman satu tangan, menjodohkan dapat dipakai di layar sentuh.
- **Terima:** screenshot 360×640 untuk PG, menjodohkan, essay (bacaan).
- Status: `TODO`

### T2.4 Input soal berbahasa Arab — Owner: G — Dep: T2.1
- Form soal admin/guru: `dir="auto"` pada textarea/input; pratinjau soal.
- **Terima:** menyimpan dan menampilkan soal Arab dengan harakat tanpa rusak (cek kolom DB `utf8mb4`).
- Status: `TODO`

---
## Fase 3 — Penilaian

### T3.1 Migrasi 002 — Owner: G — Dep: T0.8
- Sesuai ERD §3 (`002_penilaian.sql`): `nilai_essay`, kolom baru `nilai_ujian`; default poin PG/menjodohkan = 2, essay = 4 (hanya untuk soal baru; data lama tidak diubah diam-diam).
- Status: `TODO`

### T3.2 `services/penilaianService.js` — Owner: G — Dep: T3.1, T0.7
- Implementasi DESIGN §3.5. Pertahankan aturan menjodohkan all-or-nothing.
- **Terima (unit test, angka PRD):** 40 soal PG/menjodohkan semua benar + essay 5×4 → nilai 100; 30 benar dari 40 + essay 12/20 → `(60+12)/100 = 72`; ada essay belum dinilai → `status_koreksi='menunggu_essay'`; menjodohkan salah satu pasangan → 0 poin soal itu; ujian tanpa essay → status `selesai`.
- Status: `TODO`

### T3.3 Hapus penilaian essay otomatis + UI essay bacaan — Owner: G — Dep: T3.2
- `routes/api.js`: buang cabang essay kata kunci; `views/ujian.ejs`/`ujian.js`: essay tanpa textarea, kartu "Dijawab di lembar kertas"; form soal: hapus kolom kata kunci, poin default essay 4.
- **Terima:** tidak ada input jawaban essay; ujian dapat diselesaikan tanpa menyentuh essay.
- Status: `TODO`

### T3.4 Pakai `penilaianService` di finalisasi dan rute lama — Owner: G — Dep: T3.2, T1.8
- Ganti perhitungan `benar/total` (`routes/api.js` ±333) dengan service; simpan `poin_otomatis`, `poin_essay`, `poin_maks`, `nilai`, `status_koreksi`.
- **Terima:** hasil sama dengan test T3.2 lewat alur nyata.
- Status: `TODO`

### T3.5 Input nilai essay oleh guru — Owner: G — Dep: T3.4
- `routes/guru.js` + view baru: pilih ujian + kelas → tabel siswa × soal essay (skor 0..poin); simpan memicu hitung ulang; impor/ekspor Excel (`exceljs`); hanya guru pengampu; validasi rentang.
- **Terima:** guru lain ditolak (403); skor > poin ditolak; setelah semua terisi `status_koreksi='selesai'` dan nilai akhir benar.
- Status: `TODO`

### T3.6 Ekspor dan cetak hasil — Owner: G — Dep: T3.4
- `utils/excelExport.js`, `routes/admin.js` (±411), `routes/guru.js`, `views/*/cetak_hasil|hasil*`: kolom Poin PG+Menjodohkan, Poin Essay, Nilai Akhir, Status Koreksi.
- **Terima:** berkas Excel dan tampilan cetak memuat kolom baru dengan nilai benar.
- Status: `TODO`

### T3.7 Tampilan nilai ke siswa (flag) — Owner: G — Dep: T3.4
- Konfigurasi `.env` `TAMPILKAN_NILAI_SISWA` (default `false`, D-017): bila `false`, siswa hanya melihat "Jawaban terkirim".
- Status: `TODO`

---
## Fase 4 — Dashboard pemantauan admin

### T4.1 `services/monitorService.js` + snapshot — Owner: G — Dep: T1.1
- `GET /admin/api/monitor/:ujianId`: per siswa kelas terkait: status turunan (`online` bila `last_seen` < 45 dtk, `offline`, `selesai`, `terkunci`, `belum_masuk`), progres (terjawab/total), pelanggaran, perangkat.
- **Terima:** test status turunan; hanya admin (403 selain admin).
- Status: `TODO`

### T4.2 Socket admin real-time — Owner: G — Dep: T4.1
- Room `admin:{ujian_id}` dengan autentikasi session admin; siaran `monitor:update` pada event DESIGN §3.6.
- **Terima:** buka dashboard, siswa uji masuk/menjawab → baris diperbarui tanpa reload; socket non-admin ditolak.
- Status: `TODO`

### T4.3 Halaman monitor — Owner: G — Dep: T4.2
- `views/admin/monitor.ejs`: filter kelas/status, penanda warna, hitung ringkas (online/offline/selesai/terkunci), tahan 410 baris tanpa lag (render efisien).
- **Terima:** Playwright dengan data sintetis ratusan baris.
- Status: `TODO`

### T4.4 Aksi admin + audit — Owner: G — Dep: T4.3, T1.9
- `tambah-waktu`, `paksa-selesai`, `buka-kunci`; migrasi 003 (`audit_admin`); konfirmasi sebelum aksi; sesi terkait menerima pembaruan via socket.
- **Terima:** tambah waktu memperpanjang `batas_waktu` dan timer siswa berubah pada sinkron berikutnya; setiap aksi tercatat di `audit_admin`.
- Status: `TODO`

---
## Fase 5 — Anti-curang per perangkat

### T5.1 Deteksi dan catat tipe perangkat — Owner: G — Dep: T1.7
- Klien menentukan `hp`/`laptop` (DESIGN §3.7), kirim saat mulai; simpan di `sesi_ujian.device_type` dan `log_kecurangan.device_type`.
- Status: `TODO`

### T5.2 Kebijakan per perangkat — Owner: G — Dep: T5.1
- Laptop: wajib fullscreen + pindah tab + copy-paste; HP: pindah tab + copy-paste (fullscreen tidak diwajibkan). Perbaiki `public/js/ujian.js` dan handler `app.js` (`pindah-tab`, `keluar-fullscreen`, `copy-paste`). Hitung total pelanggaran seperti sekarang; lewat batas ⇒ `keluar_paksa` + siaran ke monitor.
- **Terima:** emulasi laptop: keluar fullscreen dihitung; emulasi HP: tidak ada peringatan fullscreen palsu.
- Status: `TODO`

### T5.3 Token ujian opsional — Owner: G — Dep: T0.3
- Migrasi 003 `ujian.token_ujian`; admin mengisi/mengacak token; login memvalidasi bila token diset.
- **Terima:** token salah ditolak; ujian tanpa token tidak terpengaruh.
- Status: `TODO`

### T5.4 Panduan Exambro/SEB — Owner: G — Dep: T5.2
- Dokumen singkat `docs/PANDUAN_EXAMBRO.md`: cara membuka URL aplikasi di Exambro/SEB (tidak mengklaim hal yang tidak diverifikasi).
- Status: `TODO`

---
## Fase 6 — Deployment dan uji beban

### T6.1 pm2 + env produksi — Owner: G — Dep: T0.5
- `ecosystem.config.js`, panduan start-on-boot, rotasi log; `NODE_ENV=production` mengaktifkan cookie `secure`.
- Status: `TODO`

### T6.2 Backup database — Owner: G — Dep: T0.1
- `scripts/backup.sh` (mysqldump + rotasi), jadwal 10 menit saat ujian dan harian; panduan pemulihan dan **uji pemulihan** ke DB uji.
- **Terima:** berkas backup dapat dipulihkan dan tabel utama terisi.
- Status: `TODO`

### T6.3 Uji beban 410 klien — Owner: G — Dep: T1.10, T3.4
- `scripts/loadtest.js` (socket.io-client/HTTP): 410 login dalam 5 menit, unduh paket soal, sinkron jawaban berkala, heartbeat, sebagian putus-sambung, penutupan otomatis.
- **Ambang terima:** p95 respons `sinkron-jawaban` < 500 ms; error rate < 1 %; tanpa jawaban hilang; CPU/RAM server stabil. Laporkan angka sebenarnya.
- Status: `TODO`

### T6.4 Panduan operasional hari-H — Owner: G — Dep: T6.1, T6.2
- `docs/PANDUAN_HARI_H.md`: checklist laptop server (daya, sleep off, internet), urutan start, token ujian, memantau, penanganan siswa terkunci, rencana bila server mati.
- Status: `TODO`

### T6.5 Akses publik via tunnel — Owner: U + G — Dep: **D-002 diputuskan**
- Menunggu keputusan domain/tunnel. Aplikasi sudah siap di balik proxy (T0.5).
- Status: `BLOCKED` (menunggu D-002)

### T6.6 Pemeriksaan keamanan akhir — Owner: G — Dep: semua Fase 0–5
- Jalankan `npm audit`, tinjau endpoint tanpa autentikasi, pastikan tidak ada `jawaban_benar` di respons, cek Origin/Referer pada POST berbasis session (DESIGN §6).
- Status: `TODO`

---
## R-FINAL — Review akhir oleh Claude
- Owner: **Claude** — Dep: seluruh item Fase 0–6 yang bukan `BLOCKED` berstatus `DONE`.
- Mengikuti protokol di [CLAUDE.md](CLAUDE.md#protokol-review-akhir-r-final). Hasil ditulis di bawah.
- Status: `TODO`

---
## Catatan eksekutor
_(Gemini: tulis ide/risiko di luar lingkup di sini; jangan dikerjakan.)_

## Laporan eksekusi
### Laporan eksekusi T0.1
- Diubah: Database `cbt_sekolah` diterapkan dengan `database/schema.sql`, database `cbt_sekolah_test` dibuat.
- Verifikasi: `SHOW TABLES` di `cbt_sekolah` menghasilkan tepat 12 tabel; impor ulang `schema.sql` berjalan idempoten tanpa error (`IF NOT EXISTS`); koneksi ke `cbt_sekolah_test` berhasil.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.2
- Diubah: Dihapus `routes/admin.ejs`, `routes/guru.ejs`, `views/ujian ejs .js`, `controllers/ujianController.js`, `CBT-Sekolah.txt` (dikonfirmasi dan diizinkan user).
- Verifikasi: `grep` referensi bersih di seluruh codebase; `node --check` semua file JS lolos tanpa error.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.3
- Diubah: `controllers/authController.js`, `routes/api.js`, `views/login.ejs`.
- Verifikasi: Pengujian pada DB uji (`cbt_sekolah_test`) membuktikan: PIN benar + kelas cocok lolos redirect `/ujian`, PIN salah ditolak ("NIS atau PIN salah"), kelas berbeda ditolak ("Ujian ini tidak diperuntukkan bagi kelas Anda"), NIS tidak ditemukan ditolak ("NIS atau PIN salah"); `node --check` pada `controllers/authController.js` dan `routes/api.js` lolos tanpa error.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.4
- Diubah: `routes/admin.js`, `package.json`, `package-lock.json`.
- Verifikasi: Unduh template divalidasi menghasilkan kolom NIS, NAMA, KELAS, PIN_UJIAN via ExcelJS; impor 3 baris sintetis ke `cbt_sekolah_test` berhasil tersimpan dengan PIN ter-hash bcrypt; file upload dipastikan terhapus dari disk setelah proses sukses maupun error; file non-.xlsx dan file > 2 MB ditolak oleh middleware multer; `npm ls xlsx` kosong; `npm audit` tidak lagi melaporkan kerentanan SheetJS; `node --check routes/admin.js` bersih.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.5
- Diubah: `app.js`, `package.json`, `package-lock.json`.
- Verifikasi: `express-mysql-session` terintegrasi dengan MySQLStore; tabel `sessions` otomatis dibuat di database uji (`cbt_sekolah_test`); header `Set-Cookie` terbukti memuat `HttpOnly; SameSite=Lax`; server di-restart (instance baru dibuka) dan request terautentikasi dengan cookie sesi sebelumnya tetap lolos (tetap login); `node --check app.js` bersih.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.6
- Diubah: `middleware/rateLimiter.js`, `routes/index.js`.
- Verifikasi: Pengujian script dengan instance server Express membuktikan: 10 percobaan login beruntun untuk NIS yang sama berhasil (200), percobaan ke-11 untuk NIS yang sama ditolak (429) dengan pesan Bahasa Indonesia "Terlalu banyak percobaan login untuk NIS ini. Silakan coba lagi setelah 15 menit."; permintaan dengan NIS berbeda dari IP yang sama langsung lolos (200); permintaan dengan header accept text/html merender view login dengan status 429; rate limiting login admin dan login guru per IP+username berhasil menolak request ke-11 (429); `node --check` pada `middleware/rateLimiter.js` dan `routes/index.js` lolos bersih.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.7
- Diubah: `package.json`, `tests/helpers/db.js` (dibuat), `tests/auth_db.test.js` (dibuat).
- Verifikasi: `package.json` menyertakan script `"test": "node --test 'tests/**/*.test.js'"`; modul helper DB uji (`tests/helpers/db.js`) dibuat untuk `cbt_sekolah_test` dengan fungsi `cleanDatabase`, `seedSyntheticData`, `getTestPool`, dan `closeTestPool`; test `tests/auth_db.test.js` berjalan menggunakan `node:test` dan `node:assert`, memverifikasi struktur tabel DB uji, kebersihan pembersihan data, seed data sintetis, serta logika validasi PIN dan kelas siswa; `npm test` dijalankan dan lulus 5 dari 5 test tanpa kegagalan; `node --check` pada semua file baru/diubah lolos bersih.
- Penyimpangan dari rencana: Menggunakan pattern `'tests/**/*.test.js'` pada script test agar kompatibel dengan runner test bawaan Node.js v24.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.8
- Diubah: `.gitignore`, `package.json`, `scripts/migrate.js` (dibuat), `database/migrations/.gitkeep` (dibuat), `tests/migrate.test.js` (dibuat).
- Verifikasi: Pengecualian `.gitignore` untuk `!database/migrations/*.sql` ditambahkan setelah persetujuan user; `scripts/migrate.js` dibuat dan mendukung flag `--db` serta multi-statement SQL; script `npm run migrate` ditambahkan ke `package.json`; pengujian unit otomatis (`tests/migrate.test.js`) membuktikan migrasi pertama kali membuat tabel dan mencatat versi di `schema_migrations`, sedangkan eksekusi kedua kali berjalan idempoten tanpa error dan tanpa menerapkan ulang; eksekusi `npm run migrate` pada database dev `cbt_sekolah` terbukti berjalan lancar dan idempoten; `npm test` lulus 7 dari 7 pengujian; `node --check scripts/migrate.js` lolos bersih.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T0.9
- Diubah: `README.md`.
- Verifikasi: Panduan instalasi diperbarui menyertakan impor `database/schema.sql` dan eksekusi `npm run migrate`; instruksi automated test (`npm test`) menggunakan database uji `cbt_sekolah_test` ditambahkan; klaim usang (seperti ketiadaan automated testing dan akun demo) dihapus; tautan lengkap ke seluruh dokumen spesifikasi di folder `docs/` (PRD, DESIGN, ERD, DECISION, RULES_AI, TODO) telah dicantumkan.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T1.1
- Diubah: `database/migrations/001_ketahanan_sesi.sql` (dibuat).
- Verifikasi: File migrasi diterapkan berhasil pada database dev (`cbt_sekolah`) dan database uji (`cbt_sekolah_test`); kolom baru (`batas_waktu`, `tambahan_menit`, `seed`, `device_token`, `device_type`, `last_seen`, `selesai_pada` di `sesi_ujian` dan `client_ts`, `diperbarui_pada` di `jawaban_siswa`, serta tabel `sessions`) terverifikasi ada via `DESCRIBE`; data yang sudah ada tidak hilang; `npm test` lulus 7 dari 7 pengujian.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T1.2
- Diubah: `services/sesiService.js` (dibuat), `tests/sesi_service.test.js` (dibuat), `package.json`.
- Verifikasi: `services/sesiService.js` dibuat mengimplementasikan fungsi `mulaiAtauLanjut`, `hitungBatasWaktu`, `hitungSisaDetik`, `bolehTerimaJawaban`, `ambilAlih`, dan `perpanjang`; unit test murni dan integrasi database (`tests/sesi_service.test.js`) membuktikan: penghitungan batas waktu tidak melewati `ujian.tanggal_selesai` (D-007), sisa waktu server-authoritative dihitung akurat, penerimaan jawaban dalam grace 120 detik hanya untuk `client_ts <= batas_waktu` (D-009) dan ditolak setelah grace habis, penolakan status `keluar_paksa` dan `selesai`, penerbitan `device_token` baru saat take-over tanpa mereset waktu, serta pemanjangan batas waktu oleh fungsi perpanjang; `package.json` ditambahkan flag `--test-concurrency=1` untuk mencegah race condition pada DB uji; `npm test` lulus 19 dari 19 pengujian di 4 test suites; `node --check` bersih.
- Penyimpangan dari rencana: Menambahkan opsi `--test-concurrency=1` pada script test untuk eksekusi sekuensial suite test DB.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T1.3
- Diubah: `controllers/authController.js`, `middleware/auth.js`, `routes/api.js`, `tests/takeover_login.test.js` (dibuat).
- Verifikasi: Alur blokir "sesi aktif" di `controllers/authController.js` digantikan dengan mekanisme take-over via `sesiService.mulaiAtauLanjut`; `device_token` disimpan di `req.session.deviceToken`; setiap take-over tercatat di `log_kecurangan` dengan `jenis_kecurangan = 'ambil_alih_sesi'`; middleware `isSiswaAPI` di `middleware/auth.js` dan `routes/api.js` memvalidasi kesesuaian `device_token` dan mengembalikan respons HTTP 409 bila sesi diambil alih di perangkat lain; pengujian integrasi (`tests/takeover_login.test.js`) memverifikasi bahwa siswa login pertama kali mendapatkan token A, saat login kedua (mis. di perangkat B) sesi berlanjut dengan `waktu_mulai` dan `batas_waktu` tidak berubah, dan perangkat A menerima HTTP 409 pada permintaan berikutnya; `npm test` lulus 20 dari 20 pengujian di 5 test suites.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T1.4
- Diubah: `routes/api.js`, `app.js`, `public/js/ujian.js`, `tests/sesi_endpoint_socket.test.js` (dibuat).
- Verifikasi: Endpoint `GET /api/sesi` diimplementasikan sesuai DESIGN §4, mengembalikan `{ status, sisa_detik, batas_waktu, jawaban_tersimpan }`; handler socket `siswa-siap` di `app.js` tidak lagi mengirim durasi penuh atau mereset waktu, melainkan mengirim `sisa_detik` server-authoritative yang dihitung dari `batas_waktu`; handler `disconnect` di `app.js` memperbarui `last_seen` di DB tanpa mengubah status sesi; `public/js/ujian.js` diperbarui agar fungsi timer menerima `sisa_detik` dari event socket; pengujian otomatis (`tests/sesi_endpoint_socket.test.js`) memverifikasi format respons endpoint `/api/sesi`, pencatatan `last_seen` saat socket disconnect, dan bahwa reconnect berkali-kali tidak pernah mereset hitung mundur; `npm test` lulus 22 dari 22 pengujian di 6 test suites; `node --check` bersih pada semua berkas.
- Penyimpangan dari rencana: Pengujian socket dilakukan menggunakan event handler internal Node.js tanpa menambah dependensi eksternal.
- Belum diverifikasi: tidak ada.

### Laporan eksekusi T1.5
- Diubah: `routes/api.js`, `tests/persistent_seed.test.js` (dibuat).
- Verifikasi: Struktur data in-memory `seedMap` dan timer pembersihnya dihapus dari `routes/api.js`; pembacaan seed untuk pengacakan soal dan pilihan dialihkan ke kolom persisten `sesi_ujian.seed` di database; pengujian otomatis (`tests/persistent_seed.test.js`) memverifikasi bahwa ketika server dimatikan dan instance server baru dijalankan (simulasi restart penuh), urutan soal dan pilihan untuk siswa yang sama tetap 100% identik sebelum dan sesudah restart; pada saat yang sama, siswa lain mendapatkan seed yang berbeda sehingga susunan soalnya berbeda; `npm test` lulus 23 dari 23 pengujian di 7 test suites; `node --check` bersih.
- Penyimpangan dari rencana: tidak ada.
- Belum diverifikasi: tidak ada.

## Hasil review
_(Claude: per item `LULUS` / `PERBAIKI (BLOCKER|MAJOR|MINOR)` + bukti.)_
