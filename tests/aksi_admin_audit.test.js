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

describe('Aksi Admin + Audit (T4.4)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let adminCookie;
    let siswaCookie;

    // Mock IO untuk menangkap emit socket ke siswa dan room admin
    let capturedBroadcasts = [];
    const mockIo = {
        to: (target) => ({
            emit: (event, payload) => {
                capturedBroadcasts.push({ target, event, payload });
            }
        })
    };

    function makeRequest(urlPath, method = 'GET', body = null, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(urlPath, baseUrl);
            const payload = body ? JSON.stringify(body) : null;
            const headers = {};
            if (payload) {
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) {
                headers['Cookie'] = cookie;
            }

            const req = http.request(url, { method, headers }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    let cookieHeader = null;
                    if (setCookie && setCookie.length > 0) {
                        cookieHeader = setCookie[0].split(';')[0];
                    }
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data,
                        cookie: cookieHeader
                    });
                });
            });

            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    async function loginUser(loginPath, credentials) {
        const res = await makeRequest(loginPath, 'POST', credentials);
        return res.cookie;
    }

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret-audit',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));

        app.set('io', mockIo);
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');

        const indexRouter = require('../routes/index');
        const adminRouter = require('../routes/admin');
        const apiRouter = require('../routes/api');

        app.use('/', indexRouter);
        app.use('/admin', adminRouter);
        app.use('/api', apiRouter);

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await cleanDatabase(pool);
        await closeTestPool();
    });

    beforeEach(async () => {
        capturedBroadcasts = [];
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);

        // Login Admin
        adminCookie = await loginUser('/login-admin', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });
        assert.ok(adminCookie, 'Admin harus menerima cookie session');

        // Login Siswa
        siswaCookie = await loginUser('/login-siswa', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: seeded.ujianId
        });
        assert.ok(siswaCookie, 'Siswa harus menerima cookie session');
    });

    test('0. tambah-waktu menolak menit di luar 1-180 di sisi server dan dua aksi berurutan terakumulasi', async () => {
        const [sesiRows] = await pool.query(
            'SELECT id, batas_waktu FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        const sesiId = sesiRows[0].id;
        const batasAwal = new Date(sesiRows[0].batas_waktu).getTime();

        for (const menit of [0, -5, 181, 99999999]) {
            const r = await makeRequest(`/admin/api/sesi/${sesiId}/tambah-waktu`, 'POST', { menit }, adminCookie);
            assert.strictEqual(r.statusCode, 400, `menit=${menit} harus ditolak`);
        }
        await Promise.all([
            makeRequest(`/admin/api/sesi/${sesiId}/tambah-waktu`, 'POST', { menit: 5 }, adminCookie),
            makeRequest(`/admin/api/sesi/${sesiId}/tambah-waktu`, 'POST', { menit: 7 }, adminCookie)
        ]);
        const [after] = await pool.query('SELECT batas_waktu, tambahan_menit FROM sesi_ujian WHERE id = ?', [sesiId]);
        assert.strictEqual(after[0].tambahan_menit, 12);
        assert.strictEqual(new Date(after[0].batas_waktu).getTime() - batasAwal, 12 * 60 * 1000);
    });

    test('1. POST /admin/api/sesi/:id/tambah-waktu memperpanjang batas_waktu, audit_admin tercatat, dan notifikasi socket terkirim', async () => {
        const ujianId = seeded.ujianId;
        const siswaId = seeded.siswa1Id;

        // Ambil ID sesi dan batas_waktu awal yang sudah terbuat saat loginSiswa
        const [sesiRows] = await pool.query(
            'SELECT id, batas_waktu, tambahan_menit FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );
        assert.strictEqual(sesiRows.length, 1);
        const sesiId = sesiRows[0].id;
        const batasAwal = new Date(sesiRows[0].batas_waktu).getTime();
        assert.strictEqual(sesiRows[0].tambahan_menit, 0);

        // Set socket_id sintetis pada sesi untuk menguji direct emit ke siswa
        await pool.query('UPDATE sesi_ujian SET socket_id = ? WHERE id = ?', ['socket-siswa-123', sesiId]);

        // Panggil endpoint tambah-waktu sebagai admin (tambah 15 menit)
        const tambahRes = await makeRequest(`/admin/api/sesi/${sesiId}/tambah-waktu`, 'POST', { menit: 15 }, adminCookie);
        assert.strictEqual(tambahRes.statusCode, 200);
        const tambahBody = JSON.parse(tambahRes.body);
        assert.strictEqual(tambahBody.success, true);
        assert.strictEqual(tambahBody.tambahan_menit, 15);

        // Verifikasi batas_waktu di DB bertambah ~15 menit (900.000 ms)
        const [updatedRows] = await pool.query(
            'SELECT batas_waktu, tambahan_menit FROM sesi_ujian WHERE id = ?',
            [sesiId]
        );
        const batasBaru = new Date(updatedRows[0].batas_waktu).getTime();
        assert.strictEqual(updatedRows[0].tambahan_menit, 15);
        assert.strictEqual(batasBaru - batasAwal, 15 * 60 * 1000);

        // Verifikasi audit_admin tercatat
        const [auditRows] = await pool.query(
            'SELECT * FROM audit_admin WHERE sesi_id = ? ORDER BY id DESC',
            [sesiId]
        );
        assert.strictEqual(auditRows.length, 1);
        assert.strictEqual(auditRows[0].aksi, 'tambah-waktu');
        assert.match(auditRows[0].detail, /Tambah waktu 15 menit/);

        // Verifikasi siaran socket (ke room admin dan direct socket_id siswa)
        const adminBroadcast = capturedBroadcasts.find(b => b.target === `admin:${ujianId}` && b.event === 'monitor:update');
        assert.ok(adminBroadcast, 'Harus ada monitor:update ke room admin');
        assert.strictEqual(adminBroadcast.payload.event, 'tambah_waktu');
        assert.strictEqual(adminBroadcast.payload.tambahan_menit, 15);

        const siswaBroadcast = capturedBroadcasts.find(b => b.target === 'socket-siswa-123' && b.event === 'tambah-waktu');
        assert.ok(siswaBroadcast, 'Harus ada notifikasi langsung ke socket siswa');
        assert.strictEqual(siswaBroadcast.payload.menit, 15);
    });

    test('2. POST /admin/api/sesi/:id/paksa-selesai memfinalisasi nilai, mengubah status sesi, audit_admin tercatat, dan paksa-submit socket', async () => {
        const ujianId = seeded.ujianId;
        const siswaId = seeded.siswa1Id;

        const [sesiRows] = await pool.query(
            'SELECT id FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );
        const sesiId = sesiRows[0].id;
        await pool.query('UPDATE sesi_ujian SET socket_id = ? WHERE id = ?', ['socket-siswa-456', sesiId]);

        // Simpan jawaban siswa untuk soal
        const soalId = seeded.soalId;
        await makeRequest('/api/sinkron-jawaban', 'POST', {
            ujian_id: ujianId,
            items: [{ soal_id: soalId, jawaban: 'B', client_ts: new Date().toISOString() }]
        }, siswaCookie);

        // Admin melakukan paksa-selesai
        const paksaRes = await makeRequest(`/admin/api/sesi/${sesiId}/paksa-selesai`, 'POST', null, adminCookie);
        assert.strictEqual(paksaRes.statusCode, 200);
        const paksaBody = JSON.parse(paksaRes.body);
        assert.strictEqual(paksaBody.success, true);
        assert.strictEqual(paksaBody.status, 'selesai');

        // Verifikasi sesi_ujian status menjadi selesai
        const [sesiSelesai] = await pool.query('SELECT status FROM sesi_ujian WHERE id = ?', [sesiId]);
        assert.strictEqual(sesiSelesai[0].status, 'selesai');

        // Verifikasi nilai_ujian terisi (finalisasi)
        const [nilaiRows] = await pool.query(
            'SELECT * FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );
        assert.strictEqual(nilaiRows.length, 1);
        assert.strictEqual(nilaiRows[0].status_koreksi, 'selesai');

        // Verifikasi audit_admin tercatat
        const [auditRows] = await pool.query(
            'SELECT * FROM audit_admin WHERE sesi_id = ? ORDER BY id DESC',
            [sesiId]
        );
        assert.strictEqual(auditRows.length, 1);
        assert.strictEqual(auditRows[0].aksi, 'paksa-selesai');

        // Verifikasi socket paksa-submit ke siswa
        const paksaSubmitBroadcast = capturedBroadcasts.find(b => b.target === 'socket-siswa-456' && b.event === 'paksa-submit');
        assert.ok(paksaSubmitBroadcast, 'Siswa harus menerima event paksa-submit');

        // Aksi tambah-waktu atau paksa-selesai ulang pada sesi selesai harus ditolak 409
        const tambahLagiRes = await makeRequest(`/admin/api/sesi/${sesiId}/tambah-waktu`, 'POST', { menit: 5 }, adminCookie);
        assert.strictEqual(tambahLagiRes.statusCode, 409);

        const paksaLagiRes = await makeRequest(`/admin/api/sesi/${sesiId}/paksa-selesai`, 'POST', null, adminCookie);
        assert.strictEqual(paksaLagiRes.statusCode, 409);
    });

    test('3. Akses non-admin ke endpoint aksi admin ditolak dengan 403', async () => {
        const ujianId = seeded.ujianId;
        const siswaId = seeded.siswa1Id;

        const [sesiRows] = await pool.query(
            'SELECT id FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [siswaId, ujianId]
        );
        const sesiId = sesiRows[0].id;

        // Coba panggil tambah-waktu menggunakan cookie siswa
        const tambahNonAdmin = await makeRequest(`/admin/api/sesi/${sesiId}/tambah-waktu`, 'POST', { menit: 10 }, siswaCookie);
        assert.strictEqual(tambahNonAdmin.statusCode, 403);

        // Coba panggil paksa-selesai menggunakan cookie siswa
        const paksaNonAdmin = await makeRequest(`/admin/api/sesi/${sesiId}/paksa-selesai`, 'POST', null, siswaCookie);
        assert.strictEqual(paksaNonAdmin.statusCode, 403);
    });
});
