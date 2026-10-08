const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const {
    TEST_DB_NAME,
    getTestPool,
    cleanDatabase,
    closeTestPool
} = require('./helpers/db');
const { runLoadTest, cleanupLoadTestData } = require('../scripts/loadtest');

describe('T6.3 Uji Beban & Simulasi Klien (scripts/loadtest.js)', () => {
    let pool;
    let srvProcess;
    let serverUrl;
    const TEST_PORT = 3199;

    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);

        serverUrl = `http://127.0.0.1:${TEST_PORT}`;

        srvProcess = spawn('node', ['app.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                PORT: String(TEST_PORT),
                DB_NAME: TEST_DB_NAME
            },
            stdio: 'ignore'
        });

        // Tunggu server siap
        let ready = false;
        for (let i = 0; i < 30; i++) {
            try {
                const res = await fetch(`${serverUrl}/login`);
                if (res.status < 500) {
                    ready = true;
                    break;
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, 300));
        }

        if (!ready) {
            throw new Error('Server test app.js gagal dinyalakan dalam 9 detik');
        }
    });

    after(async () => {
        try {
            await cleanupLoadTestData(pool);
        } catch (_) {}
        if (srvProcess) {
            srvProcess.kill();
        }
        await cleanDatabase(pool);
        await closeTestPool();
    });

    test('Simulasi beban berjalan lancar, memenuhi ambang batas p95, error rate, dan integritas data', async () => {
        const clientCount = 20; // 20 klien sintetis untuk validasi integrasi cepat
        const report = await runLoadTest({
            url: serverUrl,
            clients: clientCount,
            rampUpMs: 500, // 0.5 detik ramp-up untuk test cepat
            durationMs: 5000,
            disconnectRatio: 0.2, // 20% klien putus-sambung
            pool
        });

        assert.strictEqual(report.totalStudents, clientCount, 'Jumlah peserta harus sesuai konfigurasi');
        assert.ok(report.totalRequests > clientCount * 5, 'Harus mengeksekusi multiple requests per siswa');
        assert.strictEqual(report.totalFailed, 0, 'Tidak boleh ada request yang gagal pada beban normal');
        assert.strictEqual(Number(report.errorRatePercent), 0, 'Error rate harus 0%');

        // Ambang terima T6.3
        assert.ok(report.syncP95Ms < 500, `p95 sinkron-jawaban (${report.syncP95Ms}ms) harus < 500ms`);
        assert.ok(report.passThresholds.syncP95Under500ms, 'Ambang p95 < 500ms harus PASS');
        assert.ok(report.passThresholds.errorRateUnder1Pct, 'Ambang error rate < 1% harus PASS');
        assert.strictEqual(report.answersLost, 0, 'Tanpa jawaban hilang (0 lost)');
        assert.ok(report.passThresholds.zeroAnswersLost, 'Integritas data harus PASS');
        assert.ok(report.answersInDatabase > 0, 'Database harus memuat jawaban yang berhasil disinkron');
    });
});

