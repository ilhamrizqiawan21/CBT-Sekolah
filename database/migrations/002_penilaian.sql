-- 002_penilaian.sql
-- Sesuai ERD §1, §2, §3 dan DESIGN §3.5

-- 1. Tambah kolom penilaian baru pada tabel nilai_ujian
ALTER TABLE nilai_ujian
  ADD COLUMN poin_otomatis INT NOT NULL DEFAULT 0 AFTER ujian_id,
  ADD COLUMN poin_essay INT NOT NULL DEFAULT 0 AFTER poin_otomatis,
  ADD COLUMN poin_maks INT NOT NULL DEFAULT 0 AFTER poin_essay,
  ADD COLUMN status_koreksi ENUM('menunggu_essay', 'selesai') NOT NULL DEFAULT 'selesai' AFTER kosong;

-- 2. Buat tabel nilai_essay untuk penilaian essay oleh guru (D-006, ERD §1)
CREATE TABLE IF NOT EXISTS nilai_essay (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  siswa_id     INT NOT NULL,
  ujian_id     INT NOT NULL,
  soal_id      INT NOT NULL,
  skor         INT NOT NULL DEFAULT 0,
  dinilai_oleh INT NULL,
  dinilai_pada DATETIME NULL,
  UNIQUE KEY uq_nilai_essay (siswa_id, ujian_id, soal_id),
  FOREIGN KEY (siswa_id)     REFERENCES siswa(id) ON DELETE CASCADE,
  FOREIGN KEY (ujian_id)     REFERENCES ujian(id) ON DELETE CASCADE,
  FOREIGN KEY (soal_id)      REFERENCES soal(id)  ON DELETE CASCADE,
  FOREIGN KEY (dinilai_oleh) REFERENCES guru(id)  ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Atur default poin soal baru menjadi 2 (PG/menjodohkan default 2, essay 4 di aplikasi; data lama tidak diubah diam-diam)
ALTER TABLE soal
  ALTER COLUMN poin SET DEFAULT 2;

