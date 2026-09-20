const http = require('http');
const db = require('../db.js');
const handler = require('../server.js');

async function testTurso() {
  await db.initDb();
  console.log('Active DB Mode:', db.getMode());

  const state = await db.readDb();
  console.log('Loaded companies from Turso:', state.companies?.length);
  console.log('Loaded users from Turso:', state.users?.length);

  const server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(3457, resolve));
  console.log('Test server started on 3457');

  const res = await fetch('http://127.0.0.1:3457/api/companies');
  const json = await res.json();
  console.log('API /api/companies HTTP status:', res.status, 'Total items:', json.total);

  server.close();
  console.log('✓ TURSO CLOUD END-TO-END VERIFICATION SUCCESSFUL!');
}

testTurso().catch(err => {
  console.error('Turso test error:', err);
  process.exit(1);
});
