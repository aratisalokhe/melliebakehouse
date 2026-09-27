const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/products — includes inactive (soft-deleted) products
router.get('/products', requireAdmin, (_req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json({ products });
});

// GET /api/admin/stats — small dashboard summary
router.get('/stats', requireAdmin, (_req, res) => {
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').get().c;
  const lowStock = db.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1 AND stock <= 5').get().c;
  const pendingRequests = db
    .prepare("SELECT COUNT(*) AS c FROM custom_cake_requests WHERE status = 'pending'")
    .get().c;
  const totalRequests = db.prepare('SELECT COUNT(*) AS c FROM custom_cake_requests').get().c;
  const customerCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'customer'").get().c;

  res.json({
    stats: {
      activeProducts: productCount,
      lowStockProducts: lowStock,
      pendingCustomCakeRequests: pendingRequests,
      totalCustomCakeRequests: totalRequests,
      registeredCustomers: customerCount,
    },
  });
});

module.exports = router;
