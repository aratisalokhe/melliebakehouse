const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/newsletter  { email }  (public — the storefront's Sweet List form)
router.post('/', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    // Duplicate sign-ups simply succeed without creating a second row —
    // a friendly "you're already on the list" is still a good experience.
    db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)').run(email);
  } catch (err) {
    console.error('newsletter insert failed:', err.message);
    return res.status(500).json({ error: 'Could not save your subscription. Please try again.' });
  }

  res.status(201).json({ success: true, message: "You're on the list! Welcome to the sweetness ♡" });
});

// GET /api/newsletter (admin only) — the subscriber list, newest first
router.get('/', requireAdmin, (_req, res) => {
  const subscribers = db
    .prepare('SELECT id, email, created_at FROM newsletter_subscribers ORDER BY created_at DESC, id DESC')
    .all();
  res.json({ subscribers, total: subscribers.length });
});

// DELETE /api/newsletter/:id (admin only) — remove an entry (e.g. unsubscribe request)
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM newsletter_subscribers WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Subscriber not found.' });
  db.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(existing.id);
  res.json({ success: true });
});

module.exports = router;
