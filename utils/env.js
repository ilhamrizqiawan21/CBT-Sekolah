// utils/env.js — validasi konfigurasi saat server dinyalakan (fail-fast)
const SECRET_PLACEHOLDER = ['ganti-dengan-secret-yang-kuat', 'changeme', 'secret'];

function validateEnv(env = process.env) {
    const errors = [];
    const secret = env.SESSION_SECRET || '';

    if (!secret) {
        errors.push('SESSION_SECRET belum diisi di .env');
    } else if (env.NODE_ENV === 'production') {
        if (secret.length < 32) errors.push('SESSION_SECRET minimal 32 karakter pada NODE_ENV=production');
        if (SECRET_PLACEHOLDER.includes(secret.toLowerCase())) errors.push('SESSION_SECRET masih memakai nilai contoh dari .env.example');
    }
    if (!env.DB_NAME) errors.push('DB_NAME belum diisi di .env');
    if (!env.DB_USER) errors.push('DB_USER belum diisi di .env');
    if (env.NODE_ENV === 'production' && !env.DB_PASSWORD && !env.DB_SOCKET) {
        errors.push('DB_PASSWORD kosong pada NODE_ENV=production');
    }

    if (errors.length > 0) {
        const pesan = 'Konfigurasi tidak valid:\n - ' + errors.join('\n - ');
        const err = new Error(pesan);
        err.configErrors = errors;
        throw err;
    }
    return true;
}

module.exports = { validateEnv };
