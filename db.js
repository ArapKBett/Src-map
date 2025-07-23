// db.js
const { Pool } = require('pg');
const { patchPGPoolAsync } = require('./pg-filecommenter-sourcemap');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'mydb',
  password: 'mypassword',
  port: 5432,
});

patchPGPoolAsync(pool);

module.exports = pool;
