const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('Export Daftar Siswa ke Excel', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let adminCookie;

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
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    const cookieHeader = setCookie && setCookie.length > 0 ? setCookie[0].split(';')[0] : null;
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), cookie: cookieHeader });
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
            secret: 'test-secret-export-siswa',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        app.use('/', require('../routes/index'));
        app.use('/admin', require('../routes/admin'));

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

        const loginRes = await makeRequest('/login-admin', 'POST', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });
        adminCookie = loginRes.cookie;
        assert.ok(adminCookie, 'Admin harus menerima cookie session');
    });

    test('1. Export tanpa filter menghasilkan berkas Excel berisi seluruh siswa', async () => {
        const res = await makeRequest('/admin/siswa/export', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('spreadsheetml'));
        assert.ok(res.body.length > 1000, 'Berkas harus berisi data, bukan kosong');

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.body);
        const worksheet = workbook.worksheets[0];

        const header = worksheet.getRow(1).values.slice(1);
        assert.deepStrictEqual(header, ['NIS', 'Nama', 'Kelas', 'Terdaftar Sejak']);

        // seedSyntheticData membuat 2 siswa (T0001 di kelas X-A, T0002 di kelas X-B)
        assert.strictEqual(worksheet.rowCount, 3, 'Harus ada baris header + 2 siswa');
    });

    test('2. Export dengan filter kelas hanya menyertakan siswa kelas tersebut', async () => {
        const res = await makeRequest('/admin/siswa/export?kelas=X-A', 'GET', null, adminCookie);
        assert.strictEqual(res.statusCode, 200);

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.body);
        const worksheet = workbook.worksheets[0];

        assert.strictEqual(worksheet.rowCount, 2, 'Harus ada baris header + 1 siswa kelas X-A');
        const nis = worksheet.getRow(2).getCell(1).value;
        assert.strictEqual(String(nis), 'T0001');
    });

    test('3. Akses tanpa login admin ditolak', async () => {
        const res = await makeRequest('/admin/siswa/export', 'GET', null, null);
        assert.notStrictEqual(res.statusCode, 200);
    });
});
