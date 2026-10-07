const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Rate limiter per IP longgar untuk login siswa (maks 300 per 15 menit)
const loginSiswaIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    keyGenerator: (req) => ipKeyGenerator(req),
    message: 'Terlalu banyak permintaan login dari jaringan ini. Silakan coba lagi setelah 15 menit.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode);
        if (req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr) {
            return res.render('login', { error: options.message });
        }
        res.send(options.message);
    }
});

// Rate limiter per NIS untuk login siswa (maks 10 per 15 menit)
const loginSiswaNisLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => {
        const nis = req.body?.nis ? String(req.body.nis).trim() : '';
        return nis ? `nis:${nis}` : ipKeyGenerator(req);
    },
    message: 'Terlalu banyak percobaan login untuk NIS ini. Silakan coba lagi setelah 15 menit.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode);
        if (req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr) {
            return res.render('login', { error: options.message });
        }
        res.send(options.message);
    }
});

// Rate limiter per IP+username untuk login admin (maks 10 per 15 menit)
const loginAdminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => {
        const username = req.body?.username ? String(req.body.username).trim() : 'anonymous';
        return `admin:${ipKeyGenerator(req)}:${username}`;
    },
    message: 'Terlalu banyak percobaan login admin. Silakan coba lagi setelah 15 menit.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode);
        if (req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr) {
            return res.render('login-admin', { error: options.message });
        }
        res.send(options.message);
    }
});

// Rate limiter per IP+username untuk login guru (maks 10 per 15 menit)
const loginGuruLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => {
        const username = req.body?.username ? String(req.body.username).trim() : 'anonymous';
        return `guru:${ipKeyGenerator(req)}:${username}`;
    },
    message: 'Terlalu banyak percobaan login guru. Silakan coba lagi setelah 15 menit.',
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (req, res, next, options) => {
        res.status(options.statusCode);
        if (req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr) {
            return res.render('login-guru', { error: options.message });
        }
        res.send(options.message);
    }
});

module.exports = {
    loginSiswaIpLimiter,
    loginSiswaNisLimiter,
    loginAdminLimiter,
    loginGuruLimiter
};
