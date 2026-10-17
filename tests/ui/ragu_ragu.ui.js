// Verifikasi UI T7.3 Siswa: Ragu-ragu di browser (Playwright, 360x640 dan desktop).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('../helpers/db');

const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, 'out');

async function waitServer() {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(BASE + '/login');
            if (r.status < 500) return;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Server tidak naik di port ' + PORT);
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const pool = getTestPool();
    await cleanDatabase(pool);
    const seeded = await seedSyntheticData(pool);

    const srv = spawn('node', ['app.js'], {
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env, PORT: String(PORT), DB_NAME: 'cbt_sekolah_test' },
        stdio: 'ignore'
    });

    const browser = await chromium.launch();
    const hasil = [];
    const cek = (nama, ok, info = '') => {
        hasil.push({ nama, ok });
        console.log(ok ? 'OK   ' : 'GAGAL', nama, info);
    };

    try {
        await waitServer();

        // 1. Uji di Mobile (360x640)
        console.log('\n--- Uji Ragu-ragu di Layar Mobile (360x640) ---');
        const ctxMobile = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
        const pageMobile = await ctxMobile.newPage();

        const loginRes = await ctxMobile.request.post(BASE + '/login-siswa', {
            form: { nis: 'T0001', pin: seeded.defaultPin, ujian_id: String(seeded.ujianId), device_type: 'hp' },
            maxRedirects: 0
        });
        assert.equal(loginRes.status(), 302);

        await pageMobile.goto(BASE + '/ujian');
        const btnFs = pageMobile.locator('#btn-enter-fs');
        if (await btnFs.isVisible().catch(() => false)) await btnFs.click().catch(() => {});
        await pageMobile.evaluate(() => { const o = document.getElementById('fs-overlay'); if (o) o.style.display = 'none'; });

        await pageMobile.waitForSelector('.soal-card', { timeout: 15000 });

        // Periksa legenda 3 status
        const legendaMobile = await pageMobile.evaluate(() => {
            const dots = document.querySelectorAll('.nav-legend .nav-dot');
            const raguDot = document.querySelector('.nav-legend .nav-dot.ragu');
            const raguColor = raguDot ? getComputedStyle(raguDot).backgroundColor : '';
            return { count: dots.length, hasRagu: !!raguDot, raguColor };
        });
        cek('Legenda memuat 3 status dengan dot ragu', legendaMobile.count === 3 && legendaMobile.hasRagu, `count: ${legendaMobile.count}`);

        // Buka floating nav di mobile
        const navToggle = pageMobile.locator('#navToggleFloat');
        if (await navToggle.isVisible().catch(() => false)) {
            await navToggle.click();
        }

        // Toggle ragu-ragu pada soal pertama
        const btnRaguMobile = pageMobile.locator('.btn-ragu-toggle').first();
        await btnRaguMobile.click();

        let stateRagu = await pageMobile.evaluate(() => {
            const btn = document.querySelector('.btn-ragu-toggle');
            const navBtn = document.querySelector('.nav-btn');
            const navColor = navBtn ? getComputedStyle(navBtn).backgroundColor : '';
            return {
                isBtnRagu: btn?.classList.contains('is-ragu'),
                isNavRagu: navBtn?.classList.contains('ragu'),
                navColor
            };
        });
        cek('Klik tandai: tombol is-ragu dan sel navigator menjadi warna warning', stateRagu.isBtnRagu && stateRagu.isNavRagu, stateRagu.navColor);

        // Klik lagi toggle ragu-ragu: tanda hilang
        await btnRaguMobile.click();
        stateRagu = await pageMobile.evaluate(() => {
            const btn = document.querySelector('.btn-ragu-toggle');
            const navBtn = document.querySelector('.nav-btn');
            return {
                isBtnRagu: btn?.classList.contains('is-ragu'),
                isNavRagu: navBtn?.classList.contains('ragu')
            };
        });
        cek('Klik lagi: tanda ragu-ragu hilang', !stateRagu.isBtnRagu && !stateRagu.isNavRagu);

        await ctxMobile.close();

        // 2. Uji di Desktop (1280x720) dengan persistensi reload, menjawab soal, dan submit
        console.log('\n--- Uji Ragu-ragu di Desktop (1280x720) ---');
        const ctxDesk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        const pageDesk = await ctxDesk.newPage();

        await ctxDesk.request.post(BASE + '/login-siswa', {
            form: { nis: 'T0001', pin: seeded.defaultPin, ujian_id: String(seeded.ujianId), device_type: 'laptop' },
            maxRedirects: 0
        });

        await pageDesk.goto(BASE + '/ujian');
        const btnFsDesk = pageDesk.locator('#btn-enter-fs');
        if (await btnFsDesk.isVisible().catch(() => false)) await btnFsDesk.click().catch(() => {});
        await pageDesk.evaluate(() => { const o = document.getElementById('fs-overlay'); if (o) o.style.display = 'none'; });
        await pageDesk.waitForSelector('.soal-card', { timeout: 15000 });

        // Klik ragu-ragu pada soal 1
        const btnRaguDesk = pageDesk.locator('.btn-ragu-toggle').first();
        await btnRaguDesk.click();

        // Reload halaman: tanda harus tetap ada dari localStorage
        await pageDesk.reload();
        if (await btnFsDesk.isVisible().catch(() => false)) await btnFsDesk.click().catch(() => {});
        await pageDesk.evaluate(() => { const o = document.getElementById('fs-overlay'); if (o) o.style.display = 'none'; });
        await pageDesk.waitForSelector('.soal-card', { timeout: 15000 });

        const reloadState = await pageDesk.evaluate(() => {
            const btn = document.querySelector('.btn-ragu-toggle');
            const navBtn = document.querySelector('.nav-btn');
            return {
                isBtnRagu: btn?.classList.contains('is-ragu'),
                isNavRagu: navBtn?.classList.contains('ragu')
            };
        });
        cek('Setelah reload: tanda ragu-ragu tetap bertahan dari localStorage', reloadState.isBtnRagu && reloadState.isNavRagu);

        // Jawab soal 1 (pilih radio pilihan A)
        const radioA = pageDesk.locator('.form-check-input').first();
        await radioA.click();
        await pageDesk.waitForTimeout(600); // Tunggu proses sync/localStorage

        const answeredAndRagu = await pageDesk.evaluate(() => {
            const navBtn = document.querySelector('.nav-btn');
            return {
                hasAnsweredClass: navBtn?.classList.contains('answered'),
                hasRaguClass: navBtn?.classList.contains('ragu')
            };
        });
        cek('Soal dijawab & ditandai ragu: memiliki kelas answered DAN ragu', answeredAndRagu.hasAnsweredClass && answeredAndRagu.hasRaguClass);

        // Tunggu hingga sinkronisasi tersimpan di database
        let jawabanDb = [];
        for (let i = 0; i < 20; i++) {
            const [rows] = await pool.query(
                'SELECT * FROM jawaban_siswa WHERE siswa_id = ? AND ujian_id = ?',
                [seeded.siswa1Id, seeded.ujianId]
            );
            if (rows.length > 0) {
                jawabanDb = rows;
                break;
            }
            await pageDesk.waitForTimeout(200);
        }
        cek('Jawaban tetap tersimpan di database server', jawabanDb.length > 0 && String(jawabanDb[0].jawaban_dipilih).toLowerCase() === 'a', `db: ${JSON.stringify(jawabanDb)}`);

        // Submit ujian
        pageDesk.on('dialog', async dialog => {
            await dialog.accept();
        });
        const btnSelesai = pageDesk.locator('#btn-selesai');
        await btnSelesai.click();
        await pageDesk.waitForTimeout(1000);

        const [sesiDb] = await pool.query(
            'SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?',
            [seeded.siswa1Id, seeded.ujianId]
        );
        cek('Submit ujian tetap berhasil dan status sesi selesai di DB', sesiDb[0]?.status === 'selesai');

        await ctxDesk.close();

    } catch (err) {
        console.error('ERROR test runner:', err);
        hasil.push({ nama: 'fatal', ok: false });
    } finally {
        await browser.close();
        srv.kill();
        await cleanDatabase(pool);
        await closeTestPool();
    }

    const gagal = hasil.filter(h => !h.ok);
    console.log(`\nHasil: ${hasil.length - gagal.length}/${hasil.length} tes lulus.`);
    if (gagal.length > 0) process.exit(1);
})();
