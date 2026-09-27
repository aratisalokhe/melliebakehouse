// Vercel serverless entry point.
// Every request hits this Express app; Vercel wraps it as a serverless function.
const app = require('../app');

module.exports = app;
