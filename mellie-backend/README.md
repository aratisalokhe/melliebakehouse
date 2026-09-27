# Mellie Bakehouse — Backend

A self-contained backend for the Mellie Bakehouse site: product catalog, custom cake
request submissions, customer accounts, photo uploads, and a standalone admin console.

- **Stack:** Node.js + Express
- **Database:** SQLite locally (`bakery.db` via `libsql`), **Turso cloud** when deployed
- **Photo uploads:** local `public/images/` locally, **Vercel Blob** when deployed
- **Auth:** JWT tokens, passwords hashed with bcrypt

The same code runs locally and on Vercel — nothing to change between the two.

## 1. Local development

```bash
cd mellie-backend
npm install
cp .env.example .env      # then edit JWT_SECRET
npm run seed              # creates the admin account + sample products
npm start                 # http://localhost:4000
```

- Storefront: `http://localhost:4000`
- Admin console: `http://localhost:4000/console`
- API base: `http://localhost:4000/api`

## 2. Deploy to Vercel (step by step)

### Step A — create the cloud database (Turso, free)

```bash
npm i -g @turso/cli
turso auth signup
turso db create mellie
turso db show mellie --url        # → copy this (DATABASE_URL)
turso db tokens create mellie     # → copy this (DATABASE_AUTH_TOKEN)
```

### Step B — push the project to GitHub

Create a GitHub repo and push the **mellie-backend** folder (Vercel imports from Git).

### Step C — import into Vercel

1. Go to vercel.com → **Add New → Project** → pick the repo
2. **Root Directory**: set to `mellie-backend`
3. Framework preset: **Other** (it's a plain Node app — `vercel.json` handles the rest)
4. Before deploying, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the `libsql://…` URL from Step A |
| `DATABASE_AUTH_TOKEN` | the token from Step A |
| `JWT_SECRET` | any long random string |
| `JWT_EXPIRES_IN` | `7d` |
| `ADMIN_EMAIL` | your admin login email |
| `ADMIN_PASSWORD` | **a strong password — not the local default** |
| `ADMIN_NAME` | Mellie Admin |

5. Deploy — your site will be live at `https://<project>.vercel.app`

### Step D — enable photo uploads (Vercel Blob, free)

In the Vercel dashboard: your project → **Storage** → **Create Database → Blob** →
connect it to this project. Vercel injects `BLOB_READ_WRITE_TOKEN` automatically —
no code changes. Redeploy once after connecting.

### Step E — seed the cloud database (once)

```bash
# locally, with the Turso values from Step A in your .env:
DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run seed
```

Now the hosted admin console (`https://<project>.vercel.app/console`) works with the
same email/password you set in the environment variables.

## Troubleshooting the deployment

**"This page is unavailable — a function needed by this page temporarily failed"**
(the error from the screenshot):

1. Open `https://<project>.vercel.app/api/health`. It reports the live database mode:
   - `"dbMode": "turso"` → everything is connected correctly ✅
   - `"dbMode": "tmp-ephemeral"` or `"memory"` → `DATABASE_URL` / `DATABASE_AUTH_TOKEN`
     are **not set** in Vercel → add both in Project → Settings → Environment
     Variables → **Redeploy**. (The site still loads in this mode, but bookings reset.)
2. **Function logs:** Vercel dashboard → your project → **Deployments** → latest →
   **Functions** tab (or the **Runtime Logs** tab). The exact crash reason appears there.
3. After changing **any** environment variable you must click **Redeploy** — env vars
   only apply to new deployments.
4. Photo uploads on the live site need the Blob store connected (Step D) — without it,
   uploads return 500 but everything else still works.
5. If the page loads but images are broken on the live site, confirm you pushed the
   `public/images/` folder to GitHub (the 8 catalog photos ship with the repo).

With the latest code the function **cannot crash at boot for storage reasons** — without
a cloud DB it falls back to an ephemeral database and keeps serving the site, and
`/api/health` always tells you which mode you're in.

## The admin console (`/console`)

`admin-app/` is a **standalone admin application, separate from the storefront code**.
From this one panel you can:

- **Dashboard** — live stats (pending requests, products, customers, low stock)
- **Products & Images** — add/edit/hide/delete products, **upload photos into the
  catalog slots** (cake, croissant, cupcake, tart, cookie, pastry, hero, story) and
  **give each product its own custom photo** — it overrides the slot image
- **Cake Requests** — every booking with occasion, design, flavor, size, toppings,
  budget, date. Change status: pending → confirmed → completed/cancelled
- **Accounts** — all registered logins (emails + roles). Passwords are stored only as
  bcrypt hashes and can never be read back. Promote/demote admins.

Storefront pages pick up image changes within seconds — no restart needed.

## Keeping the console private

The console is protected by the admin login (JWT). If you want it **completely
invisible** on the hosted site (manage content locally only), set:

```
PUBLIC_DEPLOY=true
```

in Vercel's Environment Variables. The console (and `/admin`, which now redirects
to it) and every admin-only API then return plain 404s while the public storefront
keeps working.

## API reference

### Auth
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/api/auth/register` | — | `{ name, email, password }` |
| POST | `/api/auth/login` | — | `{ email, password }` |
| GET | `/api/auth/me` | Bearer token | — |

### Products
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/products` | — | Active products only. Optional `?category=Cakes` |
| GET | `/api/products/:id` | — | |
| POST | `/api/products` | Admin | `{ name, price, description?, category?, tag?, stock?, image_key? }` |
| PUT | `/api/products/:id` | Admin | Any subset of the same fields |
| DELETE | `/api/products/:id` | Admin | Soft delete (sets `is_active = 0`) |

`image_key` must be one of: `cake`, `croissant`, `cupcake`, `tart`, `cookie`, `pastry` —
these map to the bundled photos in `public/images/` until replaced via the console.

### Custom cake requests
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/custom-cakes` | Optional | `{ name, email, phone?, occasion?, design?, flavor?, toppings?, size?, budget?, needed_by?, details }`. If a logged-in user's token is sent, the request is linked to their account. |
| GET | `/api/custom-cakes` | Admin | Optional `?status=pending` |
| PATCH | `/api/custom-cakes/:id/status` | Admin | `{ status }` — `pending`, `confirmed`, `completed`, `cancelled` |

### Admin
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/admin/products` | Admin | All products, including hidden ones |
| GET | `/api/admin/stats` | Admin | Dashboard counters |

### Image uploads (used by the console)
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/uploads/image` | Admin | Multipart `image` + optional `slot` or `product_id` |
| GET | `/api/uploads/images` | Admin | Slot URLs + gallery uploads + storage mode |
| DELETE | `/api/uploads/product-image/:productId` | Admin | Remove a product's custom photo |
| DELETE | `/api/uploads/gallery/:name` | Admin | Delete an unused gallery upload |

### Health check
`GET /api/health` → `{ status: "ok", time }`

## Project structure

```
mellie-backend/
├── api/
│   └── index.js          # ★ Vercel serverless entry
├── app.js                # ★ shared Express app (used by both entries)
├── server.js             # local entry point (npm start)
├── vercel.json           # Vercel routing + function config
├── db.js                 # libsql — local SQLite file ↔ Turso cloud
├── seed.js               # creates first admin + sample products
├── index.html            # the storefront (single file, no build step)
├── admin-app/            # ★ STANDALONE ADMIN CONSOLE
│   ├── index.html
│   └── app.js
├── middleware/auth.js    # JWT verification, role guards
├── routes/
│   ├── auth.js
│   ├── products.js
│   ├── customCakes.js
│   ├── admin.js
│   ├── uploads.js        # photo uploads → Vercel Blob (or local disk)
│   └── users.js
├── public/
│   ├── admin/            # legacy admin page
│   └── images/           # bundled catalog photos served at /images
├── .env.example
└── package.json
```

## Production notes

- Set a strong, unique `JWT_SECRET` and change `ADMIN_PASSWORD` from the default.
- HTTPS is automatic on Vercel. The JWT travels in an `Authorization` header (not a
  cookie), so it's not vulnerable to CSRF.
- Turso free tier is more than enough for a single bakery; back up with
  `turso db export mellie` occasionally.
- Bookings made on the hosted site live in the **Turso** cloud database; your local
  `bakery.db` stays separate.
