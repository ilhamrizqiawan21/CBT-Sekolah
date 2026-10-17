// utils/validateEnv.js — validasi konfigurasi saat startup agar kesalahan terdeteksi sebelum ujian
const PLACEHOLDER_SECRETS = ['ganti-dengan-secret-yang-kuat'];

function validateEnv(env = process.env) {
    const errors = [];
    const production = env.NODE_ENV === 'production';

    const secret = env.SESSION_SECRET || '';
    if (!secret) {
        errors.push('SESSION_SECRET belum diisi di .env');
    } else if (production && PLACEHOLDER_SECRETS.includes(secret)) {
        errors.push('SESSION_SECRET masih nilai contoh dari .env.example; ganti dengan string acak');
    } else if (production && secret.length < 32) {
        errors.push('SESSION_SECRET minimal 32 karakter pada NODE_ENV=production');
    }

    if (!env.DB_NAME) errors.push('DB_NAME belum diisi di .env');
    if (!env.DB_USER) errors.push('DB_USER belum diisi di .env');

    if (env.PORT !== undefined && env.PORT !== '') {
        const port = Number(env.PORT);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            errors.push(`PORT tidak valid: "${env.PORT}" (harus bilangan bulat 1–65535)`);
        }
    }

    if (env.COOKIE_SECURE !== undefined && env.COOKIE_SECURE !== '' &&
        !['true', 'false'].includes(env.COOKIE_SECURE)) {
        errors.push('COOKIE_SECURE harus "true" atau "false"');
    }

    return errors;
}

// Flag cookie `secure`: default aktif di produksi, bisa di-override untuk LAN sekolah tanpa HTTPS.
function cookieSecure(env = process.env) {
    if (env.COOKIE_SECURE === 'true') return true;
    if (env.COOKIE_SECURE === 'false') return false;
    return env.NODE_ENV === 'production';
}

module.exports = { validateEnv, cookieSecure };
