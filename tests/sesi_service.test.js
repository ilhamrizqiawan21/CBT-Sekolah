const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    hitungBatasWaktu,
    hitungSisaDetik,
    bolehTerimaJawaban,
    ambilAlih,
    perpanjang,
    mulaiAtauLanjut
} = require('../services/sesiService');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('sesiService Unit Tests (Pure Logic)', () => {
    test('hitungBatasWaktu menghitung durasi + tambahan_menit dengan benar', () => {
        const waktuMulai = new Date('2026-10-07T08:00:00Z');
        const durasi = 60; // 60 menit
        const tambahanMenit = 15; // 15 menit
        const batas = hitungBatasWaktu(waktuMulai, durasi, tambahanMenit);

        assert.strictEqual(batas.toISOString(), '2026-10-07T09:15:00.000Z');
    });

    test('hitungBatasWaktu tidak melewati tanggal_selesai ujian (D-007)', () => {
        const waktuMulai = new Date('2026-10-07T08:00:00Z');
        const durasi = 120; // 2 jam -> 10:00
        const tanggalSelesaiUjian = new Date('2026-10-07T09:30:00Z'); // ujian tutup jam 09:30
        const batas = hitungBatasWaktu(waktuMulai, durasi, 0, tanggalSelesaiUjian);

        // Batas waktu harus dipotong di tanggal_selesai ujian (09:30)
        assert.strictEqual(batas.toISOString(), '2026-10-07T09:30:00.000Z');
    });

    test('hitungSisaDetik menghitung sisa waktu server-authoritative dengan benar', () => {
        const sesi = {
            batas_waktu: new Date('2026-10-07T09:00:00Z')
        };
        const now1 = new Date('2026-10-07T08:50:00Z'); // sisa 10 menit = 600 detik
        assert.strictEqual(hitungSisaDetik(sesi, now1), 600);

        const now2 = new Date('2026-10-07T08:59:30Z'); // sisa 30 detik
        assert.strictEqual(hitungSisaDetik(sesi, now2), 30);

        const now3 = new Date('2026-10-07T09:05:00Z'); // waktu habis -> 0
        assert.strictEqual(hitungSisaDetik(sesi, now3), 0);
    });

    test('bolehTerimaJawaban menolak sesi berstatus keluar_paksa dan selesai', () => {
        const sesiKeluarPaksa = {
            status: 'keluar_paksa',
            batas_waktu: new Date(Date.now() + 10000)
        };
        const resKeluar = bolehTerimaJawaban(sesiKeluarPaksa, new Date());
        assert.strictEqual(resKeluar.boleh, false);
        assert.strictEqual(resKeluar.alasan, 'keluar_paksa');

        const sesiSelesai = {
            status: 'selesai',
            batas_waktu: new Date(Date.now() + 10000)
        };
        const resSelesai = bolehTerimaJawaban(sesiSelesai, new Date());
        assert.strictEqual(resSelesai.boleh, false);
        assert.strictEqual(resSelesai.alasan, 'selesai');
    });

    test('bolehTerimaJawaban menerima jawaban normal saat server belum lewat batas_waktu', () => {
        const batas = new Date('2026-10-07T09:00:00Z');
        const sesi = { status: 'sedang_ujian', batas_waktu: batas };
        const now = new Date('2026-10-07T08:45:00Z');
        const clientTs = new Date('2026-10-07T08:44:59Z');

        const res = bolehTerimaJawaban(sesi, clientTs, now, 120);
        assert.strictEqual(res.boleh, true);
        assert.strictEqual(res.grace, false);
    });

    test('bolehTerimaJawaban dalam masa grace: diterima jika client_ts <= batas_waktu (D-009)', () => {
        const batas = new Date('2026-10-07T09:00:00Z');
        const sesi = { status: 'sedang_ujian', batas_waktu: batas };
        // Server menerima pada 09:01:00 (60 detik setelah batas, di dalam grace 120 detik)
        const now = new Date('2026-10-07T09:01:00Z');
        // Klien menjawab pada 08:59:50 (sebelum batas waktu habis)
        const clientTs = new Date('2026-10-07T08:59:50Z');

        const res = bolehTerimaJawaban(sesi, clientTs, now, 120);
        assert.strictEqual(res.boleh, true);
        assert.strictEqual(res.grace, true);
    });

    test('bolehTerimaJawaban dalam masa grace: ditolak jika client_ts > batas_waktu', () => {
        const batas = new Date('2026-10-07T09:00:00Z');
        const sesi = { status: 'sedang_ujian', batas_waktu: batas };
        // Server menerima pada 09:01:00
        const now = new Date('2026-10-07T09:01:00Z');
        // Klien menjawab pada 09:00:30 (dikerjakan setelah batas waktu habis)
        const clientTs = new Date('2026-10-07T09:00:30Z');

        const res = bolehTerimaJawaban(sesi, clientTs, now, 120);
        assert.strictEqual(res.boleh, false);
        assert.strictEqual(res.alasan, 'client_ts_melewati_batas');
    });

    test('bolehTerimaJawaban ditolak setelah melewati masa grace', () => {
        const batas = new Date('2026-10-07T09:00:00Z');
        const sesi = { status: 'sedang_ujian', batas_waktu: batas };
        // Server menerima pada 09:02:05 (125 detik setelah batas, lewat grace 120 detik)
        const now = new Date('2026-10-07T09:02:05Z');
        const clientTs = new Date('2026-10-07T08:59:00Z');

        const res = bolehTerimaJawaban(sesi, clientTs, now, 120);
        assert.strictEqual(res.boleh, false);
        assert.strictEqual(res.alasan, 'melewati_grace_period');
    });
});

describe('sesiService Integration Tests (cbt_sekolah_test)', () => {
    let pool;
    let seeded;

    before(async () => {
        pool = getTestPool();
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
    });

    test('mulaiAtauLanjut membuat sesi baru dengan batas_waktu dan device_token', async () => {
        const result = await mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop', pool);

        assert.strictEqual(result.status, 'baru');
        assert.strictEqual(result.takeOver, false);
        assert.ok(result.sesi.device_token, 'Harus memiliki device_token');
        assert.ok(result.sesi.seed, 'Harus memiliki random seed');
        assert.strictEqual(result.sesi.status, 'sedang_ujian');
        assert.ok(result.sesi.batas_waktu, 'Harus memiliki batas_waktu');
    });

    test('mulaiAtauLanjut pada sesi aktif melakukan take-over dan mengganti device_token', async () => {
        // Panggilan pertama
        const res1 = await mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop', pool);
        const token1 = res1.sesi.device_token;
        const waktuMulai1 = new Date(res1.sesi.waktu_mulai).getTime();
        const batasWaktu1 = new Date(res1.sesi.batas_waktu).getTime();

        // Panggilan kedua (take-over, misal login ulang di HP)
        const res2 = await mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'hp', pool);

        assert.strictEqual(res2.status, 'lanjut');
        assert.strictEqual(res2.takeOver, true);
        assert.notStrictEqual(res2.sesi.device_token, token1, 'device_token baru harus berbeda (take-over)');
        assert.strictEqual(res2.sesi.device_type, 'hp');

        // waktu_mulai dan batas_waktu tidak boleh berubah
        const waktuMulai2 = new Date(res2.sesi.waktu_mulai).getTime();
        const batasWaktu2 = new Date(res2.sesi.batas_waktu).getTime();
        assert.strictEqual(waktuMulai2, waktuMulai1, 'waktu_mulai tidak boleh direset saat lanjut');
        assert.strictEqual(batasWaktu2, batasWaktu1, 'batas_waktu tidak boleh direset saat lanjut');
    });

    test('mulaiAtauLanjut menolak siswa yang keluar_paksa', async () => {
        const res = await mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop', pool);
        await pool.query("UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE id = ?", [res.sesi.id]);

        const resBlocked = await mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop', pool);
        assert.strictEqual(resBlocked.status, 'keluar_paksa');
    });

    test('perpanjang menambah menit dan memajukan batas_waktu di DB', async () => {
        const res = await mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop', pool);
        const batasAwal = new Date(res.sesi.batas_waktu);

        const updated = await perpanjang(res.sesi.id, 15, pool);
        const batasBaru = new Date(updated.batas_waktu);

        assert.strictEqual(updated.tambahan_menit, 15);
        assert.strictEqual(batasBaru.getTime() - batasAwal.getTime(), 15 * 60 * 1000);
    });
});
