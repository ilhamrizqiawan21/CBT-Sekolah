-- 005_pengaturan_sekolah.sql
-- Tabel pengaturan aplikasi untuk identitas sekolah (nama sekolah, logo)

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci VARCHAR(50) PRIMARY KEY,
  nilai TEXT NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO pengaturan (kunci, nilai) VALUES
  ('nama_sekolah', 'CBT Sekolah'),
  ('logo_sekolah', '');

