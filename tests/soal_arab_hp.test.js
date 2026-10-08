const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');

describe('Fase 2: Soal Arab, Font Lokal, dan Tampilan HP (T2.1 - T2.4)', () => {
    let pool;
    let seeded;

    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
    });

    after(async () => {
        await cleanDatabase(pool);
        await closeTestPool();
    });

    test('T2.1: File font lokal woff2 dan lisensi OFL tersedia di public/fonts/ (< 500 KB total)', () => {
        const fontsDir = path.join(__dirname, '..', 'public', 'fonts');
        assert.ok(fs.existsSync(fontsDir), 'Direktori public/fonts harus ada');

        const regularFont = path.join(fontsDir, 'amiri-v30-arabic-regular.woff2');
        const boldFont = path.join(fontsDir, 'amiri-v30-arabic-700.woff2');
        const licenseFile = path.join(fontsDir, 'OFL.txt');

        assert.ok(fs.existsSync(regularFont), 'Font Amiri Regular woff2 harus ada');
        assert.ok(fs.existsSync(boldFont), 'Font Amiri Bold woff2 harus ada');
        assert.ok(fs.existsSync(licenseFile), 'Lisensi OFL.txt harus ada');

        const regularSize = fs.statSync(regularFont).size;
        const boldSize = fs.statSync(boldFont).size;
        const totalSizeKb = (regularSize + boldSize) / 1024;

        assert.ok(totalSizeKb < 500, `Ukuran total font (${totalSizeKb.toFixed(1)} KB) harus < 500 KB`);
    });

    test('T2.1 & T2.2: style.css mendefinisikan @font-face Amiri, .ar', () => {
        const cssPath = path.join(__dirname, '..', 'public', 'css', 'style.css');
        const cssContent = fs.readFileSync(cssPath, 'utf8');

        assert.ok(cssContent.includes("@font-face"), 'style.css harus mendefinisikan @font-face');
        assert.ok(cssContent.includes("font-family: 'Amiri'"), 'style.css harus memiliki font-family Amiri');
        assert.ok(cssContent.includes('/fonts/amiri-v30-arabic-regular.woff2'), 'style.css harus merujuk font lokal regular');
        assert.ok(cssContent.includes('/fonts/amiri-v30-arabic-700.woff2'), 'style.css harus merujuk font lokal bold');
        assert.ok(cssContent.includes('.ar'), 'style.css harus memiliki styling kelas .ar');
        assert.ok(!/\.ar\s*\{[^}]*direction:\s*rtl/.test(cssContent), 'arah teks tidak boleh dipaksa CSS pada .ar; serahkan ke dir="auto"');
    });

    test('T2.2 & T2.3: views/ujian.ejs dan ujian.js memiliki kontrol ukuran font, dir=auto, dan touch target >= 44px', () => {
        const ejsPath = path.join(__dirname, '..', 'views', 'ujian.ejs');
        const ejsContent = fs.readFileSync(ejsPath, 'utf8');

        assert.ok(ejsContent.includes('btn-font-dec'), 'ujian.ejs harus memiliki tombol A-');
        assert.ok(ejsContent.includes('btn-font-inc'), 'ujian.ejs harus memiliki tombol A+');
        assert.ok(ejsContent.includes('font-size-val'), 'ujian.ejs harus memiliki label indikator ukuran font');
        assert.ok(ejsContent.includes('/css/style.css'), 'ujian.ejs harus menyertakan stylesheet lokal style.css');
        assert.ok(ejsContent.includes('min-height: 44px') || ejsContent.includes('min-height: 46px'), 'Touch target tombol harus >= 44px');

        const jsPath = path.join(__dirname, '..', 'public', 'js', 'ujian.js');
        const jsContent = fs.readFileSync(jsPath, 'utf8');

        assert.ok(jsContent.includes('initFontSizeControl'), 'ujian.js harus memiliki initFontSizeControl');
        assert.ok(jsContent.includes('cbt_exam_font_scale'), 'ujian.js harus menyimpan skala font di localStorage');
        assert.ok(jsContent.includes('isArabic'), 'ujian.js harus memiliki fungsi pendeteksi teks Arab');
        assert.ok(jsContent.includes('dir="auto"'), 'renderSoal harus menyertakan dir="auto"');
    });

    test('T2.4: Database menyimpan dan membaca kembali soal bahasa Arab berharakat dengan utuh (utf8mb4)', async () => {
        const arabicQuestion = 'عَيِّنِ الفِعْلَ الْمَاضِيَ مِنَ الْجُمَلِ التَّالِيَةِ: كَتَبَ التِّلْمِيذُ الدَّرْسَ';
        const optA = 'كَتَبَ';
        const optB = 'التِّلْمِيذُ';
        const optC = 'الدَّرْسَ';
        const optD = 'فِي الفَصْلِ';

        const [insertRes] = await pool.query(
            `INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, pilihan_a, pilihan_b, pilihan_c, pilihan_d, jawaban_benar)
             VALUES (?, 'pg', ?, 2, ?, ?, ?, ?, 'A')`,
            [seeded.ujianId, arabicQuestion, optA, optB, optC, optD]
        );

        const [rows] = await pool.query('SELECT * FROM soal WHERE id = ?', [insertRes.insertId]);
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].teks_soal, arabicQuestion, 'Teks soal Arab dan harakat harus tersimpan utuh');
        assert.strictEqual(rows[0].pilihan_a, optA, 'Pilihan A Arab dan harakat harus tersimpan utuh');
        assert.strictEqual(rows[0].pilihan_b, optB, 'Pilihan B Arab dan harakat harus tersimpan utuh');
        assert.strictEqual(rows[0].pilihan_c, optC, 'Pilihan C Arab dan harakat harus tersimpan utuh');
        assert.strictEqual(rows[0].pilihan_d, optD, 'Pilihan D Arab dan harakat harus tersimpan utuh');
    });
});

