const mysql = require('mysql2/promise');
require('dotenv').config();

const poolConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
};

if (process.env.DB_SOCKET) {
    poolConfig.socketPath = process.env.DB_SOCKET;
} else {
    poolConfig.host = process.env.DB_HOST || '127.0.0.1';
    if (process.env.DB_PORT) {
        poolConfig.port = Number(process.env.DB_PORT);
    }
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;