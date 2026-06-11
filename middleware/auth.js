// middleware/auth.js
module.exports = {
    isAdmin: (req, res, next) => {
        if (req.session && req.session.adminId) return next();
        res.redirect('/login-admin');
    },
    isGuru: (req, res, next) => {
        if (req.session && req.session.guruId) return next();
        res.redirect('/login-guru');
    },
    isSiswa: (req, res, next) => {
        if (req.session && req.session.siswaId) return next();
        res.redirect('/login');
    },
    // Middleware untuk API (tanpa redirect, langsung 401)
    isSiswaAPI: (req, res, next) => {
        if (req.session && req.session.siswaId && req.session.ujianId) {
            return next();
        }
        res.status(401).json({ error: 'Unauthorized, silakan login ulang' });
    }
};