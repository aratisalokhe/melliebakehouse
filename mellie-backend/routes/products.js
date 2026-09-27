const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_IMAGE_KEYS = ['cake', 'croissant', 'cupcake', 'tart', 'cookie', 'pastry'];

function validateProductInput(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) errors.push('name is required.');
    else data.name = String(body.name).trim();
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) errors.push('price must be a non-negative number.');
    else data.price = Math.round(price);
  }
  if (body.description !== undefined) data.description = String(body.description);
  if (body.category !== undefined) data.category = String(body.category);
  if (body.tag !== undefined) data.tag = String(body.tag);
  if (body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isFinite(stock) || stock < 0) errors.push('stock must be a non-negative number.');
    else data.stock = Math.round(stock);
  }
  if (body.image_key !== undefined) {
    if (!ALLOWED_IMAGE_KEYS.includes(body.image_key)) {
      errors.push(`image_key must be one of: ${ALLOWED_IMAGE_KEYS.join(', ')}.`);
    } else {
      data.image_key = body.image_key;
    }
  }
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;

  return { data, errors };
}

// GET /api/products  (public) — supports ?category= and ?includeInactive=1 (admin only in practice)
router.get('/', (req, res) => {
  const { category } = req.query;
  let sql = 'SELECT * FROM products WHERE is_active = 1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY created_at DESC';
  const products = db.prepare(sql).all(...params);
  res.json({ products });
});

// GET /api/products/:id (public)
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product });
});

// POST /api/products (admin only)
router.post('/', requireAdmin, (req, res) => {
  const { data, errors } = validateProductInput(req.body || {});
  if (!data.name || data.price === undefined) errors.push('name and price are required.');
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const info = db
    .prepare(
      `INSERT INTO products (name, description, price, category, tag, stock, image_key)
       VALUES (@name, @description, @price, @category, @tag, @stock, @image_key)`
    )
    .run({
      name: data.name,
      description: data.description || '',
      price: data.price,
      category: data.category || 'Cakes',
      tag: data.tag || '',
      stock: data.stock ?? 0,
      image_key: data.image_key || 'cake',
    });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ product });
});

// PUT /api/products/:id (admin only) — partial update
router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const { data, errors } = validateProductInput(req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const merged = { ...existing, ...data };
  db.prepare(
    `UPDATE products SET
       name = @name, description = @description, price = @price, category = @category,
       tag = @tag, stock = @stock, image_key = @image_key, is_active = @is_active,
       updated_at = datetime('now')
     WHERE id = @id`
  ).run({ ...merged, id: existing.id });

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id);
  res.json({ product });
});

// DELETE /api/products/:id (admin only) — soft delete (marks inactive)
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(existing.id);
  res.json({ success: true });
});

module.exports = router;
