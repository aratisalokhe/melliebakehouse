// Local development entry point (`npm start`).
// The Vercel serverless entry lives in api/index.js and shares this app.
const app = require('./app');

const requestedPort = Number(process.env.PORT);
const PORT = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 4000;

const PUBLIC_DEPLOY = String(process.env.PUBLIC_DEPLOY || '').toLowerCase() === 'true';

// Start listening; if the port is busy (e.g. another copy of the app is already
// running), automatically try the next ports instead of crashing.
// The server binds to ALL interfaces (dual-stack): 'localhost' resolves to
// either 127.0.0.1 (IPv4) or ::1 (IPv6) depending on the browser/OS, and both
// reach the server — no 'backend offline' surprises in Edge, Chrome or anything else.
function listen(port, attemptsLeft = 10) {
  const server = app.listen(port, '::', () => {
    console.log(`Mellie Bakehouse backend running at http://localhost:${port}`);
    if (PUBLIC_DEPLOY) {
      console.log('PUBLIC_DEPLOY=true — admin console & admin APIs are disabled.');
    } else {
      console.log(`Admin console: http://localhost:${port}/console`);
    }
    console.log(`API base:      http://localhost:${port}/api`);
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} is busy — trying ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('Could not start the server:', err && err.message ? err.message : err);
      process.exit(1);
    }
  });
}
listen(PORT);
