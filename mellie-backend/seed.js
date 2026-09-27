require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@melliebakehouse.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Mellie Admin';

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing) {
    console.log(`Admin account already exists (${ADMIN_EMAIL}). Skipping.`);
    return;
  }
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(
    ADMIN_NAME,
    ADMIN_EMAIL,
    passwordHash,
    'admin'
  );
  console.log(`Created admin account:`);
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  console.log('Change this password after first login (or edit the users table directly).');
}

function seedProducts() {
  const { c: count } = db.prepare('SELECT COUNT(*) AS c FROM products').get();
  if (count > 0) {
    console.log('Products table already has data. Skipping product seed.');
    return;
  }

  const products = [
    {
      name: 'Strawberry Cloud Cake',
      description: 'Light vanilla sponge, whipped cream & fresh strawberries.',
      price: 799,
      category: 'Cakes',
      tag: 'BESTSELLER',
      stock: 12,
      image_key: 'cake',
    },
    {
      name: 'Classic Butter Croissant',
      description: 'Flaky, buttery layers baked fresh every morning.',
      price: 149,
      category: 'Pastries',
      tag: 'NEW',
      stock: 40,
      image_key: 'croissant',
    },
    {
      name: 'Berry Bliss Cupcake',
      description: 'Moist cupcake topped with berry buttercream.',
      price: 179,
      category: 'Cupcakes',
      tag: 'SEASONAL',
      stock: 25,
      image_key: 'cupcake',
    },
    {
      name: 'Chocolate Dream Tart',
      description: 'Silky dark chocolate ganache in a crisp shell.',
      price: 499,
      category: 'Cakes',
      tag: 'BESTSELLER',
      stock: 8,
      image_key: 'tart',
    },
  ];

  const insert = db.prepare(
    `INSERT INTO products (name, description, price, category, tag, stock, image_key)
     VALUES (@name, @description, @price, @category, @tag, @stock, @image_key)`
  );
  const insertMany = db.transaction((rows) => rows.forEach((row) => insert.run(row)));
  insertMany(products);
  console.log(`Seeded ${products.length} sample products.`);
}

seedAdmin();
seedProducts();
console.log('Seed complete.');
