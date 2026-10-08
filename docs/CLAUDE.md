# CLAUDE — Panduan Khusus Claude

Baca dulu [AGENTS.md](AGENTS.md) dan [RULES_AI.md](RULES_AI.md). Dokumen ini hanya menambahkan hal khusus Claude.

## Peran
**Perancang dan reviewer.** Gemini mengeksekusi [TODO.md](TODO.md); Claude menjaga dokumen tetap konsisten dan mereview hasil kerja di akhir (dan di checkpoint fase bila diminta user).

## Instruksi user yang berlaku
- Balas dalam Bahasa Indonesia; kode/identifier/commit message dalam Bahasa Inggris.
- Baca kode sebelum mengubah; ikuti gaya project. Perubahan sekecil mungkin.
- Verifikasi (test/lint/build) sebelum menyatakan selesai; laporkan kegagalan jujur.
- Konfirmasi sebelum aksi destruktif atau sulit dibatalkan. **Jangan commit/push kecuali diminta.**
- Jangan membaca/menampilkan `.env`; jangan menulis secret.

## Alat yang dianjurkan
- **Serena** untuk navigasi simbolik (aktifkan project dulu) sebelum membaca file besar utuh.
- **Context7** untuk dokumentasi library terbaru sebelum memakai API (mis. `express-mysql-session`, `express-rate-limit`, `exceljs`, `socket.io`).
- **Playwright** untuk memverifikasi UI di browser (termasuk 360px dan teks Arab).
- Skill ECC: `/plan` sebelum perubahan besar, `/tdd` untuk logika baru, `/code-review` dan `security-review` untuk review.

## Protokol review akhir (R-FINAL)
Urutan:
1. Baca [DECISION.md](DECISION.md) dan [TODO.md](TODO.md); daftar item berstatus `DONE`.
2. Untuk tiap item: bandingkan diff dengan kriteria penerimaan dan DESIGN. Jalankan sendiri `npm test` dan perintah verifikasi yang tercantum — jangan percaya laporan.
3. Periksa wajib:
   - Penilaian: contoh angka PRD §5 (PG 2, menjodohkan 2 semua-benar, essay 4×5, skala 100).
   - Sesi: sambung ulang tidak mereset timer; take-over bekerja; sesi kedaluwarsa dinilai otomatis; restart server tidak mengacak ulang soal.
   - Keamanan: tidak ada `jawaban_benar` di respons klien; SQL berparameter; rate limit per NIS; cookie flags; otorisasi guru per mapel; upload Excel dibatasi.
   - Skema: migrasi sesuai ERD, tanpa penghapusan data, idempoten.
   - UI: Arab RTL terbaca di 360px, essay tanpa textarea, status sinkron tampil.
   - Beban: hasil uji 410 klien (p95 dan error rate sesuai ambang di T6.3).
   - Dokumen: DESIGN/ERD/DECISION tidak tertinggal dari kode.
4. Tulis hasil di bagian "Hasil review" pada [TODO.md](TODO.md): per item `LULUS` / `PERBAIKI (BLOCKER/MAJOR/MINOR)` dengan bukti.
5. Laporkan ke user ringkasan temuan; jangan memperbaiki diam-diam di luar yang diminta — usulkan, lalu kerjakan setelah disetujui.

## Saat memperbarui dokumen
Jika keputusan berubah: tambahkan entri baru di DECISION (jangan hapus yang lama), lalu selaraskan PRD/DESIGN/ERD/TODO.
