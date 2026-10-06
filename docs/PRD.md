# PRD — CBT Sekolah (MTs Al-Ihsan Batujajar)

Status: **Disetujui sebagai dasar implementasi** · Versi 1.0 · Dokumen terkait: [DESIGN](DESIGN.md), [ERD](ERD.md), [DECISION](DECISION.md), [TODO](TODO.md)

## 1. Latar belakang
Selama 3 tahun ujian sekolah (SAS kelas 7/8/9, SAT kelas 7/8, dan ujian semester 2 kelas 9) dilaksanakan dengan HP siswa memakai Exambro (Riyu) dan Google Form. Masalah yang terjadi:

1. Soal Arab di Google Form kecil dan sulit dibaca walau di-zoom.
2. Siswa sering putus koneksi sehingga **mengulang ujian dari 0**.
3. Kecurangan: membuka tab baru untuk mencari jawaban, membawa dua HP.
4. Essay dikerjakan di kertas, tetapi penilaiannya tidak terintegrasi dengan nilai PG.

Aplikasi CBT Sekolah (Express + EJS + MySQL) sudah ada dan fungsional sebagian, tetapi desainnya belum menjawab masalah di atas (lihat [DESIGN §1](DESIGN.md)).

## 2. Tujuan
| ID | Tujuan | Ukuran keberhasilan |
|----|--------|---------------------|
| G1 | Siswa yang putus koneksi **tidak kehilangan progres** | Login ulang melanjutkan sesi dengan jawaban dan sisa waktu yang benar; tanpa campur tangan admin |
| G2 | Soal Arab nyaman dibaca di HP dan laptop | Teks RTL, font Arab lokal, ukuran dapat diperbesar; lolos pemeriksaan visual di layar 360px |
| G3 | Penilaian sesuai aturan sekolah | Nilai akhir otomatis = PG + menjodohkan (otomatis) + essay (input guru), skala 100 |
| G4 | Admin dapat memantau 410 siswa secara langsung | Dashboard menampilkan status, progres, pelanggaran; ada aksi buka kunci/tambah waktu/paksa selesai |
| G5 | Menekan kecurangan semampu software | Aturan berbeda per perangkat; acak soal/pilihan per siswa; log pelanggaran |
| G6 | Berjalan tanpa biaya hosting | Server di perangkat sekolah, teruji 410 klien serentak |

## 3. Pengguna
- **Admin** — mengelola data master, ujian, dan **memantau ujian secara langsung** (peran pengawas).
- **Guru** — mengelola soal mapel yang diampu, menginput nilai essay dari kertas, melihat hasil.
- **Siswa** (±410) — mengerjakan ujian dari **HP** (SAS/SAT; sebagian lewat Exambro) atau **laptop** (kelas 9 semester 2), sering dengan kuota sendiri; WiFi sekolah tidak mampu menampung semua.

## 4. Ruang lingkup
### Termasuk
- Tiga tipe soal: pilihan ganda (PG), menjodohkan, essay (tampil saja).
- Durasi per ujian (contoh 90 dan 120 menit — Arab dan Matematika).
- Ketahanan sesi, timer server, sinkronisasi jawaban, penutupan otomatis.
- Dukungan Arab/RTL, tampilan responsif HP.
- Penilaian berbobot, input nilai essay, ekspor Excel.
- Dashboard pemantauan admin real-time.
- Kebijakan anti-curang per perangkat, token ujian opsional.
- Deployment di laptop server sekolah, backup, uji beban.

### Tidak termasuk (v1)
- Siswa mengetik/mengunggah jawaban essay (dikerjakan di kertas, dinilai guru).
- Penilaian essay otomatis (kata kunci dihapus).
- Hosting berbayar/VPS (tidak dianggarkan; lihat [DECISION D-001](DECISION.md)).
- Deteksi HP kedua (tidak mungkin oleh software; dimitigasi lewat acak soal dan pengawasan).
- Aplikasi native / PWA terpasang.
- Migrasi framework (tetap Express + EJS + MySQL).

## 5. Aturan penilaian (final)
- Soal **PG**: benar = **2** poin, salah/kosong = 0.
- Soal **menjodohkan**: satu soal = **2** poin jika **semua pasangan benar**, selain itu 0 (tanpa nilai parsial).
- Soal **essay**: **5 soal × 4 poin = 20**, dinilai guru per soal (0–4) dari lembar kertas.
- **Nilai akhir** = `(poin PG + poin menjodohkan + poin essay) / total poin maksimal ujian × 100`, dibulatkan ke bilangan bulat terdekat.
- Contoh: 40 soal PG/menjodohkan (80) + essay (20) = 100.
- Selama essay belum selesai dinilai, status koreksi = `menunggu_essay` dan nilai akhir belum final.

## 6. Kebutuhan fungsional
| ID | Kebutuhan | Prioritas |
|----|-----------|-----------|
| FR-01 | Login siswa dengan NIS+PIN (PIN di-hash bcrypt) dan hanya untuk ujian kelasnya | Must |
| FR-02 | Login ulang pada sesi aktif **melanjutkan** sesi; perangkat lama otomatis keluar | Must |
| FR-03 | Sisa waktu dihitung server dari waktu mulai, durasi, dan tambahan waktu | Must |
| FR-04 | Paket soal diunduh sekali; jawaban tersimpan lokal dan disinkron batch, idempoten | Must |
| FR-05 | Sesi yang waktunya habis ditutup otomatis oleh server dan dinilai | Must |
| FR-06 | Urutan acak soal/pilihan tetap sama setiap sambung ulang (seed di DB) | Must |
| FR-07 | Teks Arab tampil RTL dengan font Arab lokal; kontrol ukuran teks | Must |
| FR-08 | Perhitungan nilai sesuai §5 | Must |
| FR-09 | Essay tampil sebagai bacaan, tanpa kolom jawaban | Must |
| FR-10 | Guru menginput nilai essay per soal (form dan impor Excel) | Must |
| FR-11 | Dashboard admin: online/offline/selesai/terkunci, progres, jumlah pelanggaran, perangkat | Must |
| FR-12 | Admin: buka kunci (tanpa hapus data), tambah waktu, paksa selesai | Must |
| FR-13 | Kebijakan anti-curang per tipe perangkat (laptop ketat, HP ringan) | Should |
| FR-14 | Token ujian opsional per ujian, dibagikan pengawas | Should |
| FR-15 | Ekspor hasil Excel memuat nilai PG, essay, akhir, status koreksi | Must |
| FR-16 | Import siswa dari Excel (memakai `exceljs`) | Must |

## 7. Kebutuhan non-fungsional
| ID | Kebutuhan |
|----|-----------|
| NFR-01 | Kapasitas **410 siswa serentak**; uji beban lulus sebelum hari ujian |
| NFR-02 | Server restart tidak membuat siswa logout atau kehilangan jawaban (session di MySQL, seed di DB) |
| NFR-03 | Hemat kuota: paket soal kecil, aset di-cache, tanpa gambar berat untuk teks Arab |
| NFR-04 | Kunci jawaban tidak pernah dikirim ke klien |
| NFR-05 | Login dibatasi per **NIS** (bukan hanya IP; banyak siswa berbagi IP WiFi sekolah) |
| NFR-06 | Backup database otomatis berkala; pemulihan terdokumentasi |
| NFR-07 | Tanpa secret di kode; konfigurasi lewat `.env` |
| NFR-08 | Fungsi penilaian dan sesi memiliki test otomatis |

## 8. Pertanyaan terbuka
| ID | Pertanyaan | Default sementara |
|----|-----------|-------------------|
| O-1 | Domain/alamat akses tunnel gratis | **Ditunda** — lihat DECISION D-002 |
| O-2 | Apakah siswa melihat nilai setelah selesai? | Tidak; hanya konfirmasi "jawaban terkirim" sampai guru selesai menilai |
| O-3 | Apakah ujian perlu dibatasi per kelas lewat jadwal sesi? | Hanya jendela `tanggal_mulai`–`tanggal_selesai` seperti sekarang |
