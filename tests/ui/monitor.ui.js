// Verifikasi UI halaman monitor admin di browser (Playwright). Dijalankan manual: npm run test:ui:monitor
// Memakai DB uji; menjalankan app.js sebagai proses terpisah.
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');
const sesiService = require('../../services/sesiService');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('../helpers/db');

const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitServer() {
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(BASE + '/login'); if (r.status < 500) return; } catch (_) { /* belum siap */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Server tidak naik');
}

(async () => {
    const pool = getTestPool();
    await cleanDatabase(pool);
    const seeded = await seedSyntheticData(pool);
    await pool.query("UPDATE siswa SET nama = ? WHERE id = ?", ["Ma'ruf", seeded.siswa1Id]);
    await sesiService.mulaiAtauLanjut(seeded.siswa1Id, seeded.ujianId, 'hp', pool);
    await pool.query('UPDATE sesi_ujian SET last_seen = NOW() WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);

    const srv = spawn('node', ['app.js'], {
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env, PORT: String(PORT), DB_NAME: 'cbt_sekolah_test' },
        stdio: 'ignore'
    });
    const browser = await chromium.launch();
    const hasil = [];
    const cek = (nama, ok, info = '') => { hasil.push(ok); console.log(ok ? 'OK   ' : 'GAGAL', nama, info); };
    try {
        await waitServer();
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const dialogs = [];
        page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

        await page.goto(BASE + '/login-admin');
        await page.fill('input[name="username"]', 'admin_uji');
        await page.fill('input[name="password"]', seeded.defaultPin);
        await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
        await page.goto(`${BASE}/admin/monitor/${seeded.ujianId}`);

        const row = page.locator(`#row-siswa-${seeded.siswa1Id}`);
        await page.waitForFunction(() => document.getElementById('socket-status').textContent.includes('Terhubung'), null, { timeout: 10000 })
            .then(() => cek('socket tersambung & join room', true), () => cek('socket tersambung & join room', false));
        cek('tanpa error skrip halaman', errors.length === 0, errors.join(' | '));
        cek('status awal Online', (await row.locator('.col-status').textContent()).includes('Online'));

        // Tombol aksi pada nama beraposaf harus memunculkan dialog dengan nama asli
        await row.locator('.btn-paksa-selesai').click();
        cek('konfirmasi paksa-selesai memakai nama asli', dialogs.some(d => d.includes("Ma'ruf")), dialogs.join(' | '));

        // Siswa "putus": last_seen dibuat basi di DB, tanpa reload halaman
        await pool.query('UPDATE sesi_ujian SET last_seen = NOW() - INTERVAL 120 SECOND WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        await page.waitForFunction(id => document.querySelector(`#row-siswa-${id} .col-status`).textContent.includes('Offline'),
            seeded.siswa1Id, { timeout: 15000 })
            .then(() => cek('status berubah Offline tanpa reload', true), () => cek('status berubah Offline tanpa reload', false));
        cek('ringkasan Offline ikut terhitung', (await page.locator('#count-offline').textContent()).trim() === '1');
        cek('filter status bekerja', await (async () => {
            await page.selectOption('#filter-status', 'online');
            const v = await row.isVisible();
            await page.selectOption('#filter-status', '');
            return !v;
        })());
    } finally {
        await browser.close();
        srv.kill();
        await cleanDatabase(pool);
        await closeTestPool();
    }
    const gagal = hasil.filter(x => !x).length;
    console.log(`\n${hasil.length - gagal}/${hasil.length} lulus`);
    process.exit(gagal ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
