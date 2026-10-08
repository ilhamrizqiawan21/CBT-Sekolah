const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');

describe('Landing page "/"', () => {
    let server, baseUrl, sess = {};

    const get = (urlPath) => new Promise((resolve, reject) => {
        const url = new URL(urlPath, baseUrl);
        http.get({ hostname: url.hostname, port: url.port, path: url.pathname }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', c => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
        }).on('error', reject);
    });

    before(async () => {
        const app = express();
        app.use(session({ secret: 'test-landing', resave: false, saveUninitialized: false }));
        app.use((req, res, next) => { Object.assign(req.session, sess); next(); });
        app.set('views', path.join(__dirname, '..', 'views'));
        app.set('view engine', 'ejs');
        app.use('/', require('../routes/index'));
        server = http.createServer(app);
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await new Promise(r => server.close(r));
        await require('./helpers/db').closeTestPool();
    });

    test('1. Pengunjung anonim melihat landing dengan tautan ke tiga halaman login', async () => {
        sess = {};
        const res = await get('/');
        assert.equal(res.status, 200);
        for (const href of ['/login', '/login-guru', '/login-admin']) {
            assert.ok(res.body.includes(`href="${href}"`), `tautan ${href} harus ada`);
        }
    });

    test('2. Admin yang sudah login diarahkan ke dashboard admin', async () => {
        sess = { adminId: 1 };
        const res = await get('/');
        assert.equal(res.status, 302);
        assert.equal(res.location, '/admin/dashboard');
    });

    test('3. Guru yang sudah login diarahkan ke dashboard guru', async () => {
        sess = { guruId: 1 };
        const res = await get('/');
        assert.equal(res.location, '/guru/dashboard');
    });

    test('4. Siswa dengan sesi ujian diarahkan ke /ujian', async () => {
        sess = { siswaId: 1, ujianId: 1 };
        const res = await get('/');
        assert.equal(res.location, '/ujian');
    });
});
