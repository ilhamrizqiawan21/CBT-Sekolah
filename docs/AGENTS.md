# AGENTS — Panduan untuk Agen AI di Proyek CBT Sekolah

Berlaku untuk semua agen (Claude, Gemini, lainnya). File khusus: [CLAUDE.md](CLAUDE.md), [GEMINI.md](GEMINI.md). Aturan wajib: [RULES_AI.md](RULES_AI.md).

## Ringkasan proyek
Aplikasi Computer Based Test untuk MTs Al-Ihsan Batujajar (±410 siswa; HP dan laptop; kuota sendiri; server di laptop sekolah). Peran: admin (memantau), guru (soal dan nilai essay), siswa (ujian). Detail: [PRD](PRD.md).

## Urutan baca sebelum bekerja
1. [PRD.md](PRD.md) — apa dan mengapa
2. [DECISION.md](DECISION.md) — keputusan yang tidak boleh dilanggar
3. [DESIGN.md](DESIGN.md) — bagaimana (alur, API, keamanan)
4. [ERD.md](ERD.md) — skema data
5. [TODO.md](TODO.md) — pekerjaan dan statusnya

## Pembagian peran (D-015)
| Peran | Agen | Tugas |
|-------|------|-------|
| Perancang & reviewer | Claude | Menyusun dokumen, mereview hasil, menjaga konsistensi dengan DECISION |
| **Eksekutor** | **Gemini** | Mengerjakan item [TODO.md](TODO.md) satu per satu |
| Pemilik keputusan | User | Menyetujui perubahan keputusan, aksi destruktif, commit/push |

## Stack dan perintah
- Node.js 18+ (CommonJS), Express 5, EJS, MySQL/MariaDB (`mysql2`), Socket.io, bcrypt, exceljs, winston.
- `npm install` · `npm run dev` (nodemon) · `npm start` · `npm test` (setelah T0.7).
- Cek sintaks cepat: `node --check <file>`.
- Konfigurasi: salin `.env.example` ke `.env`. **Jangan** membaca atau menampilkan isi `.env`.

## Struktur
```
app.js               entry point (Express + Socket.io)
routes/              index.js, admin.js, guru.js, api.js
controllers/         authController.js
middleware/          auth.js
models/db.js         pool MySQL
services/            (baru) logika murni: sesi, penilaian, finalisasi, monitor
utils/               excelExport.js, helper.js, logger.js
views/ public/       EJS dan aset
database/            schema.sql, migrations/
docs/                dokumen perancangan
```

## Konvensi kode
- Ikuti gaya file yang ada (CommonJS, 4 spasi, `async/await`, `pool.query` dengan placeholder `?`).
- Query SQL **selalu** berparameter. Tidak ada string concatenation dari input pengguna.
- Logika bisnis baru di `services/` sebagai fungsi murni agar bisa diuji; route hanya membaca request, memanggil service, merespons.
- Teks antarmuka dan pesan ke pengguna dalam Bahasa Indonesia. Kode, nama variabel, dan commit message dalam Bahasa Inggris.
- Komentar seperlunya, jelaskan *mengapa*, bukan *apa*.

## Definisi selesai (ringkas; lengkap di RULES_AI §6)
Kode berjalan, test relevan lulus, `node --check` bersih, tidak ada secret, TODO diperbarui, laporan eksekusi diisi.

## Hal yang sering salah di proyek ini
- PIN siswa disimpan **hash bcrypt**; jangan bandingkan dengan teks biasa.
- `siswa.kelas` berisi **nama** kelas, bukan id.
- Kunci jawaban (`soal.jawaban_benar`) tidak boleh dikirim ke klien.
- `*.sql` diabaikan git kecuali `database/schema.sql` dan `database/migrations/*.sql`.
- IP sekolah dipakai bersama banyak siswa; jangan rate-limit hanya per IP.
