const path = require('path');
const fs = require('fs');
const defaultPool = require('../models/db');
const logger = require('../utils/logger');

const DEFAULTS = {
    nama_sekolah: 'CBT Sekolah',
    logo_sekolah: ''
};

let memoryCache = null;

async function getPengaturan(db = defaultPool) {
    if (memoryCache) {
        return { ...memoryCache };
    }

    try {
        const [rows] = await db.query('SELECT kunci, nilai FROM pengaturan');
        const settings = { ...DEFAULTS };

        for (const row of rows) {
            if (row.kunci && row.nilai !== null && row.nilai !== undefined) {
                settings[row.kunci] = row.nilai;
            }
        }

        if (!settings.nama_sekolah || settings.nama_sekolah.trim() === '') {
            settings.nama_sekolah = DEFAULTS.nama_sekolah;
        }

        memoryCache = settings;
        return { ...settings };
    } catch (err) {
        logger.error(`getPengaturan error: ${err.message}`);
        return { ...DEFAULTS };
    }
}

async function simpanPengaturan(data, db = defaultPool) {
    const keys = ['nama_sekolah', 'logo_sekolah'];
    for (const key of keys) {
        if (data[key] !== undefined) {
            await db.query(
                `INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE nilai = VALUES(nilai)`,
                [key, data[key]]
            );
        }
    }
    invalidateCache();
    return await getPengaturan(db);
}

async function resetLogo(db = defaultPool) {
    const current = await getPengaturan(db);
    if (current.logo_sekolah && current.logo_sekolah.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', 'public', current.logo_sekolah.replace(/^\//, ''));
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            logger.warn(`Gagal menghapus file logo lama: ${err.message}`);
        }
    }

    await db.query(
        `INSERT INTO pengaturan (kunci, nilai) VALUES ('logo_sekolah', '')
         ON DUPLICATE KEY UPDATE nilai = ''`
    );
    invalidateCache();
    return await getPengaturan(db);
}

function invalidateCache() {
    memoryCache = null;
}

module.exports = {
    DEFAULTS,
    getPengaturan,
    simpanPengaturan,
    resetLogo,
    invalidateCache
};

