const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/users (admin only) — list registered accounts (never exposes password hashes)
router.get('/', requireAdmin, (req, res) => {
  const { role } = req.query;
  let sql = 'SELECT id, name, email, role, created_at FROM users';
  const params = [];
  if (role) {
    sql += ' WHERE role = ?';
    params.push(role);
  }
  sql += ' ORDER BY created_at DESC';
  const users = db.prepare(sql).all(...params);
  res.json({ users });
});

// PATCH /api/users/:id/role (admin only) — promote/demote  { role: 'customer'|'admin' }
router.patch('/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body || {};
  if (!['customer', 'admin'].includes(role)) {
    return res.status(400).json({ error: "role must be 'customer' or 'admin'." });
  }
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: "You can't remove your own admin access." });
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  const updated = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(user.id);
  res.json({ user: updated });
});

module.exports = router;
