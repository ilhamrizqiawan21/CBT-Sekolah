// Verifikasi UI Fase 2 di browser (Playwright, 360x640). Dijalankan manual: npm run test:ui
// Memakai DB uji; menjalankan app.js sebagai proses terpisah.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('../helpers/db');

const PORT = 3999;
const PASANGAN = [{ kiri: 'كِتَابٌ', kanan: 'Buku' }, { kiri: 'قَلَمٌ', kanan: 'Pena' }];
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, 'out');

async function waitServer() {
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(BASE + '/login'); if (r.status < 500) return; } catch (_) { /* belum siap */ }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Server tidak naik');
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const pool = getTestPool();
    await cleanDatabase(pool);
    const seeded = await seedSyntheticData(pool);
    const ins = (tipe, teks, e = {}) => pool.query(
        `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar, opsi_tambahan)
         VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?)`,
        [seeded.ujianId, tipe, teks, e.a || null, e.b || null, e.c || null, e.d || null, e.kunci || '', e.opsi || null]);
    await ins('pg', 'عَيِّنِ الفِعْلَ الْمَاضِيَ مِنَ الْجُمَلِ التَّالِيَةِ: كَتَبَ التِّلْمِيذُ الدَّرْسَ',
        { a: 'كَتَبَ', b: 'التِّلْمِيذُ', c: 'الدَّرْسَ', d: 'فِي الفَصْلِ', kunci: 'A' });
    await ins('pg', 'Apa arti kata كِتَابٌ dalam kalimat berikut ini?',
        { a: 'Buku', b: 'Pena', c: 'Meja', d: 'Kursi', kunci: 'A' });
    await ins('menjodohkan', 'Pasangkan kata dengan artinya',
        { kunci: JSON.stringify(PASANGAN), opsi: JSON.stringify({ pasangan: PASANGAN, pengecoh: ['Meja'] }) });
    await ins('essay', 'Terjemahkan: ذَهَبَ الوَلَدُ إِلَى المَدْرَسَةِ');

    const srv = spawn('node', ['app.js'], {
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env, PORT: String(PORT), DB_NAME: 'cbt_sekolah_test' },
        stdio: 'ignore'
    });
    const browser = await chromium.launch();
    const hasil = [];
    const cek = (nama, ok, info = '') => { hasil.push({ nama, ok }); console.log(ok ? 'OK   ' : 'GAGAL', nama, info); };
    try {
        await waitServer();
        const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        const res = await ctx.request.post(BASE + '/login-siswa', {
            form: { nis: 'T0001', pin: seeded.defaultPin, ujian_id: String(seeded.ujianId), device_type: 'hp' },
            maxRedirects: 0
        });
        assert.equal(res.status(), 302);
        await page.goto(BASE + '/ujian');
        const btn = page.locator('#btn-enter-fs');
        if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
        await page.evaluate(() => { const o = document.getElementById('fs-overlay'); if (o) o.style.display = 'none'; });
        await page.waitForSelector('.soal-text', { timeout: 15000 });

        const info = await page.evaluate(() => {
            const gs = el => { const c = getComputedStyle(el); return { dir: c.direction, font: c.fontFamily, size: parseFloat(c.fontSize) }; };
            const q = [...document.querySelectorAll('.soal-text')];
            const arab = q.find(e => e.classList.contains('ar') && !e.textContent.includes('Apa arti'));
            const campur = q.find(e => e.textContent.includes('Apa arti'));
            const pil = document.querySelector('.form-check-label.ar');
            const lat = document.querySelector('.form-check-label:not(.ar)');
            return { arab: gs(arab), campur: gs(campur), pilihan: pil ? gs(pil) : null, latin: lat ? gs(lat) : null };
        });
        cek('soal Arab murni: RTL + Amiri', info.arab.dir === 'rtl' && /Amiri/.test(info.arab.font), JSON.stringify(info.arab));
        cek('soal Indonesia + kutipan Arab: tetap LTR', info.campur.dir === 'ltr', JSON.stringify(info.campur));
        cek('pilihan Arab lebih besar dari pilihan Latin', !!info.pilihan && !!info.latin && info.pilihan.size > info.latin.size,
            `${info.pilihan && info.pilihan.size} vs ${info.latin && info.latin.size}`);
        cek('font Amiri benar-benar termuat', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Amiri', 'ع'); }));

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        cek('tanpa scroll horizontal', overflow <= 0, `selisih=${overflow}`);

        const kecil = await page.evaluate(() => [...document.querySelectorAll('.btn-font-size, .nav-btn, .btn-selesai, .pilihan-ganda .form-check')]
            .filter(e => e.offsetParent !== null)
            .map(e => { const r = e.getBoundingClientRect(); return { c: e.className, w: Math.round(r.width), h: Math.round(r.height) }; })
            .filter(r => r.h < 44 || r.w < 44));
        cek('target sentuh >= 44px', kecil.length === 0, JSON.stringify(kecil));

        const keluar = await page.evaluate(() => [...document.querySelectorAll('.exam-topbar *')]
            .filter(e => e.offsetParent !== null).map(e => ({ id: e.id || e.className, r: Math.round(e.getBoundingClientRect().right) }))
            .filter(x => x.r > window.innerWidth));
        cek('isi topbar (timer, kontrol) tidak terpotong', keluar.length === 0, JSON.stringify(keluar.slice(0, 3)));

        const tumpang = await page.evaluate(() => {
            window.scrollTo(0, 0);
            const bar = document.querySelector('.exam-topbar').getBoundingClientRect().bottom;
            const kartu = document.querySelector('.soal-card').getBoundingClientRect().top;
            return { bar: Math.round(bar), kartu: Math.round(kartu) };
        });
        cek('konten soal tidak tertutup topbar', tumpang.kartu >= tumpang.bar, JSON.stringify(tumpang));

        const sz = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.soal-text')).fontSize));
        const s0 = await sz();
        await page.click('#btn-font-inc');
        const s1 = await sz();
        await page.reload();
        await page.waitForSelector('.soal-text');
        await page.evaluate(() => { const o = document.getElementById('fs-overlay'); if (o) o.style.display = 'none'; });
        const s2 = await sz();
        cek('A+ memperbesar & bertahan setelah reload', s1 > s0 && Math.abs(s2 - s1) < 0.5, `${s0} -> ${s1} -> ${s2}`);
        await page.click('#btn-font-dec');
        cek('A- memperkecil', (await sz()) < s1);

        // Menjodohkan: satu <select> per pasangan, jawaban tersimpan sebagai pasangan & bertahan setelah reload
        const kunci = { 'كِتَابٌ': 'Buku', 'قَلَمٌ': 'Pena' };
        const selMen = page.locator('select.pasangan-select');
        cek('menjodohkan: satu select per pasangan', (await selMen.count()) === 2);
        cek('menjodohkan: select tinggi >= 44px', (await selMen.first().boundingBox()).height >= 44);
        for (let i = 0; i < 2; i++) {
            const kiri = await selMen.nth(i).getAttribute('data-kiri');
            await selMen.nth(i).selectOption(kunci[kiri]);
        }
        await page.waitForTimeout(2500);
        const [[men]] = await pool.query("SELECT j.jawaban_dipilih, j.is_benar FROM jawaban_siswa j JOIN soal s ON s.id = j.soal_id WHERE s.tipe_soal = 'menjodohkan'");
        cek('menjodohkan: tersinkron ke server dan dinilai benar', men && men.is_benar === 1, men && men.jawaban_dipilih);
        await page.reload();
        await page.waitForSelector('select.pasangan-select');
        await page.evaluate(() => { const o = document.getElementById('fs-overlay'); if (o) o.style.display = 'none'; });
        const pilihan = await page.$$eval('select.pasangan-select', els => els.map(e => e.value));
        cek('menjodohkan: pilihan bertahan setelah reload', pilihan.join('|') === 'Buku|Pena', pilihan.join('|'));
        cek('menjodohkan: tanpa scroll horizontal', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);

        await page.screenshot({ path: path.join(OUT, 'ujian_360.png'), fullPage: true });

        // Pratinjau di form edit soal guru
        const gctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
        const g = await gctx.request.post(BASE + '/login-guru', { form: { username: 'guru_uji', password: seeded.defaultPin }, maxRedirects: 0 });
        cek('login guru', g.status() === 302);
        const [[soal]] = await pool.query("SELECT id FROM soal WHERE tipe_soal = 'pg' LIMIT 1");
        const p2 = await gctx.newPage();
        await p2.goto(`${BASE}/guru/soal/edit/${soal.id}`);
        const ta = p2.locator('textarea[name="teks_soal"]');
        await ta.focus();
        await ta.fill('مَرْحَبًا بِكُمْ');
        cek('pratinjau tampil dengan font Arab', await p2.evaluate(() => {
            const p = document.getElementById('pratinjau-soal');
            const b = p && p.querySelector('.pj-body');
            return !!b && !p.hidden && b.classList.contains('ar') && b.textContent.includes('مَرْحَبًا');
        }));
    } finally {
        await browser.close();
        srv.kill();
        await cleanDatabase(pool);
        await closeTestPool();
    }
    const gagal = hasil.filter(h => !h.ok);
    console.log(`\n${hasil.length - gagal.length}/${hasil.length} lulus`);
    process.exit(gagal.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
