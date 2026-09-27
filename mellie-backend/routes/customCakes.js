const express = require('express');
const db = require('../db');
const { attachUser, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

// POST /api/custom-cakes (public — logged-in users get their request linked to their account)
router.post('/', attachUser, (req, res) => {
  const { name, email, phone, occasion, design, flavor, toppings, size, budget, needed_by, details } = req.body || {};

  if (!name || !email || !details) {
    return res.status(400).json({ error: 'name, email and details are required.' });
  }

  const info = db
    .prepare(
      `INSERT INTO custom_cake_requests
         (user_id, name, email, phone, occasion, design, flavor, toppings, size, budget, needed_by, details)
       VALUES (@user_id, @name, @email, @phone, @occasion, @design, @flavor, @toppings, @size, @budget, @needed_by, @details)`
    )
    .run({
      user_id: req.user ? req.user.id : null,
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      phone: phone ? String(phone).trim() : '',
      occasion: occasion || '',
      design: design || '',
      flavor: flavor || '',
      toppings: toppings || '',
      size: size || '',
      budget: budget || '',
      needed_by: needed_by || '',
      details: String(details).trim(),
    });

  const request = db.prepare('SELECT * FROM custom_cake_requests WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ request });
});

// GET /api/custom-cakes (admin only) — list all, optional ?status=
router.get('/', requireAdmin, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM custom_cake_requests';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const requests = db.prepare(sql).all(...params);
  res.json({ requests });
});

// GET /api/custom-cakes/:id (admin only)
router.get('/:id', requireAdmin, (req, res) => {
  const request = db.prepare('SELECT * FROM custom_cake_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  res.json({ request });
});

// PATCH /api/custom-cakes/:id/status (admin only)  { status }
router.patch('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` });
  }
  const existing = db.prepare('SELECT * FROM custom_cake_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found.' });

  db.prepare("UPDATE custom_cake_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    existing.id
  );
  const request = db.prepare('SELECT * FROM custom_cake_requests WHERE id = ?').get(existing.id);
  res.json({ request });
});

// DELETE /api/custom-cakes/:id (admin only) — permanently remove a request
// (used for spam or test entries; done requests are usually kept for records)
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM custom_cake_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found.' });
  db.prepare('DELETE FROM custom_cake_requests WHERE id = ?').run(existing.id);
  res.json({ success: true });
});

module.exports = router;
