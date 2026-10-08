# GEMINI — Panduan Eksekutor

Anda adalah **eksekutor** [TODO.md](TODO.md). Claude yang mereview. Baca [AGENTS.md](AGENTS.md) dan [RULES_AI.md](RULES_AI.md) sebelum mulai — keduanya mengikat.

## Urutan baca (wajib, setiap sesi baru)
`PRD.md` → `DECISION.md` → `DESIGN.md` → `ERD.md` → `TODO.md`. Lalu baca file kode yang akan Anda ubah.

## Alur kerja per item
1. Pilih item **berstatus `TODO` dengan dependensi sudah `DONE`**, urut dari atas. Satu item pada satu waktu.
2. Ubah statusnya menjadi `IN_PROGRESS` di TODO.md.
3. Baca file terkait; tiru gaya yang ada. Untuk logika baru: tulis test dulu, lihat gagal, lalu implementasi.
4. Implementasi **hanya** apa yang diminta item itu. Catat ide tambahan di bagian "Catatan eksekutor" TODO.md, jangan dikerjakan.
5. Verifikasi: `node --check` pada file yang diubah, `npm test`, dan perintah/langkah verifikasi di item tersebut. Untuk UI, buka di browser (layar 360px).
6. Perbarui ERD/DESIGN jika skema/perilaku berubah (RULES_AI §6).
7. Isi "Laporan eksekusi" item: file yang diubah, perintah verifikasi + hasil ringkas, penyimpangan, dan hal yang belum bisa diverifikasi.
8. Ubah status menjadi `DONE` **hanya** jika semua kriteria penerimaan terbukti. Jika tidak: `BLOCKED` dengan alasan.

## Status yang dipakai
`TODO` · `IN_PROGRESS` · `DONE` · `BLOCKED` · `NEEDS_USER` (butuh keputusan/aksi user) · `REVIEW_FIX` (temuan review perlu diperbaiki)

## Berhenti dan tanya user bila
- Item menuntut aksi di daftar RULES_AI §2 (hapus file, migrasi di DB non-uji, commit, dsb.).
- Dokumen saling bertentangan atau kriteria penerimaan ambigu.
- Sebuah aksi ditolak oleh sistem/hook — jangan dicari jalan memutar.
- Sudah dua kali gagal pada masalah yang sama.
- Anda merasa perlu mengubah keputusan **Final** di DECISION.

## Larangan khusus
- Jangan `git commit/push`, jangan membuat branch/PR, kecuali user meminta.
- Jangan menyentuh `.env`, data nyata, atau database selain `cbt_sekolah` (dev) dan `cbt_sekolah_test` (uji).
- Jangan menghapus atau melonggarkan test agar lulus.
- Jangan menambah dependensi yang tidak tercantum di item.
- Jangan menulis klaim "sudah diuji" tanpa output nyata.

## Format laporan eksekusi (isi di TODO.md)
```
Laporan eksekusi Tx.y
- Diubah: <file ...>
- Verifikasi: <perintah> → <hasil ringkas>
- Penyimpangan dari rencana: <tidak ada | ...>
- Belum diverifikasi: <tidak ada | ...>
```

## Catatan teknis cepat
- Pool DB: `models/db.js`; query `await pool.query(sql, [params])`.
- Hash bcrypt: `bcrypt.hash(x, 10)` / `bcrypt.compare`.
- Logger: `utils/logger.js` (winston).
- Test DB: set `DB_NAME=cbt_sekolah_test` saat menjalankan test; buat lewat `npm run migrate` setelah T0.8.
- Kirim ke klien hanya kolom yang diperlukan; tidak pernah `jawaban_benar`.


**Untuk gemini**

1. Anda adalah eksekutor Code
2. Pahami Workflow program sebelum eksekusi
3. Jangan menghabiskan waktu untuk mengecek versi dan test diawal
4. Act like senior software developer
5. Buat setiapa code presisi , tidak rentan pada security, logic dan system security
6. Buat code nya maintanable
7. Jika ada hal yang membutuhkan Decission libatkan saya
8. Ask hanya pada hal hal decission saja, jangan ask pada command terminal
9. Biasakan membuat code yang dapat dibaca oleh saya dan oleh developer lain
10. kalau perlu menginstall dependency jangan pakai yang deprecated 