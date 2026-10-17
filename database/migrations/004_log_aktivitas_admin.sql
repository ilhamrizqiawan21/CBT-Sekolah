-- 004_log_aktivitas_admin.sql
-- Audit trail untuk aksi CRUD umum admin (tambah/edit/hapus guru, siswa, soal,
-- kelas, mapel, ujian, pengajaran, akun admin). Berbeda dari audit_admin yang
-- khusus mencatat aksi kontrol sesi ujian (buka-kunci, tambah-waktu, paksa-selesai).

CREATE TABLE IF NOT EXISTS log_aktivitas_admin (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT NULL,
  aksi        VARCHAR(20) NOT NULL,
  entitas     VARCHAR(50) NOT NULL,
  entitas_id  INT NULL,
  detail      TEXT NULL,
  dibuat_pada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_aktivitas_admin (admin_id),
  INDEX idx_log_aktivitas_entitas (entitas, entitas_id),
  FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE SET NULL
) ENGINE=InnoDB;
