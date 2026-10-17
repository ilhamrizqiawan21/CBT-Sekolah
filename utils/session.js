// utils/session.js — pembuatan sesi login yang aman dari session fixation
const bcrypt = require('bcrypt');

// Hash palsu agar waktu respons login tidak membedakan username yang ada dan tidak ada
const DUMMY_HASH = bcrypt.hashSync('tidak-dipakai', 10);

// Mengganti ID sesi (regenerate) lalu mengisi data login dan menyimpannya.
function mulaiSesi(req, data) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);
            Object.assign(req.session, data);
            req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
    });
}

// Bandingkan password tanpa membocorkan apakah akun ada. `hash` boleh undefined.
async function cekPassword(password, hash) {
    const cocok = await bcrypt.compare(typeof password === 'string' ? password : '', hash || DUMMY_HASH);
    return Boolean(hash) && cocok;
}

module.exports = { mulaiSesi, cekPassword };
