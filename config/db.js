const mysql = require('mysql2/promise')
require('dotenv').config()

const dbUrl = process.env.DATABASE_URL;

const pool = mysql.createPool(dbUrl);

pool.getConnection().then(connection => {
    console.log('Database connection established successfully!')
    connection.release();
}).catch(err => {
    console.error('Error connecting to the database : ',err.message)
    process.exit(1)
});

module.exports = pool;

