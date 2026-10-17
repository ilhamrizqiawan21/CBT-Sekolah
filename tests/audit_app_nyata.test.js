// Uji integrasi terhadap app.js ASLI (HTTP + Socket.IO), bukan salinan logikanya.
// Mencakup perbaikan hasil audit kesiapan produksi.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');
const { io: ioClient } = require('socket.io-client');
const { TEST_DB_NAME, getTestPool, cleanDatabase, seedSyntheticData, closeTestPool } = require('./helpers/db');
const { validateEnv } = require('../utils/env');

const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}`;

// Klien HTTP sederhana dengan cookie jar
function klien() {
    let cookie = '';
    async function req(urlPath, { method = 'GET', form = null, json = null } = {}) {
        const headers = { Accept: 'text/html,application/json' };
        if (cookie) headers.Cookie = cookie;
        let body;
        if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
        if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
        const res = await fetch(BASE + urlPath, { method, headers, body, redirect: 'manual' });
        const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
        return { status: res.status, headers: res.headers, text: await res.text(), location: res.headers.get('location') };
    }
    return { req, get cookie() { return cookie; } };
}

function sambungSocket(cookie) {
    return new Promise((resolve, reject) => {
        const s = ioClient(BASE, { extraHeaders: { cookie }, transports: ['polling'], reconnection: false, forceNew: true });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
    });
}
const tunggu = (ms) => new Promise(r => setTimeout(r, ms));
function tungguEvent(socket, nama, ms = 3000) {
    return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        socket.once(nama, (d) => { clearTimeout(t); resolve(d); });
    });
}

describe('validateEnv', () => {
    test('production menolak SESSION_SECRET pendek/placeholder dan DB tanpa password', () => {
        const dasar = { DB_NAME: 'x', DB_USER: 'u', DB_PASSWORD: 'p', NODE_ENV: 'production' };
        assert.throws(() => validateEnv({ ...dasar, SESSION_SECRET: 'pendek' }), /minimal 32/);
        assert.throws(() => validateEnv({ ...dasar, SESSION_SECRET: 'ganti-dengan-secret-yang-kuat' }), /minimal 32|contoh/);
        assert.throws(() => validateEnv({ ...dasar, SESSION_SECRET: '' }), /SESSION_SECRET/);
        assert.throws(() => validateEnv({ ...dasar, DB_PASSWORD: '', SESSION_SECRET: 'x'.repeat(40) }), /DB_PASSWORD/);
        assert.ok(validateEnv({ ...dasar, SESSION_SECRET: 'x'.repeat(40) }));
    });
});

describe('Audit kesiapan produksi — app.js asli', () => {
    let pool, srv, seeded;

    before(async () => {
        pool = getTestPool();
        await cleanDatabase(pool);
        seeded = await seedSyntheticData(pool);
        srv = spawn('node', ['app.js'], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, PORT: String(PORT), DB_NAME: TEST_DB_NAME, NODE_ENV: 'development' },
            stdio: 'ignore'
        });
        for (let i = 0; i < 40; i++) {
            try { const r = await fetch(`${BASE}/login`); if (r.status < 500) return; } catch (_) {}
            await tunggu(250);
        }
        throw new Error('app.js tidak menyala');
    });

    after(async () => {
        if (srv) srv.kill();
        await cleanDatabase(pool);
        await closeTestPool();
    });

    async function loginSiswa(nis = 'T0001') {
        const c = klien();
        await c.req('/login');
        const r = await c.req('/login-siswa', { method: 'POST', form: { nis, pin: '1234', ujian_id: seeded.ujianId, device_type: 'laptop' } });
        assert.equal(r.location, '/ujian', `login siswa gagal: ${r.text.slice(0, 200)}`);
        return c;
    }

    test('header keamanan dasar terpasang dan x-powered-by dimatikan', async () => {
        const r = await klien().req('/login');
        assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
        assert.equal(r.headers.get('x-powered-by'), null);
    });

    test('halaman tidak memuat aset dari CDN eksternal (ujian harus jalan tanpa internet)', async () => {
        for (const p of ['/login', '/login-admin', '/login-guru', '/']) {
            const r = await klien().req(p);
            assert.doesNotMatch(r.text, /cdn\.jsdelivr|fonts\.googleapis|fonts\.gstatic/, `${p} masih memuat aset eksternal`);
        }
        const css = await fetch(`${BASE}/vendor/bootstrap/css/bootstrap.min.css`);
        assert.equal(css.status, 200);
        const icons = await fetch(`${BASE}/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2`);
        assert.equal(icons.status, 200);
    });

    test('login admin/guru: pesan sama untuk username salah & password salah; objek ditolak', async () => {
        const a = await klien().req('/login-admin', { method: 'POST', form: { username: 'tidak_ada', password: 'x' } });
        const b = await klien().req('/login-admin', { method: 'POST', form: { username: 'admin_uji', password: 'salah' } });
        const msg = (t) => (t.match(/alert[^>]*>([^<]*(?:<[^>]+>[^<]*)*)/) || [])[0];
        assert.match(a.text, /Username atau password salah/);
        assert.match(b.text, /Username atau password salah/);
        assert.equal(msg(a.text), msg(b.text));
        const obj = await klien().req('/login-guru', { method: 'POST', form: { 'username[a]': 'x', password: 'y' } });
        assert.match(obj.text, /Username atau password salah/);
        const siswaObj = await klien().req('/login-siswa', { method: 'POST', form: { 'nis[a]': 'x', pin: '1', ujian_id: '1' } });
        assert.doesNotMatch(siswaObj.text, /Terjadi kesalahan server/);
    });

    test('login mengganti ID sesi (anti session fixation)', async () => {
        const c = klien();
        await c.req('/login-admin');
        // GET tidak menyetel cookie (saveUninitialized:false); paksa sesi anonim dengan percobaan gagal
        await c.req('/login-admin', { method: 'POST', form: { username: 'admin_uji', password: 'salah' } });
        const sebelum = c.cookie;
        const r = await c.req('/login-admin', { method: 'POST', form: { username: 'admin_uji', password: '1234' } });
        assert.equal(r.location, '/admin/dashboard');
        if (sebelum) assert.notEqual(c.cookie, sebelum, 'ID sesi harus berganti setelah login');
        assert.match(c.cookie, /connect\.sid=/);
    });

    test('IDOR: guru tidak bisa membaca soal+kunci ujian guru lain', async () => {
        const hash = await bcrypt.hash('1234', 10);
        const [g2] = await pool.query("INSERT INTO guru (nip, nama, username, password) VALUES ('2', 'Guru Lain', 'guru_lain', ?)", [hash]);
        const pemilik = klien(); const lain = klien();
        assert.equal((await pemilik.req('/login-guru', { method: 'POST', form: { username: 'guru_uji', password: '1234' } })).location, '/guru/dashboard');
        assert.equal((await lain.req('/login-guru', { method: 'POST', form: { username: 'guru_lain', password: '1234' } })).location, '/guru/dashboard');
        const ok = await pemilik.req(`/guru/api/soal/${seeded.ujianId}`);
        assert.equal(ok.status, 200);
        assert.match(ok.text, /jawaban_benar/);
        const tolak = await lain.req(`/guru/api/soal/${seeded.ujianId}`);
        assert.equal(tolak.status, 403);
        assert.doesNotMatch(tolak.text, /jawaban_benar/);
        assert.equal((await lain.req('/guru/api/soal/999999')).status, 404);
        await pool.query('DELETE FROM guru WHERE id = ?', [g2.insertId]);
    });

    test('selesai-ujian lewat socket menghitung nilai (bukan sekadar menandai selesai)', async () => {
        const c = await loginSiswa('T0001');
        const sock = await sambungSocket(c.cookie);
        sock.emit('siswa-siap');
        const mulai = await tungguEvent(sock, 'mulai-ujian');
        assert.ok(mulai, 'harus menerima mulai-ujian');
        const r = await c.req('/api/sinkron-jawaban', { method: 'POST', json: [{ soal_id: seeded.soalId, jawaban: 'B', client_ts: new Date().toISOString() }] });
        assert.equal(JSON.parse(r.text).tersinkron, 1, r.text);
        sock.emit('selesai-ujian');
        await tunggu(800);
        const [[sesi]] = await pool.query('SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        const [[nilai]] = await pool.query('SELECT nilai, benar FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        assert.equal(sesi.status, 'selesai');
        assert.ok(nilai, 'nilai_ujian harus terbentuk');
        assert.equal(nilai.nilai, 100);
        sock.close();
    });

    test('job penutupan memulihkan sesi "selesai" yang tidak punya nilai', async () => {
        const { tutupSesiKadaluarsa } = require('../services/finalizeService');
        await pool.query('DELETE FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        await tutupSesiKadaluarsa(pool);
        const [[nilai]] = await pool.query('SELECT nilai FROM nilai_ujian WHERE siswa_id = ? AND ujian_id = ?', [seeded.siswa1Id, seeded.ujianId]);
        assert.ok(nilai, 'nilai harus dibuat ulang');
        assert.equal(nilai.nilai, 100);
    });

    test('perangkat lama yang sesinya diambil alih tidak bisa mencatat pelanggaran', async () => {
        // siswa2 (kelas X-B) tidak boleh ikut ujian X-A; pakai siswa baru di X-A
        const hash = await bcrypt.hash('1234', 10);
        const [sw] = await pool.query("INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0003', 'Siswa Tiga', 'X-A', ?)", [hash]);
        const lama = await loginSiswa('T0003');
        const baru = await loginSiswa('T0003'); // mengambil alih
        const sockLama = await sambungSocket(lama.cookie);
        sockLama.emit('siswa-siap');
        const err = await tungguEvent(sockLama, 'error');
        assert.ok(err && err.code === 409, 'perangkat lama harus ditolak (409)');
        sockLama.emit('pindah-tab'); sockLama.emit('copy-paste');
        await tunggu(500);
        const [[cnt]] = await pool.query("SELECT COUNT(*) AS n FROM log_kecurangan WHERE siswa_id = ? AND jenis_kecurangan IN ('pindah_tab','copy_paste')", [sw.insertId]);
        assert.equal(cnt.n, 0);
        // perangkat baru tetap normal
        const sockBaru = await sambungSocket(baru.cookie);
        sockBaru.emit('siswa-siap');
        assert.ok(await tungguEvent(sockBaru, 'mulai-ujian'));
        sockBaru.emit('pindah-tab');
        await tunggu(500);
        const [[cnt2]] = await pool.query("SELECT COUNT(*) AS n FROM log_kecurangan WHERE siswa_id = ? AND jenis_kecurangan = 'pindah_tab'", [sw.insertId]);
        assert.equal(cnt2.n, 1);
        sockLama.close(); sockBaru.close();
    });

    test('simpan-jawaban lama menghormati batas waktu pribadi siswa', async () => {
        const hash = await bcrypt.hash('1234', 10);
        const [sw] = await pool.query("INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0004', 'Siswa Empat', 'X-A', ?)", [hash]);
        const c = await loginSiswa('T0004');
        const ok = await c.req('/api/simpan-jawaban', { method: 'POST', json: { ujian_id: seeded.ujianId, soal_id: seeded.soalId, jawaban: 'A' } });
        assert.equal(ok.status, 200, ok.text);
        await pool.query("UPDATE sesi_ujian SET batas_waktu = NOW() - INTERVAL 10 MINUTE WHERE siswa_id = ?", [sw.insertId]);
        const telat = await c.req('/api/simpan-jawaban', { method: 'POST', json: { ujian_id: seeded.ujianId, soal_id: seeded.soalId, jawaban: 'B' } });
        assert.equal(telat.status, 403);
    });

    describe('admin', () => {
        let admin;
        before(async () => {
            admin = klien();
            const r = await admin.req('/login-admin', { method: 'POST', form: { username: 'admin_uji', password: '1234' } });
            assert.equal(r.location, '/admin/dashboard');
        });

        test('reset ujian: nilai essay lama & hitungan pelanggaran tidak terbawa ke percobaan baru', async () => {
            const hash = await bcrypt.hash('1234', 10);
            const [sw] = await pool.query("INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('T0005', 'Siswa Lima', 'X-A', ?)", [hash]);
            const [es] = await pool.query("INSERT INTO soal (ujian_id, tipe_soal, teks_soal, poin, jawaban_benar, opsi_tambahan) VALUES (?, 'essay', 'Jelaskan', 4, '[]', '{}')", [seeded.ujianId]);
            await pool.query("INSERT INTO sesi_ujian (siswa_id, ujian_id, waktu_mulai, batas_waktu, status) VALUES (?, ?, NOW(), NOW() + INTERVAL 1 HOUR, 'selesai')", [sw.insertId, seeded.ujianId]);
            await pool.query("INSERT INTO nilai_ujian (siswa_id, ujian_id, nilai) VALUES (?, ?, 80)", [sw.insertId, seeded.ujianId]);
            await pool.query("INSERT INTO nilai_essay (siswa_id, ujian_id, soal_id, skor) VALUES (?, ?, ?, 4)", [sw.insertId, seeded.ujianId, es.insertId]);
            for (let i = 0; i < 2; i++) await pool.query("INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan) VALUES (?, ?, 'pindah_tab')", [sw.insertId, seeded.ujianId]);

            const r = await admin.req('/admin/reset-ujian', { method: 'POST', form: { siswa_id: sw.insertId, ujian_id: seeded.ujianId } });
            assert.match(r.location, /msg=/);
            for (const t of ['nilai_essay', 'nilai_ujian', 'sesi_ujian', 'jawaban_siswa']) {
                const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE siswa_id = ?`, [sw.insertId]);
                assert.equal(c.n, 0, `${t} harus kosong setelah reset`);
            }
            const { hitungPelanggaran } = require('../services/sesiService');
            assert.equal(await hitungPelanggaran(sw.insertId, seeded.ujianId, pool), 0);
            const [[log]] = await pool.query("SELECT COUNT(*) AS n FROM log_kecurangan WHERE siswa_id = ? AND jenis_kecurangan = 'pindah_tab'", [sw.insertId]);
            assert.equal(log.n, 2, 'log lama tetap tersimpan sebagai bukti');
            await pool.query('DELETE FROM soal WHERE id = ?', [es.insertId]);
        });

        test('ganti nama kelas ikut memperbarui siswa; hapus kelas berisi siswa ditolak', async () => {
            await pool.query("INSERT INTO kelas (nama_kelas) VALUES ('Z-1')");
            const hash = await bcrypt.hash('1234', 10);
            await pool.query("INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('Z001', 'Siswa Z', 'Z-1', ?)", [hash]);
            const [[k]] = await pool.query("SELECT id FROM kelas WHERE nama_kelas = 'Z-1'");
            await admin.req(`/admin/kelas/edit/${k.id}`, { method: 'POST', form: { nama_kelas: 'Z-2' } });
            const [[sw]] = await pool.query("SELECT kelas FROM siswa WHERE nis = 'Z001'");
            assert.equal(sw.kelas, 'Z-2');
            const del = await admin.req(`/admin/kelas/hapus/${k.id}`, { method: 'POST' });
            assert.match(decodeURIComponent(del.location), /error=.*masih memiliki 1 siswa/);
            const [[ada]] = await pool.query('SELECT COUNT(*) AS n FROM kelas WHERE id = ?', [k.id]);
            assert.equal(ada.n, 1);
        });

        test('edit siswa tanpa mengisi PIN tidak mengubah PIN; PIN kosong/pendek ditolak saat tambah', async () => {
            const [[sw]] = await pool.query("SELECT id, pin_ujian FROM siswa WHERE nis = 'T0003'");
            await admin.req(`/admin/siswa/edit/${sw.id}`, { method: 'POST', form: { nis: 'T0003', nama: 'Nama Baru', kelas: 'X-A', pin_ujian: '' } });
            const [[sesudah]] = await pool.query('SELECT pin_ujian, nama FROM siswa WHERE id = ?', [sw.id]);
            assert.equal(sesudah.pin_ujian, sw.pin_ujian);
            assert.equal(sesudah.nama, 'Nama Baru');
            const tambah = await admin.req('/admin/siswa/tambah', { method: 'POST', form: { nis: 'NOPIN', nama: 'Tanpa PIN', kelas: 'X-A', pin_ujian: '' } });
            assert.match(decodeURIComponent(tambah.location), /PIN wajib diisi/);
            const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM siswa WHERE nis = 'NOPIN'");
            assert.equal(n.n, 0);
        });

        test('validasi ujian: tanggal selesai harus setelah mulai, durasi positif', async () => {
            const base = { pengajaran_id: seeded.pengajaranId, nama_ujian: 'Ujian Cacat', durasi: '60', tanggal_mulai: '2030-01-02T10:00', tanggal_selesai: '2030-01-02T09:00', batas_pelanggaran: '3' };
            const r1 = await admin.req('/admin/ujian/tambah', { method: 'POST', form: base });
            assert.match(decodeURIComponent(r1.location), /Tanggal selesai harus setelah/);
            const r2 = await admin.req('/admin/ujian/tambah', { method: 'POST', form: { ...base, tanggal_selesai: '2030-01-02T11:00', durasi: '0' } });
            assert.match(decodeURIComponent(r2.location), /Durasi/);
            const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM ujian WHERE nama_ujian = 'Ujian Cacat'");
            assert.equal(n.n, 0);
        });

        test('cetak hasil: dua siswa bernama sama tidak digabung', async () => {
            const hash = await bcrypt.hash('1234', 10);
            const [a] = await pool.query("INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('K001', 'Budi Sama', 'X-A', ?)", [hash]);
            const [b] = await pool.query("INSERT INTO siswa (nis, nama, kelas, pin_ujian) VALUES ('K002', 'Budi Sama', 'X-A', ?)", [hash]);
            for (const id of [a.insertId, b.insertId]) {
                await pool.query("INSERT INTO nilai_ujian (siswa_id, ujian_id, nilai, selesai_pada) VALUES (?, ?, 50, NOW())", [id, seeded.ujianId]);
            }
            const r = await admin.req(`/admin/hasil/cetak/${seeded.ujianId}`);
            assert.equal(r.status, 200);
            assert.match(r.text, /K001/);
            assert.match(r.text, /K002/);
        });

        test('error 500 tidak membocorkan pesan internal pada production-like handler', async () => {
            const r = await admin.req('/admin/ujian/edit/abc');
            assert.ok(r.status < 500 || !/ER_|SQL/.test(r.text));
        });
    });
});
