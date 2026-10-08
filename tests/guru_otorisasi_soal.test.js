const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');

describe('Otorisasi guru pada edit & batch-tambah soal (R-FINAL B1, M1)', () => {
    let pool, server, baseUrl, seeded;
    let guru1Cookie, guru2Cookie;

    const request = (urlPath, method, data, cookie) => new Promise((resolve, reject) => {
        const url = new URL(urlPath, baseUrl);
        const headers = {};
        if (cookie) headers.Cookie = cookie;
        let body = null;
        if (data) {
            body = JSON.stringify(data);
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers }, res => {
            let out = '';
            res.setEncoding('utf8');
            res.on('data', c => { out += c; });
            res.on('end', () => {
                const sc = res.headers['set-cookie'];
                resolve({ status: res.statusCode, headers: res.headers, body: out, cookie: sc ? sc.map(c => c.split(';')[0]).join('; ') : null });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });

    const countSoal = async () => (await pool.query('SELECT COUNT(*) AS n FROM soal'))[0][0].n;

    before(async () => {
        pool = getTestPool();
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({ secret: 'test-secret-otorisasi', resave: false, saveUninitialized: false }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');
        app.use('/', require('../routes/index'));
        app.use('/guru', require('../routes/guru'));
        server = http.createServer(app);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        baseUrl = `http://127.0.0.1:${server.address().port}`;

        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
        const hash = await bcrypt.hash('1234', 10);
        await pool.query("INSERT INTO guru (nip, nama, username, password) VALUES ('19800303', 'Guru Lain', 'guru_lain', ?)", [hash]);
        guru1Cookie = (await request('/login-guru', 'POST', { username: 'guru_uji', password: '1234' })).cookie;
        guru2Cookie = (await request('/login-guru', 'POST', { username: 'guru_lain', password: '1234' })).cookie;
    });

    after(async () => {
        if (server) await new Promise(r => server.close(r));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await pool.query("UPDATE soal SET teks_soal = 'Soal asli', jawaban_benar = 'B' WHERE id = ?", [seeded.soalId]);
    });

    const payloadEdit = (over = {}) => ({
        ujian_id: seeded.ujianId, tipe_soal: 'pg', teks_soal: 'DIUBAH', poin: 2,
        pilihan_a: 'a', pilihan_b: 'b', pilihan_c: 'c', pilihan_d: 'd', jawaban_benar: 'A', ...over
    });

    test('1. Guru non-pengampu tidak dapat mengedit soal ujian guru lain', async () => {
        const res = await request(`/guru/soal/edit/${seeded.soalId}`, 'POST', payloadEdit(), guru2Cookie);
        assert.notEqual(res.status, 200);
        const [[soal]] = await pool.query('SELECT teks_soal, jawaban_benar FROM soal WHERE id = ?', [seeded.soalId]);
        assert.equal(soal.teks_soal, 'Soal asli');
        assert.equal(soal.jawaban_benar, 'B');
    });

    test('2. Guru pengampu tidak dapat memindahkan soal ke ujian yang bukan miliknya', async () => {
        await request(`/guru/soal/edit/${seeded.soalId}`, 'POST', payloadEdit({ ujian_id: 99999 }), guru1Cookie);
        const [[soal]] = await pool.query('SELECT ujian_id, teks_soal FROM soal WHERE id = ?', [seeded.soalId]);
        assert.equal(soal.ujian_id, seeded.ujianId);
        assert.equal(soal.teks_soal, 'Soal asli');
    });

    test('3. Guru pengampu tetap dapat mengedit soalnya sendiri', async () => {
        await request(`/guru/soal/edit/${seeded.soalId}`, 'POST', payloadEdit(), guru1Cookie);
        const [[soal]] = await pool.query('SELECT teks_soal, jawaban_benar FROM soal WHERE id = ?', [seeded.soalId]);
        assert.equal(soal.teks_soal, 'DIUBAH');
        assert.equal(soal.jawaban_benar, 'A');
    });

    const batch = (over = {}) => ({
        ujian_id: seeded.ujianId,
        soal_pg: [{ teks_soal: 'PG baru', poin: 2, pilihan_a: 'a', pilihan_b: 'b', pilihan_c: 'c', pilihan_d: 'd', jawaban_benar: 'A' }],
        soal_menjodohkan: [], soal_essay: [{ teks_soal: 'Essay baru', poin: 4 }], pengecoh: [], ...over
    });

    test('4. Guru non-pengampu ditolak (403) pada batch-tambah dan tidak ada soal tersisip', async () => {
        const before = await countSoal();
        const res = await request('/guru/soal/batch-tambah', 'POST', batch(), guru2Cookie);
        assert.equal(res.status, 403);
        assert.equal(await countSoal(), before);
    });

    test('5. Batch-tambah oleh pengampu berhasil', async () => {
        const before = await countSoal();
        const res = await request('/guru/soal/batch-tambah', 'POST', batch(), guru1Cookie);
        assert.equal(res.status, 200);
        assert.equal(JSON.parse(res.body).total, 2);
        assert.equal(await countSoal(), before + 2);
    });

    test('6. Batch-tambah dengan bentuk data salah -> 400 tanpa membocorkan pesan error', async () => {
        const before = await countSoal();
        const res = await request('/guru/soal/batch-tambah', 'POST', { ujian_id: seeded.ujianId, soal_pg: 'bukan array' }, guru1Cookie);
        assert.equal(res.status, 400);
        assert.equal(await countSoal(), before);
        assert.doesNotMatch(res.body, /is not iterable|undefined/);
    });

    test('7. Batch-tambah bersifat atomik: kegagalan di tengah membatalkan semua insert', async () => {
        const before = await countSoal();
        // Essay kedua melanggar batas panjang kolom/tipe -> insert gagal setelah PG tersisip
        const res = await request('/guru/soal/batch-tambah', 'POST',
            batch({ soal_essay: [{ teks_soal: 'Essay ok', poin: 4 }, { teks_soal: 'x', poin: 'bukan angka' }] }), guru1Cookie);
        assert.equal(res.status, 400);
        assert.equal(await countSoal(), before);
    });
});
