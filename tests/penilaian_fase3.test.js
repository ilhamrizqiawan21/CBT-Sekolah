const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');
const fs = require('fs');

const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('Fase 3 — Penilaian & Input Essay Guru (T3.5, T3.6, T3.7)', () => {
    let pool;
    let server;
    let baseUrl;
    let port;
    let seeded;
    let guru1Cookie;
    let guru2Cookie;
    let guru2Id;
    let soalEssayId;
    let siswaId;
    let ujianId;

    const makeRequest = (urlPath, method = 'GET', data = null, cookie = null, contentType = null) => {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const headers = {};
            if (cookie) headers['Cookie'] = cookie;

            let body = null;
            if (data !== null && data !== undefined) {
                if (contentType === 'application/json') {
                    body = JSON.stringify(data);
                    headers['Content-Type'] = 'application/json';
                } else if (Buffer.isBuffer(data)) {
                    body = data;
                    if (contentType) headers['Content-Type'] = contentType;
                } else if (typeof data === 'object') {
                    body = new URLSearchParams();
                    const flatten = (obj, prefix = '') => {
                        for (const key of Object.keys(obj)) {
                            const propName = prefix ? `${prefix}[${key}]` : key;
                            if (typeof obj[key] === 'object' && obj[key] !== null) {
                                flatten(obj[key], propName);
                            } else {
                                body.append(propName, obj[key]);
                            }
                        }
                    };
                    flatten(data);
                    body = body.toString();
                    headers['Content-Type'] = 'application/x-www-form-urlencoded';
                } else {
                    body = String(data);
                }
                headers['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
            }

            const req = http.request({
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method,
                headers
            }, (res) => {
                let responseBody = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { responseBody += chunk; });
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    let cookieHeader = null;
                    if (setCookie) {
                        cookieHeader = setCookie.map(c => c.split(';')[0]).join('; ');
                    }
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: responseBody,
                        cookie: cookieHeader
                    });
                });
            });

            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    };

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-penilaian',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));

        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        const indexRouter = require('../routes/index');
        const guruRouter = require('../routes/guru');
        const apiRouter = require('../routes/api');

        app.use('/', indexRouter);
        app.use('/guru', guruRouter);
        app.use('/api', apiRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
        ujianId = seeded.ujianId;
        siswaId = seeded.siswa1Id;

        // 1. Buat guru kedua (tidak mengampu ujian ini)
        const hashedPin = await bcrypt.hash('1234', 10);
        const [resG2] = await pool.query(
            "INSERT INTO guru (nip, nama, username, password) VALUES ('19800202', 'Guru Lain', 'guru_lain', ?)",
            [hashedPin]
        );
        guru2Id = resG2.insertId;

        // 2. Tambah soal essay ke ujian (poin 4)
        const [resEssay] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin)
             VALUES (?, 'essay', 'Jelaskan rumus Pythagoras!', 4)`,
            [ujianId]
        );
        soalEssayId = resEssay.insertId;

        // 3. Siswa 1 menjawab soal PG benar
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar)
             VALUES (?, ?, ?, 'B', 1)`,
            [siswaId, ujianId, seeded.soalId]
        );

        // Sesi siswa 1 (berjalan) lalu difinalisasi -> status selesai
        await pool.query(
            `INSERT INTO sesi_ujian (siswa_id, ujian_id, waktu_mulai, batas_waktu, seed, device_token, status)
             VALUES (?, ?, NOW(), NOW() + INTERVAL 60 MINUTE, 1, 'tok', 'sedang_ujian')`,
            [siswaId, ujianId]
        );

        // 4. Finalisasi awal siswa 1 (sebelum guru menilai essay)
        const { finalizeSesi } = require('../services/finalizeService');
        await finalizeSesi(siswaId, ujianId, pool);

        // 5. Login Guru 1 (pengampu)
        // Login sekali saja (rate limiter login guru 10x/15 menit). ID guru deterministik
        // karena TRUNCATE mereset auto-increment dan urutan seed selalu sama.
        if (!guru1Cookie) {
            const resLoginG1 = await makeRequest('/login-guru', 'POST', {
                username: 'guru_uji',
                password: '1234'
            });
            guru1Cookie = resLoginG1.cookie;
        }

        // 6. Login Guru 2 (bukan pengampu)
        if (!guru2Cookie) {
            const resLoginG2 = await makeRequest('/login-guru', 'POST', {
                username: 'guru_lain',
                password: '1234'
            });
            guru2Cookie = resLoginG2.cookie;
        }
    });

    test('Status koreksi awal adalah menunggu_essay dan nilai otomatis tersimpan', async () => {
        const [rows] = await pool.query('SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, ujianId]);
        assert.equal(rows.length, 1);
        const nu = rows[0];
        assert.equal(nu.poin_otomatis, 2); // PG benar 2 poin
        assert.equal(nu.poin_essay, 0);
        assert.equal(nu.poin_maks, 6); // 2 (PG) + 4 (Essay) = 6
        assert.equal(nu.status_koreksi, 'menunggu_essay');
        assert.equal(nu.nilai, 33); // round(2 / 6 * 100) = 33
    });

    test('Guru lain ditolak dengan status 403 saat akses GET /guru/essay/:ujianId', async () => {
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'GET', null, guru2Cookie);
        assert.equal(res.statusCode, 403);
    });

    test('Guru lain ditolak dengan status 403 saat POST nilai /guru/essay/:ujianId', async () => {
        const payload = {
            skor: {
                [`s_${siswaId}`]: {
                    [`q_${soalEssayId}`]: '4'
                }
            }
        };
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'POST', payload, guru2Cookie);
        assert.equal(res.statusCode, 403);
    });

    test('Validasi rentang: Skor > poin soal ditolak dengan status 400', async () => {
        const payload = {
            skor: {
                [`s_${siswaId}`]: {
                    [`q_${soalEssayId}`]: '5' // Max poin adalah 4
                }
            }
        };
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'POST', payload, guru1Cookie);
        assert.equal(res.statusCode, 400);
    });

    test('Validasi rentang: Skor negatif ditolak dengan status 400', async () => {
        const payload = {
            skor: {
                [`s_${siswaId}`]: {
                    [`q_${soalEssayId}`]: '-1'
                }
            }
        };
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'POST', payload, guru1Cookie);
        assert.equal(res.statusCode, 400);
    });

    test('Guru pengampu menyimpan skor sah memicu hitung ulang dan status_koreksi menjadi selesai', async () => {
        const payload = {
            skor: {
                [`s_${siswaId}`]: {
                    [`q_${soalEssayId}`]: '4' // Nilai essay penuh
                }
            }
        };
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'POST', payload, guru1Cookie);
        // Setelah sukses redirect ke /guru/essay/:ujianId?msg=...
        assert.equal(res.statusCode, 302);

        // Verifikasi database nilai_essay
        const [essayRows] = await pool.query('SELECT * FROM nilai_essay WHERE siswa_id = ? AND soal_id = ?', [siswaId, soalEssayId]);
        assert.equal(essayRows.length, 1);
        assert.equal(essayRows[0].skor, 4);

        // Verifikasi recalculation nilai_ujian
        const [nuRows] = await pool.query('SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, ujianId]);
        assert.equal(nuRows.length, 1);
        const nu = nuRows[0];
        assert.equal(nu.poin_otomatis, 2);
        assert.equal(nu.poin_essay, 4);
        assert.equal(nu.poin_maks, 6);
        assert.equal(nu.status_koreksi, 'selesai');
        assert.equal(nu.nilai, 100); // round((2 + 4) / 6 * 100) = 100
    });

    test('GET /guru/essay/:ujianId/export mengunduh berkas Excel', async () => {
        const res = await makeRequest(`/guru/essay/${ujianId}/export`, 'GET', null, guru1Cookie);
        assert.equal(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('spreadsheetml'));
    });

    test('POST /guru/essay/:ujianId/import berhasil mengimpor nilai dan memicu hitung ulang', async () => {
        // Buat file Excel sederhana di memory
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Nilai');
        worksheet.columns = [
            { header: 'ID Siswa', key: 'siswa_id' },
            { header: 'NIS', key: 'nis' },
            { header: `Soal #1 [ID:${soalEssayId}] (Maks: 4)`, key: 'soal' }
        ];
        worksheet.addRow({
            siswa_id: siswaId,
            nis: 'T0001',
            soal: 3
        });
        const buffer = await workbook.xlsx.writeBuffer();

        // Buat multipart/form-data payload
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const crlf = '\r\n';
        const postData = Buffer.concat([
            Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file_excel"; filename="nilai.xlsx"${crlf}Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${crlf}${crlf}`),
            buffer,
            Buffer.from(`${crlf}--${boundary}--${crlf}`)
        ]);

        const res = await makeRequest(`/guru/essay/${ujianId}/import`, 'POST', postData, guru1Cookie, `multipart/form-data; boundary=${boundary}`);
        assert.equal(res.statusCode, 302);

        // Verifikasi database nilai_essay
        const [essayRows] = await pool.query('SELECT * FROM nilai_essay WHERE siswa_id = ? AND soal_id = ?', [siswaId, soalEssayId]);
        assert.equal(essayRows.length, 1);
        assert.equal(essayRows[0].skor, 3);

        // Verifikasi recalculation nilai_ujian: PG (2) + Essay (3) = 5 / 6 * 100 = 83
        const [nuRows] = await pool.query('SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, ujianId]);
        assert.equal(nuRows.length, 1);
        assert.equal(nuRows[0].poin_essay, 3);
        assert.equal(nuRows[0].status_koreksi, 'selesai');
        assert.equal(nuRows[0].nilai, 83);
    });

    test('T3.7 Flag TAMPILKAN_NILAI_SISWA menyembunyikan nilai saat false', async () => {
        // Buat siswa baru yang belum pernah selesai
        const hashedPin = await bcrypt.hash('1234', 10);
        const [resS3] = await pool.query(
            "INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0003', 'Siswa Test 3', 'X-A', ?)",
            [hashedPin]
        );
        const siswa3Id = resS3.insertId;

        // Login siswa 3
        const loginRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0003',
            pin: '1234',
            ujian_id: String(ujianId)
        });
        const sCookie = loginRes.cookie;
        assert.ok(sCookie, 'Harus mendapatkan cookie session');

        const prevEnv = process.env.TAMPILKAN_NILAI_SISWA;
        try {
            process.env.TAMPILKAN_NILAI_SISWA = 'false';
            const res = await makeRequest('/api/selesai-ujian', 'POST', {}, sCookie);
            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.equal(body.success, true);
            assert.equal(body.message, 'Jawaban terkirim');
            assert.equal(body.nilai, undefined);
        } finally {
            process.env.TAMPILKAN_NILAI_SISWA = prevEnv;
        }
    });

    test('T3.7 Flag TAMPILKAN_NILAI_SISWA menampilkan nilai saat true', async () => {
        // Buat siswa baru lagi
        const hashedPin = await bcrypt.hash('1234', 10);
        const [resS4] = await pool.query(
            "INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0004', 'Siswa Test 4', 'X-A', ?)",
            [hashedPin]
        );
        const siswa4Id = resS4.insertId;

        // Login siswa 4
        const loginRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0004',
            pin: '1234',
            ujian_id: String(ujianId)
        });
        const sCookie = loginRes.cookie;
        assert.ok(sCookie, 'Harus mendapatkan cookie session');

        const prevEnv = process.env.TAMPILKAN_NILAI_SISWA;
        try {
            process.env.TAMPILKAN_NILAI_SISWA = 'true';
            const res = await makeRequest('/api/selesai-ujian', 'POST', {}, sCookie);
            assert.equal(res.statusCode, 200);
            const body = JSON.parse(res.body);
            assert.notEqual(body.nilai, undefined);
            assert.equal(body.status_koreksi, 'menunggu_essay');
        } finally {
            process.env.TAMPILKAN_NILAI_SISWA = prevEnv;
        }
    });

    test('Menyimpan nilai essay TIDAK menghentikan sesi siswa yang masih sedang_ujian dan ditolak (400)', async () => {
        const [rb] = await pool.query(
            "INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0099', 'Siswa Berjalan', 'X-A', 'x')"
        );
        await pool.query(
            `INSERT INTO sesi_ujian (siswa_id, ujian_id, waktu_mulai, batas_waktu, seed, device_token, status)
             VALUES (?, ?, NOW(), NOW() + INTERVAL 60 MINUTE, 2, 'tok2', 'sedang_ujian')`,
            [rb.insertId, ujianId]
        );
        const payload = { skor: { [`s_${rb.insertId}`]: { [`q_${soalEssayId}`]: '3' } } };
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'POST', payload, guru1Cookie);
        assert.equal(res.statusCode, 400);

        const [sesi] = await pool.query('SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [rb.insertId, ujianId]);
        assert.equal(sesi[0].status, 'sedang_ujian');
        const [nu] = await pool.query('SELECT 1 FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [rb.insertId, ujianId]);
        assert.equal(nu.length, 0);
        const [ne] = await pool.query('SELECT 1 FROM nilai_essay WHERE siswa_id = ?', [rb.insertId]);
        assert.equal(ne.length, 0);
    });

    test('Siswa yang bukan peserta ujian ditolak (400) dan tidak membuat nilai_essay/nilai_ujian', async () => {
        const payload = { skor: { [`s_${seeded.siswa2Id}`]: { [`q_${soalEssayId}`]: '2' } } };
        const res = await makeRequest(`/guru/essay/${ujianId}`, 'POST', payload, guru1Cookie);
        assert.equal(res.statusCode, 400);
        const [ne] = await pool.query('SELECT 1 FROM nilai_essay WHERE siswa_id = ?', [seeded.siswa2Id]);
        assert.equal(ne.length, 0);
        const [nu] = await pool.query('SELECT 1 FROM nilai_ujian WHERE siswa_id = ?', [seeded.siswa2Id]);
        assert.equal(nu.length, 0);
    });

    test('hitungUlangNilai tidak mengubah status sesi', async () => {
        const { hitungUlangNilai } = require('../services/finalizeService');
        await pool.query("UPDATE sesi_ujian SET status = 'sedang_ujian' WHERE siswa_id = ? AND ujian_id = ?", [siswaId, ujianId]);
        await hitungUlangNilai(siswaId, ujianId, pool);
        const [sesi] = await pool.query('SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [siswaId, ujianId]);
        assert.equal(sesi[0].status, 'sedang_ujian');
    });
});
