-- 003_monitor_antikecurangan.sql
-- Sesuai ERD §1, §3 dan DESIGN §3.6, §3.7

-- 1. Buat tabel audit_admin untuk mencatat aksi pengawas/admin (T4.4, DESIGN §3.6)
CREATE TABLE IF NOT EXISTS audit_admin (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT NULL,
  sesi_id     INT NOT NULL,
  aksi        VARCHAR(50) NOT NULL,
  detail      TEXT NULL,
  dibuat_pada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_sesi (sesi_id),
  FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE SET NULL,
  FOREIGN KEY (sesi_id)  REFERENCES sesi_ujian(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 2. Tambah kolom device_type pada log_kecurangan (T5.1, ERD §1)
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE log_kecurangan ADD COLUMN device_type VARCHAR(20) NULL AFTER jenis_kecurangan',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_kecurangan' AND COLUMN_NAME = 'device_type');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Tambah kolom token_ujian pada ujian (T5.3, ERD §1)
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE ujian ADD COLUMN token_ujian VARCHAR(50) NULL AFTER batas_pelanggaran',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ujian' AND COLUMN_NAME = 'token_ujian');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

