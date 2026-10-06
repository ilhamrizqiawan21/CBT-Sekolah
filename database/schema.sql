-- Schema CBT Sekolah (direkonstruksi dari query di app.js, routes/*.js, controllers/*.js)
-- Pakai: mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS cbt_sekolah
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cbt_sekolah;

CREATE TABLE IF NOT EXISTS admin (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(50)  NOT NULL UNIQUE,
  password   VARCHAR(100) NOT NULL,            -- hash bcrypt
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS guru (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nip        VARCHAR(30)  NOT NULL,
  nama       VARCHAR(100) NOT NULL,
  username   VARCHAR(50)  NOT NULL UNIQUE,
  password   VARCHAR(100) NOT NULL,            -- hash bcrypt
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS kelas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nama_kelas VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mata_pelajaran (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nama_mapel VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- siswa.kelas menyimpan nama kelas (bukan id); kode meng-JOIN lewat kelas.nama_kelas
CREATE TABLE IF NOT EXISTS siswa (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nis        VARCHAR(30)  NOT NULL UNIQUE,
  nama       VARCHAR(100) NOT NULL,
  kelas      VARCHAR(30)  NULL,
  pin_ujian  VARCHAR(100) NOT NULL,            -- hash bcrypt
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_siswa_kelas (kelas)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pengajaran (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  guru_id  INT NOT NULL,
  mapel_id INT NOT NULL,
  kelas_id INT NOT NULL,
  UNIQUE KEY uq_pengajaran (guru_id, mapel_id, kelas_id),
  FOREIGN KEY (guru_id)  REFERENCES guru(id)           ON DELETE CASCADE,
  FOREIGN KEY (mapel_id) REFERENCES mata_pelajaran(id) ON DELETE CASCADE,
  FOREIGN KEY (kelas_id) REFERENCES kelas(id)          ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ujian (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  pengajaran_id     INT NOT NULL,
  nama_ujian        VARCHAR(150) NOT NULL,
  durasi            INT NOT NULL DEFAULT 60,   -- menit
  tanggal_mulai     DATETIME NOT NULL,
  tanggal_selesai   DATETIME NOT NULL,
  acak_soal         TINYINT(1) NOT NULL DEFAULT 0,
  acak_pilihan      TINYINT(1) NOT NULL DEFAULT 0,
  batas_pelanggaran INT NOT NULL DEFAULT 3,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pengajaran_id) REFERENCES pengajaran(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- tipe_soal: 'pg' | 'menjodohkan' | 'essay'
-- jawaban_benar: huruf (pg) atau JSON (menjodohkan / kata kunci essay)
CREATE TABLE IF NOT EXISTS soal (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  ujian_id      INT NOT NULL,
  tipe_soal     VARCHAR(20) NOT NULL DEFAULT 'pg',
  teks_soal     TEXT NOT NULL,
  gambar        VARCHAR(255) NULL,
  poin          INT NOT NULL DEFAULT 1,
  pilihan_a     TEXT NULL,
  pilihan_b     TEXT NULL,
  pilihan_c     TEXT NULL,
  pilihan_d     TEXT NULL,
  jawaban_benar TEXT NULL,
  opsi_tambahan TEXT NULL,                     -- JSON
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ujian_id) REFERENCES ujian(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- UNIQUE KEY dibutuhkan oleh INSERT ... ON DUPLICATE KEY UPDATE di kode
CREATE TABLE IF NOT EXISTS sesi_ujian (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  siswa_id    INT NOT NULL,
  ujian_id    INT NOT NULL,
  socket_id   VARCHAR(50) NULL,
  waktu_mulai DATETIME NULL,
  status      ENUM('sedang_ujian','selesai','keluar_paksa') NOT NULL DEFAULT 'sedang_ujian',
  UNIQUE KEY uq_sesi (siswa_id, ujian_id),
  FOREIGN KEY (siswa_id) REFERENCES siswa(id)  ON DELETE CASCADE,
  FOREIGN KEY (ujian_id) REFERENCES ujian(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jawaban_siswa (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  siswa_id        INT NOT NULL,
  ujian_id        INT NOT NULL,
  soal_id         INT NOT NULL,
  jawaban_dipilih TEXT NULL,
  is_benar        TINYINT(1) NULL,
  UNIQUE KEY uq_jawaban (siswa_id, ujian_id, soal_id),
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE,
  FOREIGN KEY (ujian_id) REFERENCES ujian(id) ON DELETE CASCADE,
  FOREIGN KEY (soal_id)  REFERENCES soal(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS nilai_ujian (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  siswa_id     INT NOT NULL,
  ujian_id     INT NOT NULL,
  nilai        INT NOT NULL DEFAULT 0,
  benar        INT NOT NULL DEFAULT 0,
  salah        INT NOT NULL DEFAULT 0,
  kosong       INT NOT NULL DEFAULT 0,
  selesai_pada DATETIME NULL,
  UNIQUE KEY uq_nilai (siswa_id, ujian_id),
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE,
  FOREIGN KEY (ujian_id) REFERENCES ujian(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- jenis_kecurangan: 'pindah_tab' | 'keluar_fullscreen' | 'copy_paste'
CREATE TABLE IF NOT EXISTS log_kecurangan (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  siswa_id         INT NOT NULL,
  ujian_id         INT NOT NULL,
  jenis_kecurangan VARCHAR(30) NOT NULL,
  timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_siswa_ujian (siswa_id, ujian_id),
  FOREIGN KEY (siswa_id) REFERENCES siswa(id) ON DELETE CASCADE,
  FOREIGN KEY (ujian_id) REFERENCES ujian(id) ON DELETE CASCADE
) ENGINE=InnoDB;
