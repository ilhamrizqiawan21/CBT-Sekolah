const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');

const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');
const { poinDefault } = require('../utils/helper');

describe('R-FINAL M2 & M3: hapus via POST dan default poin', () => {
    let pool, server, baseUrl, seeded, cookie;

    const request = (urlPath, method, data, ck) => new Promise((resolve, reject) => {
        const url = new URL(urlPath, baseUrl);
        const headers = {};
        if (ck) headers.Cookie = ck;
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
                resolve({ status: res.statusCode, body: out, cookie: sc ? sc.map(c => c.split(';')[0]).join('; ') : null });
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
        app.use(session({ secret: 'test-secret-rfinal', resave: false, saveUninitialized: false }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');
        app.use('/', require('../routes/index'));
        app.use('/guru', require('../routes/guru'));
        server = http.createServer(app);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
        cookie = (await request('/login-guru', 'POST', { username: 'guru_uji', password: '1234' })).cookie;
    });

    after(async () => {
        if (server) await new Promise(r => server.close(r));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    test('M2-1. GET /guru/soal/hapus/:id tidak menghapus soal', async () => {
        const before = await countSoal();
        await request(`/guru/soal/hapus/${seeded.soalId}`, 'GET', null, cookie);
        assert.equal(await countSoal(), before);
    });

    test('M2-2. POST /guru/soal/hapus/:id menghapus soal milik guru', async () => {
        const [r] = await pool.query("INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin) VALUES (?, 'essay', 'hapus aku', 4)", [seeded.ujianId]);
        const before = await countSoal();
        await request(`/guru/soal/hapus/${r.insertId}`, 'POST', null, cookie);
        assert.equal(await countSoal(), before - 1);
    });

    test('M3-1. poinDefault: PG 2, menjodohkan 2, essay 4; nilai valid dipertahankan', () => {
        assert.equal(poinDefault('pg'), 2);
        assert.equal(poinDefault('menjodohkan', ''), 2);
        assert.equal(poinDefault('essay', undefined), 4);
        assert.equal(poinDefault('pg', '3'), 3);
        assert.equal(poinDefault('pg', 'abc'), 2);
        assert.equal(poinDefault('pg', '0'), 2);
    });

    test('M3-2. Edit soal PG tanpa poin menyimpan poin 2', async () => {
        await request(`/guru/soal/edit/${seeded.soalId}`, 'POST', {
            ujian_id: seeded.ujianId, tipe_soal: 'pg', teks_soal: 'x', pilihan_a: 'a', pilihan_b: 'b',
            pilihan_c: 'c', pilihan_d: 'd', jawaban_benar: 'A'
        }, cookie);
        const [[s]] = await pool.query('SELECT poin FROM soal WHERE id = ?', [seeded.soalId]);
        assert.equal(s.poin, 2);
    });

    test('M3-3. Batch-tambah PG tanpa poin menyimpan poin 2', async () => {
        const res = await request('/guru/soal/batch-tambah', 'POST', {
            ujian_id: seeded.ujianId,
            soal_pg: [{ teks_soal: 'tanpa poin', pilihan_a: 'a', pilihan_b: 'b', pilihan_c: 'c', pilihan_d: 'd', jawaban_benar: 'A' }]
        }, cookie);
        assert.equal(res.status, 200);
        const [[s]] = await pool.query("SELECT poin FROM soal WHERE teks_soal = 'tanpa poin'");
        assert.equal(s.poin, 2);
    });
});
