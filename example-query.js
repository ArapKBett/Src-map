// example-query.js
const pool = require('./db');

async function run() {
  // SQL comment will include resolved original source file and position
  const res = await pool.query('SELECT NOW();');
  console.log(res.rows[0]);
}

run().catch(console.error).finally(() => process.exit());
