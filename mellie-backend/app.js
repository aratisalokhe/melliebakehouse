// The shared Express app — used by BOTH entry points:
//   • server.js    → local development (`npm start`)
//   • api/index.js → Vercel serverless deployment
const path = require('path');
const express = require('express');
const cors = require('cors');
require('./db'); // ensure schema exists (routes require it too)

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const customCakeRoutes = require('./routes/customCakes');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/uploads');
const userRoutes = require('./routes/users');
const newsletterRoutes = require('./routes/newsletter');

const app = express();

// Production gate: set PUBLIC_DEPLOY=true on the hosted deployment.
// The admin console and every admin-only API then disappear (plain 404s),
// so only your local machine can manage the bakery.
const PUBLIC_DEPLOY = String(process.env.PUBLIC_DEPLOY || '').toLowerCase() === 'true';
function hideFromPublic(_req, res, next) {
  if (PUBLIC_DEPLOY) return res.status(404).json({ error: 'Not found.' });
  next();
}

app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Basic security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Both /admin and /console serve the SAME standalone console (the legacy page
// was retired). /admin keeps working for old bookmarks — it opens the real
// login page directly, no intermediate screen.
app.use('/admin', hideFromPublic, express.static(path.join(__dirname, 'admin-app')));

// Serve the standalone admin console (separate from the site code) at /console
app.use('/console', hideFromPublic, express.static(path.join(__dirname, 'admin-app')));

// Real catalog photos bundled with the repo (uploads live in Blob/DB on Vercel).
app.use('/images', express.static(path.join(__dirname, 'public/images'), {
  setHeaders(res) { res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); },
}));

app.get('/api/health', (_req, res) => {
  // dbMode tells you at a glance how the deployment is storing data:
  //   turso         → cloud DB connected (correct for a hosted site)
  //   local-file    → normal local development
  //   tmp-ephemeral → hosted but Turso not connected (data resets!)
  //   memory        → last-resort fallback
  // diagnostics shows WHY: whether the env vars reached the function at all,
  // and if they did, the exact error the Turso connection produced.
  const db = require('./db');
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    dbMode: db.dbMode || 'unknown',
    diagnostics: db.dbDiag || null,
  });
});

app.get('/api/images-version', (_req, res) => {
  // The newest image_slots/product change drives cache-busting on the storefront.
  try {
    const db = require('./db');
    const row = db.prepare(`
      SELECT MAX(updated_at) AS t FROM (
        SELECT updated_at FROM image_slots
        UNION ALL
        SELECT updated_at FROM products WHERE image_url != ''
      )
    `).get();
    res.set('Cache-Control', 'no-store');
    res.json({ version: row && row.t ? new Date(row.t.replace(' ', 'T') + 'Z').getTime() : Date.now() });
  } catch (_) {
    res.set('Cache-Control', 'no-store');
    res.json({ version: Date.now() });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/custom-cakes', customCakeRoutes);
app.use('/api/admin', hideFromPublic, adminRoutes);
app.use('/api/uploads', hideFromPublic, uploadRoutes);
app.use('/api/users', hideFromPublic, userRoutes);
app.use('/api/newsletter', newsletterRoutes);

// 404 handler for unmatched API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Serve storefront at /
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Central error handler — keep multer's "file too large" message readable.
app.use((err, _req, res, _next) => {
  console.error(err);
  const msg = err && err.code === 'LIMIT_FILE_SIZE'
    ? 'Image is larger than 8 MB — please choose a smaller file.'
    : 'Something went wrong on our end.';
  res.status(500).json({ error: msg });
});

module.exports = app;
