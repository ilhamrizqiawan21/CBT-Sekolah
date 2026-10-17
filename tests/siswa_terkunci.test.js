const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');

describe('Siswa terkunci (keluar_paksa) tidak ditutup diam-diam (temuan 6)', () => {
    let pool, seeded, finalizeJikaBerjalan, sesiService;

    const status = async (siswaId) => {
        const [r] = await pool.query('SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, seeded.ujianId]);
        return r[0].status;
    };
    const jumlahNilai = async (siswaId) => {
        const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, seeded.ujianId]);
        return r.n;
    };

    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
        ({ finalizeJikaBerjalan } = require('../services/finalizeService'));
        sesiService = require('../services/sesiService');
        await sesiService.mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'laptop', pool);
        await sesiService.mulaiAtauLanjut(seeded.siswa2Id, seeded.ujianId, 'laptop', pool);
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    test('1. sesi terkunci: selesai-ujian via socket tidak mengubah status dan tidak membuat nilai', async () => {
        await pool.query("UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE siswa_id = ?", [seeded.siswa1Id]);
        const hasil = await finalizeJikaBerjalan(seeded.siswa1Id, seeded.ujianId, pool);
        assert.equal(hasil, false);
        assert.equal(await status(seeded.siswa1Id), 'keluar_paksa');
        assert.equal(await jumlahNilai(seeded.siswa1Id), 0);
    });

    test('2. admin tetap dapat membuka kunci sesi yang terkunci (status tidak rusak)', async () => {
        const [r] = await pool.query(
            "UPDATE sesi_ujian SET status = 'sedang_ujian' WHERE siswa_id = ? AND status = 'keluar_paksa'",
            [seeded.siswa1Id]
        );
        assert.equal(r.affectedRows, 1);
    });

    test('3. sesi berjalan: dinilai dulu lalu ditutup (tidak ada status selesai tanpa nilai)', async () => {
        const hasil = await finalizeJikaBerjalan(seeded.siswa2Id, seeded.ujianId, pool);
        assert.equal(hasil, true);
        assert.equal(await status(seeded.siswa2Id), 'selesai');
        assert.equal(await jumlahNilai(seeded.siswa2Id), 1);
    });

    test('4. dipanggil ulang pada sesi yang sudah selesai: tidak berefek', async () => {
        assert.equal(await finalizeJikaBerjalan(seeded.siswa2Id, seeded.ujianId, pool), false);
        assert.equal(await jumlahNilai(seeded.siswa2Id), 1);
    });

    test('5. sesi tidak ada: false tanpa error', async () => {
        assert.equal(await finalizeJikaBerjalan(999999, seeded.ujianId, pool), false);
    });

    test('6. API siswa menolak sesi terkunci/selesai dengan kode yang bisa dibedakan klien', async () => {
        const { isSiswaAPI } = require('../middleware/auth');
        const panggil = async (siswaId) => {
            const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
            let lanjut = false;
            await isSiswaAPI({ session: { siswaId, ujianId: seeded.ujianId }, headers: {}, body: {} }, res, () => { lanjut = true; });
            return { res, lanjut };
        };
        await pool.query("UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE siswa_id = ?", [seeded.siswa1Id]);
        const terkunci = await panggil(seeded.siswa1Id);
        assert.equal(terkunci.res.code, 403);
        assert.equal(terkunci.res.body.code, 'keluar_paksa');
        const selesai = await panggil(seeded.siswa2Id);
        assert.equal(selesai.res.code, 403);
        assert.equal(selesai.res.body.code, 'selesai');
    });

    test('7. klien: respons terkunci ditangani sebelum data lokal dihapus dan tanpa event selesai-ujian', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ujian.js'), 'utf8');
        const fn = src.slice(src.indexOf('async function selesaiUjian()'), src.indexOf('// ── Socket Events ──'));
        const iTerkunci = fn.indexOf("data.code === 'keluar_paksa'");
        const iHapus = fn.indexOf('localStorage.removeItem(KEY_LOCAL_ANSWERS)');
        assert.ok(iTerkunci > 0 && iHapus > 0 && iTerkunci < iHapus, 'cek terkunci harus sebelum penghapusan data lokal');
        const blok = fn.slice(iTerkunci, fn.indexOf('return;', iTerkunci));
        assert.ok(!blok.includes("socket.emit('selesai-ujian')"));
        assert.ok(!blok.includes('removeItem'));
        assert.match(blok, /belum dinilai/);
    });
});
