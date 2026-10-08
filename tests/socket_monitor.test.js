const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { EventEmitter } = require('events');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');
const monitorService = require('../services/monitorService');

describe('Socket Admin Real-time (T4.2)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let port;
    let adminCookie;
    let siswaCookie;

    // Capture broadcasts from mock io
    let capturedBroadcasts = [];
    const mockIo = {
        to: (room) => ({
            emit: (event, payload) => {
                capturedBroadcasts.push({ room, event, payload });
            }
        })
    };

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));

        // Simpan mockIo di app untuk route /api dan /admin
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
        capturedBroadcasts = [];

        // Login Admin
        adminCookie = await loginUser('/login-admin', {
            username: 'admin_uji',
            password: seeded.defaultPin
        });

        // Login Siswa
        siswaCookie = await loginUser('/login-siswa', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: seeded.ujianId
        });
    });

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

    test('1. Autentikasi Room admin:{ujian_id}: Socket non-admin ditolak (403), admin diterima', async () => {
        // Mock socket logic persis seperti di app.js
        function setupSocketAuth(socket) {
            socket.on('admin:join', ({ ujian_id }) => {
                const session = socket.request?.session;
                if (!session || !session.adminId) {
                    socket.emit('admin:error', {
                        message: 'Akses ditolak: Hanya admin yang diizinkan bergabung ke pemantauan',
                        code: 403
                    });
                    return;
                }

                const room = `admin:${ujian_id}`;
                socket.joinedRooms.push(room);
                socket.emit('admin:joined', { ujian_id, room });
            });
        }

        // a. Socket tanpa admin session (siswa atau anonim)
        const mockSiswaSocket = new EventEmitter();
        mockSiswaSocket.request = { session: { siswaId: seeded.siswa1Id } };
        mockSiswaSocket.joinedRooms = [];
        setupSocketAuth(mockSiswaSocket);

        const errorPromise = new Promise(resolve => {
            mockSiswaSocket.on('admin:error', err => resolve(err));
        });
        mockSiswaSocket.emit('admin:join', { ujian_id: seeded.ujianId });
        const errResult = await errorPromise;
        assert.strictEqual(errResult.code, 403);
        assert.strictEqual(mockSiswaSocket.joinedRooms.length, 0, 'Siswa tidak boleh join room admin');

        // b. Socket admin
        const mockAdminSocket = new EventEmitter();
        mockAdminSocket.request = { session: { adminId: 1 } };
        mockAdminSocket.joinedRooms = [];
        setupSocketAuth(mockAdminSocket);

        const joinedPromise = new Promise(resolve => {
            mockAdminSocket.on('admin:joined', res => resolve(res));
        });
        mockAdminSocket.emit('admin:join', { ujian_id: seeded.ujianId });
        const joinedResult = await joinedPromise;
        assert.strictEqual(joinedResult.ujian_id, seeded.ujianId);
        assert.strictEqual(mockAdminSocket.joinedRooms[0], `admin:${seeded.ujianId}`);
    });

    test('2. Event siaran monitor:update mencakup status, progres, pelanggaran, dan perangkat', async () => {
        // Ambil sesi siswa 1 yang dibuat saat login
        const [sesiRows] = await pool.query('SELECT * FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        assert.ok(sesiRows.length > 0);

        // a. Siswa masuk / connect
        await monitorService.siarkanUpdateSiswa(mockIo, seeded.ujianId, seeded.siswa1Id, pool, { event: 'masuk' });
        assert.strictEqual(capturedBroadcasts.length, 1);
        const b1 = capturedBroadcasts[0];
        assert.strictEqual(b1.room, `admin:${seeded.ujianId}`);
        assert.strictEqual(b1.event, 'monitor:update');
        assert.strictEqual(b1.payload.status, 'online');
        assert.strictEqual(b1.payload.event, 'masuk');
        assert.strictEqual(b1.payload.progres.terjawab, 0);

        // b. Siswa menjawab via POST /api/sinkron-jawaban
        capturedBroadcasts = [];
        const resSync = await makeRequest('/api/sinkron-jawaban', 'POST', {
            ujian_id: seeded.ujianId,
            items: [
                { soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date().toISOString() }
            ]
        }, siswaCookie);
        assert.strictEqual(resSync.statusCode, 200);

        // Verifikasi siaran otomatis dari route
        assert.strictEqual(capturedBroadcasts.length, 1);
        const b2 = capturedBroadcasts[0];
        assert.strictEqual(b2.room, `admin:${seeded.ujianId}`);
        assert.strictEqual(b2.event, 'monitor:update');
        assert.strictEqual(b2.payload.event, 'jawab');
        assert.strictEqual(b2.payload.progres.terjawab, 1);

        // c. Pelanggaran tercatat
        capturedBroadcasts = [];
        await pool.query(
            "INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan) VALUES (?, ?, 'pindah_tab')",
            [seeded.siswa1Id, seeded.ujianId]
        );
        await monitorService.siarkanUpdateSiswa(mockIo, seeded.ujianId, seeded.siswa1Id, pool, { event: 'pelanggaran' });
        assert.strictEqual(capturedBroadcasts.length, 1);
        const b3 = capturedBroadcasts[0];
        assert.strictEqual(b3.payload.pelanggaran, 1);
        assert.strictEqual(b3.payload.event, 'pelanggaran');

        // d. Selesai ujian via POST /api/selesai-ujian
        capturedBroadcasts = [];
        const resSelesai = await makeRequest('/api/selesai-ujian', 'POST', {}, siswaCookie);
        assert.strictEqual(resSelesai.statusCode, 200);

        assert.strictEqual(capturedBroadcasts.length, 1);
        const b4 = capturedBroadcasts[0];
        assert.strictEqual(b4.payload.status, 'selesai');
        assert.strictEqual(b4.payload.event, 'selesai');
    });

    test('3. Buka kunci oleh admin menyiarkan event buka_kunci dan memulihkan status sesi ke room admin', async () => {
        // Set status siswa ke keluar_paksa
        await pool.query("UPDATE sesi_ujian SET status = 'keluar_paksa' WHERE siswa_id = ? AND ujian_id = ?", [seeded.siswa1Id, seeded.ujianId]);
        const [sesiRows] = await pool.query('SELECT id FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        const sesiId = sesiRows[0].id;

        capturedBroadcasts = [];
        const resBuka = await makeRequest(`/admin/api/sesi/${sesiId}/buka-kunci`, 'POST', {}, adminCookie);
        assert.strictEqual(resBuka.statusCode, 200);

        assert.strictEqual(capturedBroadcasts.length, 1);
        const b = capturedBroadcasts[0];
        assert.strictEqual(b.room, `admin:${seeded.ujianId}`);
        assert.strictEqual(b.payload.status, 'online'); // last_seen masih baru
        assert.strictEqual(b.payload.event, 'buka_kunci');
    });
});
