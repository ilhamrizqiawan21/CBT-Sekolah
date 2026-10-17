const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('T7.2 Guru: Export Daftar Soal ke Excel (/guru/kelola-soal/export)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let guru1Cookie;
    let guru2Cookie;
    let guru1Id;
    let guru2Id;
    let ujian1Id;
    let ujian2Id;

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const payload = body ? new URLSearchParams(body).toString() : null;
            const headers = {};
            if (payload) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) headers['Cookie'] = cookie;

            const req = http.request(url, { method, headers }, (res) => {
                const chunks = [];
                res.on('data', chunk => { chunks.push(chunk); });
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const setCookie = res.headers['set-cookie'];
                    const cookieHeader = setCookie && setCookie.length > 0 ? setCookie[0].split(';')[0] : null;
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: buffer.toString('utf8'),
                        rawBody: buffer,
                        cookie: cookieHeader
                    });
                });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-guru-export',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        app.use('/', require('../routes/index'));
        app.use('/guru', require('../routes/guru'));

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        guru1Id = seeded.guruId;
        ujian1Id = seeded.ujianId;

        // Buat Guru 2 dengan pengajaran, ujian, dan soal terpisah
        const hashedPin = await bcrypt.hash('1234', 10);
        const [resGuru2] = await pool.query(
            "INSERT INTO guru (nip, nama, username, password) VALUES ('19800202', 'Guru Kedua', 'guru_kedua', ?)",
            [hashedPin]
        );
        guru2Id = resGuru2.insertId;

        const [resMapel2] = await pool.query("INSERT INTO mata_pelajaran (nama_mapel) VALUES ('Bahasa Arab')");
        const mapel2Id = resMapel2.insertId;

        const [resKelas] = await pool.query("SELECT id FROM kelas LIMIT 1");
        const kelasId = resKelas[0].id;

        const [resPengajaran2] = await pool.query(
            "INSERT INTO pengajaran (guru_id, mapel_id, kelas_id) VALUES (?, ?, ?)",
            [guru2Id, mapel2Id, kelasId]
        );
        const pengajaran2Id = resPengajaran2.insertId;

        const [resUjian2] = await pool.query(
            `INSERT INTO ujian (pengajaran_id, nama_ujian, durasi, tanggal_mulai, tanggal_selesai, batas_pelanggaran)
             VALUES (?, 'Ujian Harian Bahasa Arab', 60, NOW() - INTERVAL 10 MINUTE, NOW() + INTERVAL 50 MINUTE, 3)`,
            [pengajaran2Id]
        );
        ujian2Id = resUjian2.insertId;

        await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', 'Soal Bahasa Arab Guru 2', 2, 'Opsi A', 'Opsi B', 'Opsi C', 'Opsi D', 'a')`,
            [ujian2Id]
        );

        // Login Guru 1
        const login1Res = await makeRequest('/login-guru', 'POST', {
            username: 'guru_uji',
            password: seeded.defaultPin
        });
        guru1Cookie = login1Res.cookie;

        // Login Guru 2
        const login2Res = await makeRequest('/login-guru', 'POST', {
            username: 'guru_kedua',
            password: '1234'
        });
        guru2Cookie = login2Res.cookie;
    });

    test('0. Akses tanpa login ditolak dan diarahkan ke /login-guru', async () => {
        const res = await makeRequest('/guru/kelola-soal/export', 'GET');
        assert.strictEqual(res.statusCode, 302);
        assert.match(res.headers.location, /\/login-guru/);
    });

    test('1. Guru 1 berhasil mengekspor soal miliknya dalam format Excel valid', async () => {
        const res = await makeRequest('/guru/kelola-soal/export', 'GET', null, guru1Cookie);
        assert.strictEqual(res.statusCode, 200);
        assert.match(res.headers['content-type'], /spreadsheetml/);
        assert.ok(res.rawBody.length > 0, 'Ukuran file harus > 0');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.rawBody);
        const worksheet = workbook.getWorksheet('Bank Soal') || workbook.worksheets[0];
        assert.ok(worksheet, 'Worksheet harus ada');

        // Periksa baris header
        const headerRow = worksheet.getRow(1);
        const headers = headerRow.values.filter(Boolean);
        assert.ok(headers.includes('Ujian'));
        assert.ok(headers.includes('Tipe Soal'));
        assert.ok(headers.includes('Teks Soal'));
        assert.ok(headers.includes('Poin'));
        assert.ok(headers.includes('Jawaban Benar'));

        // Pastikan hanya memuat soal milik guru 1 (ujian Matematika) dan tidak ada soal Guru 2
        let rowCount = 0;
        let containsGuru2Soal = false;
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                rowCount++;
                const rowStr = JSON.stringify(row.values);
                if (rowStr.includes('Bahasa Arab') || rowStr.includes('Guru 2')) {
                    containsGuru2Soal = true;
                }
            }
        });
        assert.ok(rowCount > 0, 'Harus ada soal milik Guru 1 yang terekspor');
        assert.strictEqual(containsGuru2Soal, false, 'Soal Guru 2 tidak boleh ada di export Guru 1');
    });

    test('2. Filter ?ujian=<id> milik sendiri mengekspor soal ujian tersebut', async () => {
        const res = await makeRequest(`/guru/kelola-soal/export?ujian=${ujian1Id}`, 'GET', null, guru1Cookie);
        assert.strictEqual(res.statusCode, 200);
        assert.match(res.headers['content-type'], /spreadsheetml/);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.rawBody);
        const worksheet = workbook.worksheets[0];

        let count = 0;
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) count++;
        });
        assert.ok(count > 0, 'Harus ada baris soal untuk ujian 1');
    });

    test('3. Guru 2 mencoba ekspor ujian Guru 1 ditolak atau menghasilkan sheet kosong (bukan 500)', async () => {
        const res = await makeRequest(`/guru/kelola-soal/export?ujian=${ujian1Id}`, 'GET', null, guru2Cookie);
        assert.notStrictEqual(res.statusCode, 500, 'Tidak boleh mengembalikan 500 error');

        if (res.statusCode === 200) {
            // Jika 200, harus menghasilkan 0 baris data soal (tidak bocor)
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(res.rawBody);
            const worksheet = workbook.worksheets[0];
            let dataRowCount = 0;
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber > 1) dataRowCount++;
            });
            assert.strictEqual(dataRowCount, 0, 'Guru 2 tidak boleh mendapatkan soal milik Guru 1');
        } else {
            // Bisa berupa 403 Forbidden
            assert.strictEqual(res.statusCode, 403);
        }
    });
});
