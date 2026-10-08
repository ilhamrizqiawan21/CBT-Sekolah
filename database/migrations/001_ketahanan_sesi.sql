-- 001_ketahanan_sesi.sql
-- Sesuai ERD §3

-- 1. Tambah kolom ketahanan sesi pada tabel sesi_ujian
ALTER TABLE sesi_ujian
  ADD COLUMN batas_waktu DATETIME NULL AFTER waktu_mulai,
  ADD COLUMN tambahan_menit INT NOT NULL DEFAULT 0 AFTER batas_waktu,
  ADD COLUMN seed INT NULL AFTER tambahan_menit,
  ADD COLUMN device_token CHAR(36) NULL AFTER seed,
  ADD COLUMN device_type VARCHAR(20) NULL AFTER device_token,
  ADD COLUMN last_seen DATETIME NULL AFTER device_type,
  ADD COLUMN selesai_pada DATETIME NULL AFTER last_seen;

-- 2. Tambah kolom timestamp sinkronisasi pada tabel jawaban_siswa
ALTER TABLE jawaban_siswa
  ADD COLUMN client_ts DATETIME NULL AFTER is_benar,
  ADD COLUMN diperbarui_pada DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER client_ts;

-- 3. Pastikan tabel sessions tersedia untuk session store
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB;

