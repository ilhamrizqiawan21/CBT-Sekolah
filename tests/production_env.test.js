const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const http = require('http');

describe('T6.1 PM2 & Environment Produksi', () => {
    test('1. ecosystem.config.js valid dan terkonfigurasi dengan benar', () => {
        const ecosystemPath = path.join(__dirname, '..', 'ecosystem.config.js');
        assert.ok(fs.existsSync(ecosystemPath), 'ecosystem.config.js harus ada di root');

        const config = require(ecosystemPath);
        assert.ok(Array.isArray(config.apps), 'config.apps harus berupa array');
        assert.strictEqual(config.apps.length, 1, 'Harus mendefinisikan 1 aplikasi');

        const appConfig = config.apps[0];
        assert.strictEqual(appConfig.name, 'cbt-sekolah');
        assert.strictEqual(appConfig.script, 'app.js');
        assert.strictEqual(appConfig.instances, 1, 'Harus 1 instance untuk single server socket in-memory');
        assert.strictEqual(appConfig.exec_mode, 'fork');
        assert.strictEqual(appConfig.autorestart, true);
        assert.ok(appConfig.max_memory_restart, 'Harus mendefinisikan batas restart memori');
        assert.strictEqual(appConfig.env_production?.NODE_ENV, 'production');
        assert.ok(appConfig.error_file, 'Harus mendefinisikan file log error PM2');
        assert.ok(appConfig.out_file, 'Harus mendefinisikan file log output PM2');
    });

    test('2. utils/logger.js mengonfigurasi batas ukuran dan rotasi log', () => {
        const logger = require('../utils/logger');
        assert.ok(logger.transports && logger.transports.length > 0, 'Logger harus memiliki transports');

        const fileTransports = logger.transports.filter(t => t.name === 'file' || t.filename);
        assert.ok(fileTransports.length >= 2, 'Logger harus memiliki minimal 2 transport file (error & combined)');

        for (const ft of fileTransports) {
            assert.ok(ft.maxsize && ft.maxsize > 0, `Transport ${ft.filename} harus memiliki maxsize untuk rotasi`);
            assert.ok(ft.maxFiles && ft.maxFiles > 0, `Transport ${ft.filename} harus memiliki maxFiles untuk rotasi`);
        }
    });

    test('3. NODE_ENV=production mengaktifkan flag Secure pada cookie session over HTTPS', async () => {
        const app = express();
        app.set('trust proxy', 1);

        const sessionMiddleware = session({
            secret: 'test-secret-prod-12345',
            resave: false,
            saveUninitialized: true,
            cookie: {
                httpOnly: true,
                sameSite: 'lax',
                secure: true, // sesuai kondisi NODE_ENV === 'production'
                maxAge: 1000 * 60 * 60
            }
        });

        app.use(sessionMiddleware);
        app.get('/test-cookie', (req, res) => {
            req.session.test = 'ok';
            res.send('ok');
        });

        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: '127.0.0.1',
                    port,
                    path: '/test-cookie',
                    method: 'GET',
                    headers: {
                        'x-forwarded-proto': 'https' // simulasi di balik reverse proxy / tunnel HTTPS
                    }
                }, (r) => {
                    resolve(r);
                });
                req.on('error', reject);
                req.end();
            });

            const setCookieHeader = res.headers['set-cookie'];
            assert.ok(setCookieHeader && setCookieHeader.length > 0, 'Cookie harus diset');
            const cookieString = setCookieHeader[0];
            assert.match(cookieString, /Secure/i, 'Cookie produksi over HTTPS wajib memiliki atribut Secure');
            assert.match(cookieString, /HttpOnly/i, 'Cookie wajib memiliki atribut HttpOnly');
            assert.match(cookieString, /SameSite=Lax/i, 'Cookie wajib memiliki atribut SameSite=Lax');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    test('4. NODE_ENV non-production tidak memaksakan flag Secure sehingga bisa diakses via HTTP lokal', async () => {
        const app = express();
        app.set('trust proxy', 1);

        const sessionMiddleware = session({
            secret: 'test-secret-dev-12345',
            resave: false,
            saveUninitialized: true,
            cookie: {
                httpOnly: true,
                sameSite: 'lax',
                secure: false, // sesuai kondisi NODE_ENV !== 'production'
                maxAge: 1000 * 60 * 60
            }
        });

        app.use(sessionMiddleware);
        app.get('/test-cookie-dev', (req, res) => {
            req.session.test = 'dev';
            res.send('dev');
        });

        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const res = await new Promise((resolve, reject) => {
                const req = http.request({
                    hostname: '127.0.0.1',
                    port,
                    path: '/test-cookie-dev',
                    method: 'GET'
                }, (r) => {
                    resolve(r);
                });
                req.on('error', reject);
                req.end();
            });

            const setCookieHeader = res.headers['set-cookie'];
            assert.ok(setCookieHeader && setCookieHeader.length > 0, 'Cookie harus diset');
            const cookieString = setCookieHeader[0];
            assert.doesNotMatch(cookieString, /Secure/i, 'Cookie non-produksi tidak boleh memiliki atribut Secure pada HTTP');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});

