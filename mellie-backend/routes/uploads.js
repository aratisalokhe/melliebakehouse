const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ---------- Storage mode ----------
//  • Local (no BLOB_READ_WRITE_TOKEN): files land in public/images like before.
//  • Vercel: BLOB_READ_WRITE_TOKEN is auto-injected → files go to Vercel Blob
//    (persistent across deployments, public CDN URLs).
const ON_VERCEL = !!process.env.BLOB_READ_WRITE_TOKEN;
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');
// Only create the folder when the filesystem is writable (it is read-only on
// Vercel — uploads there go to Vercel Blob instead, so no folder is needed).
try { fs.mkdirSync(IMAGES_DIR, { recursive: true }); } catch (_) { /* read-only FS */ }

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
  },
});

// Default catalog photos ship with the repo (served from /images). They are
// only used until an admin uploads a replacement — which is then stored in
// the image_slots table (local disk path or Blob URL).
const SLOT_FILES = {
  cake: '/images/strawberry_cloud_cake_v2.jpg',
  croissant: '/images/butter_croissant_v2.jpg',
  cupcake: '/images/berry_bliss_cupcake_v2.jpg',
  tart: '/images/chocolate_dream_tart_v2.jpg',
  cookie: '/images/chocolate_chip_cookies_v2.jpg',
  pastry: '/images/danish_pastry_v2.jpg',
  hero: '/images/hero_vintage_cake_v2.jpg',
  story: '/images/design_floral_cake_v2.jpg',
};

function slotUrl(slot) {
  const row = db.prepare('SELECT url FROM image_slots WHERE slot = ?').get(slot);
  return row ? row.url : (SLOT_FILES[slot] || '');
}

function setSlotUrl(slot, url) {
  db.prepare(`
    INSERT INTO image_slots (slot, url, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(slot) DO UPDATE SET url = excluded.url, updated_at = datetime('now')
  `).run(slot, url);
}

// Store an uploaded buffer in the active storage mode; returns its public URL.
async function storeImage(file, baseName) {
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase() || '.jpg';
  if (ON_VERCEL) {
    const { put } = require('@vercel/blob');
    const blob = await put(`mellie/${baseName}${ext}`, file.buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.mimetype,
    });
    return blob.url; // absolute https://... URL
  }
  const name = 'upload_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + ext;
  fs.writeFileSync(path.join(IMAGES_DIR, name), file.buffer);
  return '/images/' + name;
}

// Delete a previously stored image if we own it (ignore errors — best effort).
async function deleteImage(imageUrl) {
  if (!imageUrl) return;
  try {
    if (ON_VERCEL && /^https?:\/\//.test(imageUrl)) {
      const { del } = require('@vercel/blob');
      await del(imageUrl);
    } else {
      const name = path.basename(imageUrl);
      if (name.startsWith('upload_')) {
        const full = path.join(IMAGES_DIR, name);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      }
    }
  } catch (_) { /* already gone or not ours */ }
}

// POST /api/uploads/image  (admin only) — multipart field: "image"
// Optional body fields:
//   slot       — cake|croissant|cupcake|tart|cookie|pastry|hero|story
//                replaces the storefront image for that slot
//   product_id — attach the upload as that product's own photo
router.post('/image', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received.' });

  const slot = req.body.slot || null;
  const productId = req.body.product_id ? Number(req.body.product_id) : null;
  let url;

  try {
    if (productId) {
      const product = db.prepare('SELECT id, image_url FROM products WHERE id = ?').get(productId);
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      await deleteImage(product.image_url); // remove previous custom photo
      url = await storeImage(req.file, 'product_' + productId);
      db.prepare("UPDATE products SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(url, productId);
    } else if (slot && SLOT_FILES[slot]) {
      url = await storeImage(req.file, 'slot_' + slot);
      setSlotUrl(slot, url);
    } else {
      url = await storeImage(req.file, 'gallery');
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not store the image.' });
  }

  res.status(201).json({ image: { url }, slot, product_id: productId || null });
});

// GET /api/uploads/images (admin only) — everything manageable:
// slots (with current URLs), products with custom photos, and gallery uploads.
router.get('/images', requireAdmin, (_req, res) => {
  const slots = db.prepare('SELECT slot, url, updated_at FROM image_slots ORDER BY slot').all();
  let gallery = [];
  if (!ON_VERCEL) {
    gallery = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => /^upload_.+\.(jpe?g|png|webp|gif)$/i.test(f))
      .map((f) => {
        const stat = fs.statSync(path.join(IMAGES_DIR, f));
        return { url: '/images/' + f, size: stat.size, modified: stat.mtime };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  }
  res.json({ slots, gallery, mode: ON_VERCEL ? 'blob' : 'local' });
});

// DELETE /api/uploads/product-image/:productId (admin only) — remove a product's
// custom photo and fall back to its catalog slot image.
router.delete('/product-image/:productId', requireAdmin, async (req, res) => {
  const product = db.prepare('SELECT id, image_url FROM products WHERE id = ?').get(req.params.productId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (!product.image_url) return res.status(400).json({ error: 'This product has no custom photo.' });
  await deleteImage(product.image_url);
  db.prepare("UPDATE products SET image_url = '', updated_at = datetime('now') WHERE id = ?").run(product.id);
  res.json({ success: true });
});

// DELETE /api/uploads/gallery/:name (admin only) — delete an unused gallery upload.
router.delete('/gallery/:name', requireAdmin, async (req, res) => {
  const name = path.basename(req.params.name);
  const url = '/images/' + name;
  const inUse = db.prepare('SELECT id, name FROM products WHERE image_url = ?').get(url);
  if (inUse) {
    return res.status(400).json({ error: `This photo is used by the product "${inUse.name}". Remove it from the product first.` });
  }
  await deleteImage(url);
  res.json({ success: true });
});

module.exports = router;
