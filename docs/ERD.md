# ERD — CBT Sekolah

Dokumen terkait: [DESIGN](DESIGN.md), [PRD](PRD.md). Baseline: `database/schema.sql`. Perubahan lewat `database/migrations/NNN_*.sql` (D-013).

## 1. Diagram target
```mermaid
erDiagram
    ADMIN {
        int id PK
        varchar username UK
        varchar password
    }
    GURU {
        int id PK
        varchar nip
        varchar nama
        varchar username UK
        varchar password
    }
    KELAS {
        int id PK
        varchar nama_kelas UK
    }
    MATA_PELAJARAN {
        int id PK
        varchar nama_mapel
    }
    SISWA {
        int id PK
        varchar nis UK
        varchar nama
        varchar kelas "nama kelas, bukan FK"
        varchar pin_ujian "bcrypt"
    }
    PENGAJARAN {
        int id PK
        int guru_id FK
        int mapel_id FK
        int kelas_id FK
    }
    UJIAN {
        int id PK
        int pengajaran_id FK
        varchar nama_ujian
        int durasi "menit"
        datetime tanggal_mulai
        datetime tanggal_selesai
        tinyint acak_soal
        tinyint acak_pilihan
        int batas_pelanggaran
        varchar token_ujian "baru, nullable"
    }
    SOAL {
        int id PK
        int ujian_id FK
        varchar tipe_soal "pg|menjodohkan|essay"
        text teks_soal
        varchar gambar
        int poin "pg=2 menjodohkan=2 essay=4"
        text pilihan_a_d
        text jawaban_benar
        text opsi_tambahan "JSON"
    }
    SESI_UJIAN {
        int id PK
        int siswa_id FK
        int ujian_id FK
        varchar socket_id
        datetime waktu_mulai
        datetime batas_waktu "baru"
        int tambahan_menit "baru"
        int seed "baru"
        char device_token "baru"
        varchar device_type "baru"
        datetime last_seen "baru"
        datetime selesai_pada "baru"
        enum status
    }
    JAWABAN_SISWA {
        int id PK
        int siswa_id FK
        int ujian_id FK
        int soal_id FK
        text jawaban_dipilih
        tinyint is_benar
        datetime client_ts "baru"
        datetime diperbarui_pada "baru"
    }
    NILAI_ESSAY {
        int id PK
        int siswa_id FK
        int ujian_id FK
        int soal_id FK
        int skor "0..poin soal"
        int dinilai_oleh FK "guru.id"
        datetime dinilai_pada
    }
    NILAI_UJIAN {
        int id PK
        int siswa_id FK
        int ujian_id FK
        int poin_otomatis "baru: PG+menjodohkan"
        int poin_essay "baru"
        int poin_maks "baru"
        int nilai "akhir 0..100"
        int benar
        int salah
        int kosong
        enum status_koreksi "baru"
        datetime selesai_pada
    }
    LOG_KECURANGAN {
        int id PK
        int siswa_id FK
        int ujian_id FK
        varchar jenis_kecurangan
        varchar device_type "baru"
        timestamp timestamp
    }
    AUDIT_ADMIN {
        int id PK
        int admin_id FK
        int sesi_id FK
        varchar aksi
        text detail
        timestamp dibuat_pada
    }
    SESSIONS {
        varchar session_id PK
        text data
        int expires
    }

    GURU ||--o{ PENGAJARAN : mengampu
    MATA_PELAJARAN ||--o{ PENGAJARAN : dalam
    KELAS ||--o{ PENGAJARAN : untuk
    PENGAJARAN ||--o{ UJIAN : memiliki
    UJIAN ||--o{ SOAL : berisi
    SISWA ||--o{ SESI_UJIAN : memulai
    UJIAN ||--o{ SESI_UJIAN : dikerjakan
    SISWA ||--o{ JAWABAN_SISWA : menjawab
    SOAL ||--o{ JAWABAN_SISWA : dijawab
    SISWA ||--o{ NILAI_ESSAY : dinilai
    SOAL ||--o{ NILAI_ESSAY : dinilai_pada
    GURU ||--o{ NILAI_ESSAY : menilai
    SISWA ||--o{ NILAI_UJIAN : memperoleh
    UJIAN ||--o{ NILAI_UJIAN : menghasilkan
    SISWA ||--o{ LOG_KECURANGAN : melanggar
    UJIAN ||--o{ LOG_KECURANGAN : tercatat
    ADMIN ||--o{ AUDIT_ADMIN : melakukan
```
Kolom bertanda "baru" belum ada di `database/schema.sql` dan ditambahkan lewat migrasi.

## 2. Aturan integritas
- `UNIQUE (siswa_id, ujian_id)` pada `sesi_ujian` dan `nilai_ujian`.
- `UNIQUE (siswa_id, ujian_id, soal_id)` pada `jawaban_siswa` dan `nilai_essay`.
- Seluruh FK `ON DELETE CASCADE` (kecuali `nilai_essay.dinilai_oleh` → `ON DELETE SET NULL`, dan `audit_admin.admin_id` → `SET NULL`).
- `siswa.kelas` menyimpan **nama** kelas (dipertahankan agar import Excel sederhana); validasi kecocokan dengan `kelas.nama_kelas` ujian dilakukan di aplikasi saat login.
- `sesi_ujian.status`: `sedang_ujian | selesai | keluar_paksa`. Online/offline **diturunkan** dari `last_seen`, bukan disimpan.
- `nilai_ujian.status_koreksi`: `menunggu_essay | selesai`.
- `soal.tipe_soal`: `pg | menjodohkan | essay`.
- `jawaban_siswa.jawaban_dipilih`: PG = huruf (`A`–`D`); menjodohkan = JSON array pasangan; essay = tidak dipakai.
- `nilai_essay.skor` harus `0 ≤ skor ≤ soal.poin` (divalidasi aplikasi).

## 3. Migrasi yang direncanakan
| No | File | Isi |
|----|------|-----|
| 001 | `001_ketahanan_sesi.sql` | `sesi_ujian`: `batas_waktu`, `tambahan_menit`, `seed`, `device_token`, `device_type`, `last_seen`, `selesai_pada`; `jawaban_siswa`: `client_ts`, `diperbarui_pada`; tabel `sessions` (bila store butuh dibuat manual) |
| 002 | `002_penilaian.sql` | tabel `nilai_essay`; `nilai_ujian`: `poin_otomatis`, `poin_essay`, `poin_maks`, `status_koreksi`; atur default `soal.poin` |
| 003 | `003_monitor_antikecurangan.sql` | tabel `audit_admin`; `ujian.token_ujian`; `log_kecurangan.device_type` |

Setiap migrasi: idempoten bila memungkinkan, dicatat di tabel `schema_migrations(nama, dijalankan_pada)`, dan **tidak menghapus data**. Sebelum migrasi di server nyata, lakukan backup.

## 4. Catatan data
- Data siswa asli tidak boleh masuk repo, dump, atau log. Gunakan data sintetis untuk pengembangan.
- `*.sql` diabaikan git kecuali `database/schema.sql` dan `database/migrations/*.sql`.
