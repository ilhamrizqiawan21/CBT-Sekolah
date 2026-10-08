const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message} ${stack ? '\n' + stack : ''}`;
        })
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024, // 10 MB per berkas
            maxFiles: 5,               // Simpan maksimal 5 berkas rotasi
            tailable: true
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log'),
            maxsize: 10 * 1024 * 1024, // 10 MB per berkas
            maxFiles: 5,               // Simpan maksimal 5 berkas rotasi
            tailable: true
        }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

module.exports = logger;