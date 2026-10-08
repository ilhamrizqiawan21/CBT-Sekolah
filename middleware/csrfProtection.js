/**
 * middleware/csrfProtection.js — Proteksi CSRF berbasis verifikasi Origin / Referer (DESIGN §6)
 * Memeriksa header Origin / Referer pada request metode mutasi (POST, PUT, DELETE, PATCH).
 */

function verifySameOrigin(req, res, next) {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        return next();
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    let sourceHost = null;

    if (origin) {
        try {
            sourceHost = new URL(origin).host;
        } catch (_) {
            return res.status(403).json({ error: 'Header Origin tidak valid' });
        }
    } else if (referer) {
        try {
            sourceHost = new URL(referer).host;
        } catch (_) {
            return res.status(403).json({ error: 'Header Referer tidak valid' });
        }
    }

    // Jika sourceHost ada, wajib cocok dengan host server (mencegah cross-site request forgery)
    if (sourceHost && host && sourceHost.toLowerCase() !== host.toLowerCase()) {
        if (req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr) {
            return res.status(403).render('error', {
                message: 'Akses ditolak: Permintaan lintas situs (CSRF) terdeteksi.',
                error: { status: 403 }
            });
        }
        return res.status(403).json({ error: 'Akses ditolak: Origin/Referer tidak cocok dengan host server' });
    }

    next();
}

module.exports = {
    verifySameOrigin
};

