const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { EventEmitter } = require('events');
const {
    getTestPool,
    cleanDatabase,
    seedSyntheticData,
    closeTestPool
} = require('./helpers/db');

describe('Endpoint GET /api/sesi dan Socket Timer (T1.4)', () => {
    let pool;
    let seeded;
    let server;
    let baseUrl;
    let port;

    before(async () => {
        pool = getTestPool();

        const app = express();
        app.use(express.json());
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, sameSite: 'lax' }
        }));

        app.set('views', '/home/ilhamzp/Projects/CBT-Sekolah/views');
        app.set('view engine', 'ejs');

        const authController = require('../controllers/authController');
        const apiRouter = require('../routes/api');

        app.post('/login-siswa', authController.loginSiswa);
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
    });

    async function makeRequest(path, method, body, cookie = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, baseUrl);
            const headers = {};
            let payload = null;

            if (body) {
                payload = JSON.stringify(body);
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(payload);
            }
            if (cookie) headers['Cookie'] = cookie;

            const req = http.request(url, { method, headers }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const setCookie = res.headers['set-cookie'];
                    resolve({
                        statusCode: res.statusCode,
                        body: data,
                        cookie: setCookie ? setCookie[0].split(';')[0] : cookie
                    });
                });
            });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }

    test('GET /api/sesi mengembalikan status, sisa_detik, batas_waktu, dan jawaban_tersimpan', async () => {
        // Login siswa
        const loginRes = await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId)
        });
        const cookie = loginRes.cookie;

        // Simpan 1 jawaban sintetis
        await pool.query(
            `INSERT INTO jawaban_siswa (siswa_id, ujian_id, soal_id, jawaban_dipilih, is_benar)
             VALUES (?, ?, ?, 'B', 1)`,
            [seeded.siswa1Id, seeded.ujianId, seeded.soalId]
        );

        // Request GET /api/sesi
        const resSesi = await makeRequest('/api/sesi', 'GET', null, cookie);
        assert.strictEqual(resSesi.statusCode, 200);

        const data = JSON.parse(resSesi.body);
        assert.strictEqual(data.status, 'sedang_ujian');
        assert.ok(typeof data.sisa_detik === 'number', 'sisa_detik harus berupa angka');
        assert.ok(data.sisa_detik > 0, 'sisa_detik harus lebih besar dari 0');
        assert.ok(data.batas_waktu, 'batas_waktu harus ada');
        assert.deepStrictEqual(data.jawaban_tersimpan, { [seeded.soalId]: 'B' });
    });

    test('Handler socket siswa-siap mengirim sisa_detik dan reconnect tidak mereset hitung mundur', async () => {
        // Login siswa untuk membuat sesi
        await makeRequest('/login-siswa', 'POST', {
            nis: 'T0001',
            pin: seeded.defaultPin,
            ujian_id: String(seeded.ujianId)
        });

        const sesiService = require('../services/sesiService');
        const sessionSocketMap = new Map();

        // Implementasikan logika handler siswa-siap dan disconnect yang sama persis dengan app.js
        async function handleSiswaSiap(socket, { siswa_id, ujian_id }) {
            sessionSocketMap.set(socket.id, { siswa_id, ujian_id });

            let [sesiRows] = await pool.query(
                `SELECT s.*, u.durasi, u.tanggal_mulai, u.tanggal_selesai
                 FROM sesi_ujian s
                 JOIN ujian u ON s.ujian_id = u.id
                 WHERE s.siswa_id = ? AND s.ujian_id = ?`,
                [siswa_id, ujian_id]
            );

            let sesi;
            if (sesiRows.length === 0) {
                const hasil = await sesiService.mulaiAtauLanjut(siswa_id, ujian_id, null, pool);
                sesi = hasil.sesi;
            } else {
                sesi = sesiRows[0];
            }

            await pool.query(
                'UPDATE sesi_ujian SET socket_id = ?, last_seen = NOW() WHERE id = ?',
                [socket.id, sesi.id]
            );

            const sisa_detik = sesiService.hitungSisaDetik(sesi, new Date());
            socket.emit('mulai-ujian', {
                durasi: sesi.durasi,
                sisa_detik,
                batas_waktu: sesi.batas_waktu
            });
        }

        async function handleDisconnect(socket) {
            const data = sessionSocketMap.get(socket.id);
            if (data && data.siswa_id && data.ujian_id) {
                await pool.query(
                    'UPDATE sesi_ujian SET last_seen = NOW() WHERE siswa_id = ? AND ujian_id = ?',
                    [data.siswa_id, data.ujian_id]
                );
            }
            sessionSocketMap.delete(socket.id);
        }

        // 1. Sambungan pertama (socket 1)
        const mockSocket1 = new EventEmitter();
        mockSocket1.id = 'socket-id-1';

        const emittedData1 = await new Promise(resolve => {
            mockSocket1.on('mulai-ujian', data => resolve(data));
            handleSiswaSiap(mockSocket1, { siswa_id: seeded.siswa1Id, ujian_id: seeded.ujianId });
        });

        assert.ok(emittedData1.sisa_detik !== undefined, 'Event mulai-ujian harus memuat sisa_detik');
        const sisaDetikAwal = emittedData1.sisa_detik;

        // Disconnect socket 1
        await handleDisconnect(mockSocket1);

        // 2. Sambungan kedua (socket reconnect 2)
        const mockSocket2 = new EventEmitter();
        mockSocket2.id = 'socket-id-2';

        const emittedData2 = await new Promise(resolve => {
            mockSocket2.on('mulai-ujian', data => resolve(data));
            handleSiswaSiap(mockSocket2, { siswa_id: seeded.siswa1Id, ujian_id: seeded.ujianId });
        });

        await handleDisconnect(mockSocket2);

        // Hitung mundur pada reconnect tidak boleh mereset kembali ke durasi penuh
        assert.ok(emittedData2.sisa_detik <= sisaDetikAwal, 'sisa_detik tidak boleh bertambah saat reconnect');
        assert.ok(emittedData2.sisa_detik >= sisaDetikAwal - 5, 'sisa_detik harus konsisten');

        // Pastikan last_seen tercatat di DB tanpa mengubah status
        const [sesiRows] = await pool.query(
            'SELECT last_seen, status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        assert.strictEqual(sesiRows[0].status, 'sedang_ujian');
        assert.ok(sesiRows[0].last_seen !== null, 'last_seen harus tercatat di DB');
    });
});

