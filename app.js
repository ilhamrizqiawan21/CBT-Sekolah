require('dotenv').config();
const { validateEnv } = require('./utils/env');
validateEnv();

const express    = require('express');
const session    = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path       = require('path');
const http       = require('http');
const socketIo   = require('socket.io');
const pool       = require('./models/db');
const monitorService = require('./services/monitorService');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);

// ─────────────────────────────────────────────────────────────
// FIX #4 — Validasi pelanggaran TIDAK bergantung hanya pada
// socket. Kita simpan siswa_id + ujian_id di sessionSocketMap
// seperti semula, TAPI setiap pengecekan batas pelanggaran
// sekarang langsung query DB sehingga valid meski socket
// sempat disconnect/reconnect.
//
// FIX #5 — Batas pelanggaran dihitung dari TOTAL semua jenis
// kecurangan (pindah_tab + copy_paste), bukan per-jenis.
// Ini menutup celah "kombinasi kecurangan di bawah batas".
//
// FIX #12 — sesi_ujian di-INSERT saat siswa-siap agar
// validasi sesi di authController.js benar-benar berfungsi.
// ─────────────────────────────────────────────────────────────

// key: socket.id → { siswa_id, ujian_id }
const sessionSocketMap = new Map();

// ─── Middleware ───
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 menit
    expiration: 1000 * 60 * 60 * 24, // 1 hari
    createDatabaseTable: true
}, pool);

const sessionMiddleware = session({
    secret:            process.env.SESSION_SECRET,
    store:             sessionStore,
    resave:            false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // Default: aktif di production (butuh HTTPS). Untuk server LAN tanpa HTTPS,
        // set COOKIE_SECURE=false agar cookie sesi tetap diterima peramban.
        secure:   process.env.COOKIE_SECURE !== undefined
                      ? process.env.COOKIE_SECURE === 'true'
                      : process.env.NODE_ENV === 'production',
        maxAge:   1000 * 60 * 60 * 24
    }
});

app.use(sessionMiddleware);
const { verifySameOrigin } = require('./middleware/csrfProtection');
app.use(verifySameOrigin);
io.engine.use(sessionMiddleware);
app.set('io', io);

// ─── Pengaturan Identitas & Logo Sekolah ───
const pengaturanService = require('./services/pengaturanService');
app.use(async (req, res, next) => {
    try {
        const settings = await pengaturanService.getPengaturan(pool);
        res.locals.appSettings = settings;
        res.locals.namaSekolah = settings.nama_sekolah || 'CBT Sekolah';
        res.locals.logoSekolah = (settings.logo_sekolah && settings.logo_sekolah.trim() !== '')
            ? settings.logo_sekolah
            : '/images/default-logo.svg';
        res.locals.isCustomLogo = Boolean(settings.logo_sekolah && settings.logo_sekolah.trim() !== '');
    } catch (_) {
        res.locals.appSettings = { nama_sekolah: 'CBT Sekolah', logo_sekolah: '' };
        res.locals.namaSekolah = 'CBT Sekolah';
        res.locals.logoSekolah = '/images/default-logo.svg';
        res.locals.isCustomLogo = false;
    }
    next();
});

app.set('views',       path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ─── Routes ───
app.use('/',      require('./routes/index'));
app.use('/admin', require('./routes/admin'));
app.use('/guru',  require('./routes/guru'));
app.use('/api',   require('./routes/api'));

const { cekWaktuUjian } = require('./utils/helper');

// ─────────────────────────────────────────────────────────────
// Helper: hitung total pelanggaran gabungan (FIX #5)
// Menggantikan query per-jenis yang sebelumnya dipakai
// hanya di handler pindah_tab.
// ─────────────────────────────────────────────────────────────
async function hitungTotalPelanggaran(pool, siswa_id, ujian_id) {
    return require('./services/sesiService').hitungPelanggaran(siswa_id, ujian_id, pool);
}

// ─────────────────────────────────────────────────────────────
// Helper: cek & eksekusi paksa-submit jika batas terlampaui.
// Dipanggil setelah setiap INSERT log_kecurangan.
// Mengembalikan true jika sudah paksa-submit.
// ─────────────────────────────────────────────────────────────
async function cekDanPaksaSubmit(pool, socket, siswa_id, ujian_id, jenisKecurangan) {
    // FIX #5 — Hitung TOTAL semua jenis, bukan per-jenis
    const jumlah = await hitungTotalPelanggaran(pool, siswa_id, ujian_id);

    const [ujianRow] = await pool.query(
        `SELECT batas_pelanggaran FROM ujian WHERE id = ?`,
        [ujian_id]
    );
    const batas = ujianRow[0]?.batas_pelanggaran || 3;

    if (jumlah >= batas) {
        // FIX #4 — Paksa submit langsung via socket DAN catat di DB
        socket.emit('paksa-submit', {
            message: `⚠️ Batas pelanggaran (${jumlah}/${batas}) terlampaui. Ujian Anda diakhiri.`
        });
        sessionSocketMap.delete(socket.id);

        // Update sesi_ujian ke keluar_paksa (FIX #12 — sesi sudah ada)
        await pool.query(
            `UPDATE sesi_ujian
             SET status = 'keluar_paksa'
             WHERE siswa_id = ? AND ujian_id = ?`,
            [siswa_id, ujian_id]
        );
        return true;
    }

    const sisa = batas - jumlah;
    const labelJenis = jenisKecurangan === 'pindah_tab'       ? 'pindah tab'
                     : jenisKecurangan === 'keluar_fullscreen' ? 'keluar dari layar penuh'
                     : 'copy-paste';
    socket.emit('peringatan', {
        pesan: `⚠️ Peringatan! Anda telah melakukan ${labelJenis}. ` +
               `Total pelanggaran: ${jumlah}/${batas}. Sisa ${sisa} kesempatan.`
    });
    return false;
}

// ─────────────────────────────────────────────────────────────
// Socket.IO
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // ── admin:join (DESIGN §3.6, T4.2) ──
    socket.on('admin:join', ({ ujian_id }) => {
        const session = socket.request.session;
        if (!session || !session.adminId) {
            socket.emit('admin:error', {
                message: 'Akses ditolak: Hanya admin yang diizinkan bergabung ke pemantauan',
                code: 403
            });
            return;
        }

        const room = `admin:${ujian_id}`;
        socket.join(room);
        socket.emit('admin:joined', { ujian_id, room });
    });

    // ── siswa-siap ──
    // Identitas dan tipe perangkat diambil dari sesi login (bukan payload klien).
    socket.on('siswa-siap', async () => {
        const sess = socket.request.session;
        const siswa_id = sess && sess.siswaId;
        const ujian_id = sess && sess.ujianId;
        console.log('siswa-siap: ujian_id=%s siswa_id=%s device_type=%s', ujian_id, siswa_id, sess && sess.deviceType);

        if (!siswa_id || !ujian_id) {
            socket.emit('error', { message: 'Data siswa tidak valid' });
            return;
        }

        const validDeviceType = (sess.deviceType === 'hp' || sess.deviceType === 'laptop') ? sess.deviceType : null;
        sessionSocketMap.set(socket.id, { siswa_id, ujian_id, device_type: validDeviceType });

        const pool = require('./models/db');
        try {
            const isValid = await cekWaktuUjian(ujian_id);
            if (!isValid) {
                socket.emit('error', { message: 'Ujian sudah berakhir atau belum dimulai' });
                return;
            }

            // FIX #4 — Cek apakah siswa ini sudah kena paksa-submit sebelumnya.
            // Jika status sesi = 'keluar_paksa', tolak koneksi ulang.
            const [sesiRow] = await pool.query(
                `SELECT status FROM sesi_ujian
                 WHERE siswa_id = ? AND ujian_id = ?`,
                [siswa_id, ujian_id]
            );
            if (sesiRow.length > 0 && sesiRow[0].status === 'keluar_paksa') {
                socket.emit('error', { message: 'Akses ujian Anda telah dicabut karena pelanggaran.' });
                socket.disconnect();
                return;
            }

            const sesiService = require('./services/sesiService');
            let [sesiRows] = await pool.query(
                `SELECT s.*, u.durasi, u.tanggal_mulai, u.tanggal_selesai
                 FROM sesi_ujian s
                 JOIN ujian u ON s.ujian_id = u.id
                 WHERE s.siswa_id = ? AND s.ujian_id = ?`,
                [siswa_id, ujian_id]
            );

            // Perangkat/tab lama yang sesinya sudah diambil alih tidak boleh lagi
            // mencatat pelanggaran atau mengakhiri ujian atas nama siswa.
            if (sesiRows.length > 0 && sesiRows[0].device_token
                && sess.deviceToken && sesiRows[0].device_token !== sess.deviceToken) {
                sessionSocketMap.delete(socket.id);
                socket.emit('error', { message: 'Sesi ujian Anda telah diambil alih di perangkat lain.', code: 409 });
                socket.disconnect();
                return;
            }

            let sesi;
            if (sesiRows.length === 0) {
                const hasil = await sesiService.mulaiAtauLanjut(siswa_id, ujian_id, validDeviceType, pool);
                sesi = hasil.sesi;
            } else {
                sesi = sesiRows[0];
            }

            // Update socket_id, last_seen, dan device_type (jika ada) tanpa mereset status atau waktu_mulai
            await pool.query(
                `UPDATE sesi_ujian
                 SET socket_id = ?,
                     device_type = COALESCE(?, device_type),
                     last_seen = NOW()
                 WHERE id = ?`,
                [socket.id, validDeviceType, sesi.id]
            );

            const sisa_detik = sesiService.hitungSisaDetik(sesi, new Date());
            socket.emit('mulai-ujian', {
                durasi: sesi.durasi,
                sisa_detik,
                batas_waktu: sesi.batas_waktu,
                device_type: validDeviceType || sesi.device_type || 'laptop'
            });

            // Siarkan ke dashboard monitor admin
            await monitorService.siarkanUpdateSiswa(io, ujian_id, siswa_id, pool, { event: 'masuk' });

        } catch (err) {
            console.error('siswa-siap error:', err);
            socket.emit('error', { message: 'Terjadi kesalahan server' });
        }
    });

    // ── pindah-tab ──
    // FIX #4 — Handler ini sekarang tetap mencatat ke DB bahkan saat
    //           socket reconnect, karena validasi pakai DB bukan Map.
    // FIX #5 — Menggunakan cekDanPaksaSubmit() yang hitung total gabungan.
    // T5.1 — Simpan device_type di log_kecurangan
    socket.on('pindah-tab', async () => {
        console.log('pindah-tab dari socket:', socket.id);
        const data = sessionSocketMap.get(socket.id);
        if (!data) return;
        const { siswa_id, ujian_id, device_type } = data;
        if (!siswa_id) return;

        const pool = require('./models/db');
        try {
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
                 VALUES (?, ?, 'pindah_tab', ?)`,
                [siswa_id, ujian_id, device_type || null]
            );
            await cekDanPaksaSubmit(pool, socket, siswa_id, ujian_id, 'pindah_tab');
            await monitorService.siarkanUpdateSiswa(io, ujian_id, siswa_id, pool, { event: 'pelanggaran' });
        } catch (err) {
            console.error('pindah-tab error:', err);
        }
    });

    // ── copy-paste ──
    // FIX #5 — Sebelumnya sudah hitung total, sekarang pakai helper
    //           yang sama agar konsisten dengan pindah-tab.
    // T5.1 — Simpan device_type di log_kecurangan
    socket.on('copy-paste', async () => {
        console.log('copy-paste dari socket:', socket.id);
        const data = sessionSocketMap.get(socket.id);
        if (!data) return;
        const { siswa_id, ujian_id, device_type } = data;
        if (!siswa_id) return;

        const pool = require('./models/db');
        try {
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
                 VALUES (?, ?, 'copy_paste', ?)`,
                [siswa_id, ujian_id, device_type || null]
            );
            await cekDanPaksaSubmit(pool, socket, siswa_id, ujian_id, 'copy_paste');
            await monitorService.siarkanUpdateSiswa(io, ujian_id, siswa_id, pool, { event: 'pelanggaran' });
        } catch (err) {
            console.error('copy-paste error:', err);
        }
    });

    // ── keluar-fullscreen ──
    // FIX #8 — Dicatat sebagai pelanggaran tersendiri.
    // Dihitung ke total gabungan via cekDanPaksaSubmit()
    // sama seperti pindah_tab dan copy_paste.
    // T5.1 & T5.2 — Hanya dihitung untuk Laptop; HP tidak mewajibkan fullscreen
    socket.on('keluar-fullscreen', async () => {
        console.log('keluar-fullscreen dari socket:', socket.id);
        const data = sessionSocketMap.get(socket.id);
        if (!data) return;
        const { siswa_id, ujian_id, device_type } = data;
        if (!siswa_id) return;

        // Jika HP: abaikan event keluar-fullscreen palsu
        if (device_type === 'hp') {
            console.log('keluar-fullscreen diabaikan untuk perangkat hp:', socket.id);
            return;
        }

        const pool = require('./models/db');
        try {
            await pool.query(
                `INSERT INTO log_kecurangan (siswa_id, ujian_id, jenis_kecurangan, device_type)
                 VALUES (?, ?, 'keluar_fullscreen', ?)`,
                [siswa_id, ujian_id, device_type || null]
            );
            await cekDanPaksaSubmit(pool, socket, siswa_id, ujian_id, 'keluar_fullscreen');
            await monitorService.siarkanUpdateSiswa(io, ujian_id, siswa_id, pool, { event: 'pelanggaran' });
        } catch (err) {
            console.error('keluar-fullscreen error:', err);
        }
    });

    // ── selesai-ujian ──
    // FIX #12 — Update status sesi_ujian ke 'selesai'
    socket.on('selesai-ujian', async () => {
        console.log('selesai-ujian dari socket:', socket.id);
        const data = sessionSocketMap.get(socket.id);
        if (data) {
            const { siswa_id, ujian_id } = data;
            const pool = require('./models/db');
            try {
                // Hanya sesi yang masih berjalan; menandai 'selesai' tanpa menghitung
                // nilai akan membuat siswa tidak punya nilai sama sekali.
                const [sesiAktif] = await pool.query(
                    `SELECT status FROM sesi_ujian WHERE siswa_id = ? AND ujian_id = ?`,
                    [siswa_id, ujian_id]
                );
                if (sesiAktif.length > 0 && sesiAktif[0].status === 'sedang_ujian') {
                    await require('./services/finalizeService').finalizeSesi(siswa_id, ujian_id, pool);
                }
                await monitorService.siarkanUpdateSiswa(io, ujian_id, siswa_id, pool, { event: 'selesai' });
            } catch (err) {
                console.error('selesai-ujian update sesi error:', err);
            }
        }
        sessionSocketMap.delete(socket.id);
        socket.disconnect();
    });

    // ── disconnect ──
    socket.on('disconnect', async () => {
        console.log('Socket disconnected:', socket.id);
        const data = sessionSocketMap.get(socket.id);
        if (data && data.siswa_id && data.ujian_id) {
            try {
                const pool = require('./models/db');
                await pool.query(
                    'UPDATE sesi_ujian SET last_seen = NOW() WHERE siswa_id = ? AND ujian_id = ?',
                    [data.siswa_id, data.ujian_id]
                );
                await monitorService.siarkanUpdateSiswa(io, data.ujian_id, data.siswa_id, pool, { event: 'disconnect' });
            } catch (err) {
                console.error('disconnect last_seen update error:', err);
            }
        }
        sessionSocketMap.delete(socket.id);
    });
});

// ─────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.status(404).render('error', {
        message: 'Halaman tidak ditemukan',
        error:   { status: 404, stack: null }
    });
});

app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    const isDevelopment = process.env.NODE_ENV === 'development';
    const status = err.status || 500;
    const pesanAman = 'Terjadi kesalahan server. Silakan coba lagi nanti.';
    res.status(status).render('error', {
        message: (isDevelopment || status < 500) ? (err.message || pesanAman) : pesanAman,
        error:   isDevelopment ? err : { status }
    });
});

// ─────────────────────────────────────────────────────────────
// Background Job Penutupan Otomatis (DESIGN §3.4, T1.8)
// Memeriksa dan memfinalisasi sesi yang melewati batas waktu + grace
// ─────────────────────────────────────────────────────────────
const { startAutoFinalizeJob } = require('./services/finalizeService');
startAutoFinalizeJob(pool, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
    console.log(`Akses dari HP: http://<IP_komputer>:${PORT}`);
});