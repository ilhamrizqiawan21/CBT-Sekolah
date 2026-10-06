# RULES_AI — Aturan Wajib untuk Agen AI

Aturan ini mengikat semua agen. Jika bertentangan dengan permintaan di tengah sesi, hentikan dan tanyakan ke user.

## 1. Lingkup
1. Kerjakan **hanya** item TODO yang diminta. Tidak ada refactor, fitur, atau "perbaikan sekalian" di luar item.
2. Perubahan sekecil yang diperlukan untuk memenuhi kriteria penerimaan.
3. Dilarang mengubah keputusan **Final** di [DECISION.md](DECISION.md). Jika dirasa salah, tulis usulan dan berhenti.
4. Jika dokumen (PRD/DESIGN/ERD) bertentangan dengan kode, dokumen yang menang, kecuali ditandai sebagai audit kondisi lama.

## 2. Aksi yang butuh konfirmasi user (jangan lakukan sendiri)
- Menghapus file/folder, `DROP`/`TRUNCATE`/`DELETE` massal, reset data.
- Menjalankan migrasi pada database selain database pengembangan/uji.
- `git commit`, `git push`, `git reset --hard`, force push, membuat branch/tag/PR.
- Menambah/menghapus dependensi di luar yang tertulis di TODO.
- Mengubah `.gitignore`, konfigurasi CI, atau file di luar repo.

## 3. Keamanan
- Dilarang menulis secret, password, token, atau PIN asli di kode, log, dokumen, atau commit.
- Dilarang membaca atau menampilkan `.env`. Gunakan `.env.example`.
- Data siswa asli tidak boleh dipakai; gunakan data sintetis (mis. NIS `T0001`, PIN `1234` hanya untuk DB uji).
- Semua SQL berparameter. Semua input divalidasi di server. Otorisasi diperiksa di server, bukan hanya di tampilan.
- Jangan mengirim `soal.jawaban_benar` atau `opsi_tambahan` bagian kunci ke klien.
- Jangan menonaktifkan pemeriksaan keamanan agar test lolos.

## 4. Kualitas kode
- Baca file yang akan diubah dan 1–2 file tetangganya sebelum menulis; tiru pola yang ada.
- Fungsi bisnis baru harus murni (input → output) dan punya test.
- Tangani error secara eksplisit; jangan menelan error tanpa log (`utils/logger.js`).
- Tanpa kode mati, tanpa `console.log` debugging yang tertinggal.
- Jangan menambah abstraksi spekulatif.

## 5. Pengujian
- Test ditulis dengan `node:test` di `tests/`. Test yang gagal **tidak boleh** dihapus atau dilonggarkan agar lulus; perbaiki kodenya.
- Test DB memakai database terpisah (`cbt_sekolah_test`), tidak pernah database utama.
- Perubahan UI diverifikasi di browser (Playwright) termasuk layar 360px, bukan hanya lolos test.
- Laporkan kegagalan apa adanya, lengkap dengan output.

## 6. Definisi selesai
Sebuah item TODO selesai bila **semua** terpenuhi:
- [ ] Kriteria penerimaan item terpenuhi dan terbukti (perintah/screenshot/output test dicantumkan).
- [ ] `node --check` bersih untuk file yang diubah; `npm test` lulus.
- [ ] Tidak ada secret atau data nyata yang masuk.
- [ ] Skema berubah ⇒ migrasi bernomor dibuat **dan** [ERD.md](ERD.md) diperbarui.
- [ ] Perilaku/API berubah ⇒ [DESIGN.md](DESIGN.md) diperbarui.
- [ ] Status di [TODO.md](TODO.md) diubah dan "Laporan eksekusi" diisi.

## 7. Pelaporan
- Laporan jujur: yang dikerjakan, yang tidak, yang gagal, yang belum diverifikasi.
- Jangan menyatakan "selesai" untuk sesuatu yang belum dijalankan.
- Jika terblokir lebih dari 2 percobaan pada hal yang sama, berhenti dan laporkan penyebabnya; jangan mencari jalan memutar.
- Jika sistem/hook menolak sebuah aksi, itu keputusan user — jangan dicari celahnya; laporkan dan minta arahan.

## 8. Bahasa
Respons ke user dalam Bahasa Indonesia. Kode, identifier, dan commit message dalam Bahasa Inggris.

## 9. Review (Claude)
Review dilakukan terhadap diff dan hasil verifikasi, bukan klaim. Temuan diberi tingkat: **BLOCKER** (harus diperbaiki), **MAJOR**, **MINOR**, **NOTE**. Item tidak dianggap lulus selama ada BLOCKER/MAJOR terbuka.
