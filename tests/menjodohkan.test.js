const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');
const { finalizeSesi } = require('../services/finalizeService');

describe('Soal menjodohkan: jawaban per pasangan, tanpa kebocoran kunci', () => {
    let pool, seeded, server, baseUrl, cookie, soalMenId;
    const PASANGAN = [
        { kiri: 'كِتَابٌ', kanan: 'Buku' },
        { kiri: 'قَلَمٌ', kanan: 'Pena' },
        { kiri: 'بَابٌ', kanan: 'Pintu' }
    ];
    const PENGECOH = ['Meja'];

    before(async () => {
        pool = getTestPool();
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({ secret: 't', resave: false, saveUninitialized: false }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');
        app.use('/', require('../routes/index'));
        app.use('/api', require('../routes/api'));
        server = http.createServer(app);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await new Promise(r => server.close(r));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    function req(p, method = 'GET', body = null, ck = null) {
        return new Promise((resolve, reject) => {
            const headers = {};
            let payload = null;
            if (body) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
            if (ck) headers.Cookie = ck;
            const r = http.request(new URL(p, baseUrl), { method, headers }, res => {
                let d = '';
                res.on('data', c => { d += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: d, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] || null }));
            });
            r.on('error', reject);
            if (payload) r.write(payload);
            r.end();
        });
    }

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
        const [r] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan)
             VALUES (?, 'menjodohkan', 'Pasangkan', 4, ?, ?)`,
            [seeded.ujianId, JSON.stringify(PASANGAN), JSON.stringify({ pasangan: PASANGAN, pengecoh: PENGECOH })]
        );
        soalMenId = r.insertId;
        const login = await req('/login-siswa', 'POST', { nis: 'T0001', pin: seeded.defaultPin, ujian_id: String(seeded.ujianId), device_type: 'laptop' });
        cookie = login.cookie;
    });

    const kirim = jawaban => req('/api/sinkron-jawaban', 'POST', { jawaban: [{ soal_id: soalMenId, jawaban, client_ts: new Date().toISOString() }] }, cookie);
    const poinMen = async () => {
        await finalizeSesi(seeded.siswa1Id, seeded.ujianId, pool);
        const [[nu]] = await pool.query('SELECT poin_otomatis FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        return nu.poin_otomatis;
    };

    test('API soal tidak membocorkan pasangan benar; opsi kanan memuat pengecoh', async () => {
        const res = await req(`/api/soal/${seeded.ujianId}`, 'GET', null, cookie);
        assert.equal(res.status, 200);
        const soal = JSON.parse(res.body).find(s => s.id === soalMenId);
        assert.deepEqual(soal.kiri, PASANGAN.map(p => p.kiri));
        assert.deepEqual([...soal.opsi_kanan].sort(), ['Buku', 'Pena', 'Pintu', 'Meja'].sort());
        assert.equal(soal.pasangan, undefined);
        assert.equal(soal.pengecoh, undefined);
        assert.equal(soal.jawaban_benar, undefined);
        assert.ok(!res.body.includes('jawaban_benar'));
    });

    test('Urutan opsi kanan konsisten untuk siswa yang sama (seed persisten)', async () => {
        const a = JSON.parse((await req(`/api/soal/${seeded.ujianId}`, 'GET', null, cookie)).body).find(s => s.id === soalMenId);
        const b = JSON.parse((await req(`/api/soal/${seeded.ujianId}`, 'GET', null, cookie)).body).find(s => s.id === soalMenId);
        assert.deepEqual(a.opsi_kanan, b.opsi_kanan);
    });

    test('Semua pasangan benar (urutan berbeda, kunci objek berbeda) -> poin penuh', async () => {
        const jawaban = JSON.stringify([
            { kanan: 'Pintu', kiri: 'بَابٌ' },
            { kiri: 'كِتَابٌ', kanan: 'Buku' },
            { kiri: 'قَلَمٌ', kanan: 'Pena' }
        ]);
        assert.equal((await kirim(jawaban)).status, 200);
        assert.equal(await poinMen(), 4);
    });

    test('Satu pasangan salah -> 0 poin (all-or-nothing)', async () => {
        const jawaban = JSON.stringify([
            { kiri: 'كِتَابٌ', kanan: 'Buku' },
            { kiri: 'قَلَمٌ', kanan: 'Meja' },
            { kiri: 'بَابٌ', kanan: 'Pintu' }
        ]);
        await kirim(jawaban);
        assert.equal(await poinMen(), 0);
    });

    test('Pasangan belum lengkap -> 0 poin; belum dijawab -> kosong', async () => {
        await kirim(JSON.stringify([{ kiri: 'كِتَابٌ', kanan: 'Buku' }]));
        assert.equal(await poinMen(), 0);
        await kirim('');
        await finalizeSesi(seeded.siswa1Id, seeded.ujianId, pool);
        const [[nu]] = await pool.query('SELECT kosong FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        assert.ok(nu.kosong >= 1);
    });
});
