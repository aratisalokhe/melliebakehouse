/* Mellie Console — standalone admin app (separate from the storefront code) */
(function () {
  'use strict';

  // Where the backend API lives:
  //   • served BY the backend, or hosted (Vercel) → same-origin ('')
  //   • static preview / Live Server (ports 5500–5599) or file:// → localhost:4000
  // Edge sometimes resolves "localhost" to ::1 (IPv6) while Node listens on IPv4
  // only — if the first candidate fails we retry 127.0.0.1, which always reaches
  // an IPv4 listener. The winning base is used for the rest of the session.
  const API_CANDIDATES = (location.protocol.startsWith('http') && !/^55\d\d$/.test(location.port))
    ? ['']
    : ['http://localhost:4000', 'http://127.0.0.1:4000'];
  let API = API_CANDIDATES[0];

  async function resolveApiBase() {
    if (API_CANDIDATES.length === 1) return API;
    for (const base of API_CANDIDATES) {
      try {
        const r = await fetch(base + '/api/health', { cache: 'no-store' });
        if (r.ok) { API = base; return API; }
      } catch (_) { /* try the next candidate */ }
    }
    return API; // none reachable — the status dot will report it
  }
  resolveApiBase();

  // ---------- state ----------
  const localStorageKey = 'mc_token';
  let token = localStorage.getItem(localStorageKey) || null;
  let me = null;
  let products = [];
  let editingId = null;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function authHeaders(extra) {
    const h = extra || {};
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }
  async function api(path, opts) {
    const o = opts || {};
    o.headers = authHeaders(o.headers);
    if (o.body && !(o.body instanceof FormData) && typeof o.body !== 'string') {
      o.headers['Content-Type'] = 'application/json';
      o.body = JSON.stringify(o.body);
    }
    const res = await fetch(API + path, o);
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (res.status === 401 && token) { doLogout(true); throw new Error(data.error || 'Session expired'); }
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  const money = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const when = (s) => (s ? new Date(String(s).replace(' ', 'T')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  function imgSrc(pathOrKey) {
    if (!pathOrKey) return '';
    if (/^https?:/.test(pathOrKey)) return pathOrKey;
    return API + pathOrKey;
  }

  // ---------- auth ----------
  function doLogout(silent) {
    token = null; me = null;
    localStorage.removeItem(localStorageKey);
    $('gate').style.display = '';
    $('app').style.display = 'none';
    if (!silent) toast('Logged out.');
  }

  function showApp() {
    $('gate').style.display = 'none';
    $('app').style.display = 'block';
    $('whoAmI').textContent = me ? (me.name + ' · ' + me.role) : '';
    loadAll();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginErr').textContent = '';
    const email = $('ad-email').value.trim();
    const password = $('ad-pass').value;
    const btn = $('loginBtn');
    btn.textContent = 'Signing in…'; btn.disabled = true;
    try {
      await resolveApiBase(); // make sure API points at a base that answers
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      if (data.user.role !== 'admin') {
        $('loginErr').textContent = 'This account is not an admin.';
        return;
      }
      token = data.token; me = data.user;
      localStorage.setItem('mc_token', localStorageKey);
      showApp();
      toast('Welcome back, ' + me.name.split(' ')[0] + '!');
    } catch (err) {
      // "Failed to fetch" almost always means the backend isn't running — say so plainly.
      if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
        $('loginErr').textContent = 'Cannot reach the backend. Start it with "npm start" in the mellie-backend folder, then try again.';
      } else {
        $('loginErr').textContent = err.message;
      }
    } finally {
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  });

  $('logoutBtn').addEventListener('click', () => doLogout(false));

  // ---------- tabs ----------
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pane]');
    if (!b) return;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('section.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + b.dataset.pane));
  });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    const btn = document.querySelector('#tabs button[data-pane="' + g.dataset.goto + '"]');
    if (btn) btn.click();
  });

  // ---------- loaders ----------
  async function loadAll() {
    await Promise.all([loadStats(), loadProducts(), loadSlots(), loadRequests(), loadUsers(), loadSubs()]);
  }

  async function loadStats() {
    try {
      const { stats } = await api('/api/admin/stats');
      const cards = [
        { n: stats.pendingCustomCakeRequests, l: 'PENDING REQUESTS' },
        { n: stats.totalCustomCakeRequests, l: 'TOTAL REQUESTS' },
        { n: stats.activeProducts, l: 'ACTIVE PRODUCTS' },
        { n: stats.registeredCustomers, l: 'REGISTERED CUSTOMERS' },
        { n: stats.lowStockProducts, l: 'LOW STOCK (≤5)' },
      ];
      $('statCards').innerHTML = cards.map((c) =>
        '<div class="stat"><div class="n">' + c.n + '</div><div class="l">' + c.l + '</div></div>'
      ).join('');
    } catch (err) { toast(err.message); }
  }

  // ---------- products ----------
  async function loadProducts() {
    try {
      const { products: list } = await api('/api/admin/products');
      products = list;
      $('prodRows').innerHTML = list.map((p) => (
        '<tr>' +
        '<td><img class="thumb" src="' + esc(imgSrc(p.image_url || SLOT_DEFAULTS[p.image_key] || SLOT_DEFAULTS.cake)) + '" alt="">' +
        (p.image_url ? '<span class="pill confirmed" style="margin-left:4px">custom</span>' : '') + '</td>' +
        '<td><b>' + esc(p.name) + '</b><br><span class="muted">' + esc(p.description || '') + '</span></td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + money(p.price) + '</td>' +
        '<td>' + p.stock + '</td>' +
        '<td>' + (p.tag ? '<span class="pill pending">' + esc(p.tag) + '</span>' : '—') + '</td>' +
        '<td>' + (p.is_active ? '<span class="pill confirmed">Active</span>' : '<span class="pill cancelled">Hidden</span>') + '</td>' +
        '<td style="white-space:nowrap">' +
        '<button class="btn sm secondary" data-edit="' + p.id + '">Edit</button> ' +
        '<button class="btn sm secondary" data-toggle="' + p.id + '">' + (p.is_active ? 'Hide' : 'Show') + '</button> ' +
        '<button class="btn sm danger" data-del="' + p.id + '">Delete</button>' +
        '</td></tr>'
      )).join('') || '<tr><td colspan="8" class="muted">No products yet.</td></tr>';
    } catch (err) { toast(err.message); }
  }

  const SLOT_KEYS = ['cake', 'croissant', 'cupcake', 'tart', 'cookie', 'pastry', 'hero', 'story'];
  const SLOT_DEFAULTS = {
    cake: '/images/strawberry_cloud_cake_v2.jpg',
    croissant: '/images/butter_croissant_v2.jpg',
    cupcake: '/images/berry_bliss_cupcake_v2.jpg',
    tart: '/images/chocolate_dream_tart_v2.jpg',
    cookie: '/images/chocolate_chip_cookies_v2.jpg',
    pastry: '/images/danish_pastry_v2.jpg',
    hero: '/images/hero_vintage_cake_v2.jpg',
    story: '/images/design_floral_cake_v2.jpg',
  };

  async function loadSlots() {
    try {
      const { slots, gallery, mode } = await api('/api/uploads/images');
      const urlFor = {};
      (slots || []).forEach((s) => { urlFor[s.slot] = s.url; });

      const slotLabels = {
        cake: 'cake — Strawberry Cloud Cake', croissant: 'croissant — Butter Croissant',
        cupcake: 'cupcake — Berry Bliss Cupcake', tart: 'tart — Chocolate Dream Tart',
        cookie: 'cookie — Choc Chip Cookies', pastry: 'pastry — Cake Slices',
        hero: 'hero — Homepage hero', story: 'story — Story section cake',
      };

      $('slotGrid').innerHTML = SLOT_KEYS.map((slot) => {
        const url = urlFor[slot] || SLOT_DEFAULTS[slot];
        const isUpload = !url.startsWith('/images/') || url.includes('upload_');
        const label = /^https?:/.test(url) ? 'cloud upload ✓' : url.split('/').pop();
        return (
          '<div class="slot-card">' +
          '<img src="' + esc(imgSrc(url) + (url.includes('?') ? '&' : '?') + 't=' + Date.now()) + '" alt="">' +
          '<div class="in"><div class="slot-name">' + esc(slotLabels[slot]) + '</div>' +
          '<div class="fname">' + esc(label) + (isUpload ? ' · click Upload to replace' : '') + '</div>' +
          '<div class="upload-row"><input type="file" accept="image/*" data-slot-file="' + slot + '" id="file-' + slot + '">' +
          '<button class="btn sm" data-slot-upload="' + slot + '">Upload</button></div>' +
          '<p class="ok-msg" id="ok-' + slot + '"></p>' +
          '</div></div>'
        );
      }).join('') + (mode === 'blob' ? '<p class="muted" style="grid-column:1/-1">Cloud storage active — uploads persist across deployments.</p>' : '');

      $('extraGrid').innerHTML = (gallery && gallery.length) ? gallery.map((i) => (
        '<div class="slot-card">' +
        '<img src="' + esc(imgSrc(i.url)) + '" alt="">' +
        '<div class="in"><div class="slot-name">' + esc((i.url.split('/').pop() || 'image').slice(0, 28)) + '</div>' +
        '<div class="fname">' + (i.size ? Math.round(i.size / 1024) + ' KB · ' : '') + (i.modified ? when(i.modified) : 'gallery upload') + '</div>' +
        '<button class="btn sm danger" data-delimg="' + esc(i.url) + '">Delete</button>' +
        '</div></div>'
      )).join('') : '<p class="muted">No extra images uploaded yet. Upload without choosing a slot or product to add gallery images.</p>';
    } catch (err) { toast(err.message); }
  }

  // image uploads (delegated)
  document.addEventListener('click', async (e) => {
    const up = e.target.closest('[data-slot-upload]');
    if (up) {
      const slot = up.dataset.slotUpload;
      const file = $('file-' + slot).files[0];
      if (!file) { toast('Choose an image first.'); return; }
      await uploadFile(file, slot, 'ok-' + slot);
      return;
    }
    const del = e.target.closest('[data-delimg]');
    if (del) {
      if (!confirm('Delete this image?')) return;
      try {
        const name = decodeURIComponent(del.dataset.delimg.split('/').pop());
        await api('/api/uploads/gallery/' + encodeURIComponent(name), { method: 'DELETE' });
        toast('Image deleted.');
        loadSlots();
      } catch (err) { toast(err.message); }
    }
  });

  async function uploadFile(file, slot, okElId) {
    const fd = new FormData();
    fd.append('image', file);
    if (slot) fd.append('slot', slot);
    try {
      await api('/api/uploads/image', { method: 'POST', body: fd });
      toast(slot ? 'Image updated — refresh the storefront to see it.' : 'Image uploaded.');
      if (okElId) { const el = $(okElId); if (el) el.textContent = 'Uploaded ✓'; }
      loadSlots();
    } catch (err) { toast(err.message); }
  }

  // product form
  $('newProdBtn').addEventListener('click', () => openProdForm(null));
  $('prodCancelBtn').addEventListener('click', () => { $('prodFormCard').style.display = 'none'; });

  // ---------- product photo upload ----------
  let pendingPhoto = null; // File picked but not yet uploaded

  function setPhotoUI(product) {
    const preview = $('p-photoPreview');
    const fallback = $('p-photoFallback');
    const removeBtn = $('p-photoRemove');
    const msg = $('p-photoMsg');
    if (msg) msg.textContent = '';
    pendingPhoto = null;
    $('p-photoUpload').disabled = true;
    $('p-photoFile').value = '';
    if (product && product.image_url) {
      preview.src = imgSrc(product.image_url) + (product.image_url.includes('?') ? '&' : '?') + 't=' + Date.now();
      preview.hidden = false;
      fallback.hidden = true;
      removeBtn.hidden = !editingId;
    } else {
      preview.hidden = true;
      preview.removeAttribute('src');
      fallback.hidden = false;
      removeBtn.hidden = true;
    }
  }

  $('p-photoFile').addEventListener('change', () => {
    const f = $('p-photoFile').files[0];
    if (!f) return;
    pendingPhoto = f;
    const preview = $('p-photoPreview');
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
    $('p-photoFallback').hidden = true;
    $('p-photoUpload').disabled = !editingId;
    $('p-photoMsg').textContent = editingId ? '' : 'Save the product first, then upload its photo.';
  });

  $('p-photoUpload').addEventListener('click', async () => {
    if (!editingId || !pendingPhoto) return;
    $('p-photoUpload').disabled = true;
    $('p-photoMsg').textContent = 'Uploading…';
    const fd = new FormData();
    fd.append('image', pendingPhoto);
    fd.append('product_id', String(editingId));
    try {
      await api('/api/uploads/image', { method: 'POST', body: fd });
      $('p-photoMsg').textContent = 'Photo uploaded ✓';
      toast('Product photo updated — the storefront shows it within seconds.');
      pendingPhoto = null;
      $('p-photoUpload').disabled = true;
      $('p-photoRemove').hidden = false;
      loadProducts();
    } catch (err) {
      $('p-photoMsg').textContent = '';
      toast(err.message);
      $('p-photoUpload').disabled = false;
    }
  });

  $('p-photoRemove').addEventListener('click', async () => {
    if (!editingId) return;
    if (!confirm('Remove this product\u2019s custom photo? It will fall back to the catalog slot image.')) return;
    try {
      await api('/api/uploads/product-image/' + editingId, { method: 'DELETE' });
      toast('Custom photo removed.');
      setPhotoUI(null); // clear immediately; loadProducts() refreshes the table
      loadProducts();
    } catch (err) { toast(err.message); }
  });

  function openProdForm(p) {
    editingId = p ? p.id : null;
    $('prodFormTitle').textContent = p ? 'Edit: ' + p.name : 'New product';
    $('p-name').value = p ? p.name : '';
    $('p-price').value = p ? p.price : '';
    $('p-category').value = p ? p.category : 'Cakes';
    $('p-tag').value = p ? p.tag : '';
    $('p-stock').value = p ? p.stock : 10;
    $('p-image_key').value = p ? p.image_key : 'cake';
    $('p-description').value = p ? p.description : '';
    $('prodErr').textContent = '';
    setPhotoUI(p);
    $('prodFormCard').style.display = '';
    $('prodFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('prodForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('prodErr').textContent = '';
    const body = {
      name: $('p-name').value.trim(),
      price: Number($('p-price').value),
      category: $('p-category').value,
      tag: $('p-tag').value,
      stock: Number($('p-stock').value || 0),
      image_key: $('p-image_key').value,
      description: $('p-description').value.trim(),
    };
    try {
      if (editingId) {
        await api('/api/products/' + editingId, { method: 'PUT', body });
        toast('Product saved.');
        loadProducts(); loadStats();
      } else {
        const { product } = await api('/api/products', { method: 'POST', body });
        toast('Product created — now choose its photo.');
        await loadProducts();
        openProdForm(products.find((x) => x.id === product.id) || product);
        loadStats();
        return; // keep the form open in edit mode for the photo upload
      }
      $('prodFormCard').style.display = 'none';
    } catch (err) { $('prodErr').textContent = err.message; }
  });

  document.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const p = products.find((x) => String(x.id) === ed.dataset.edit);
      if (p) openProdForm(p);
      return;
    }
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const p = products.find((x) => String(x.id) === tg.dataset.toggle);
      if (!p) return;
      try {
        await api('/api/products/' + p.id, { method: 'PUT', body: { is_active: p.is_active ? 0 : 1 } });
        toast(p.is_active ? 'Product hidden from storefront.' : 'Product is live again.');
        loadProducts(); loadStats();
      } catch (err) { toast(err.message); }
      return;
    }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const p = products.find((x) => String(x.id) === dl.dataset.del);
      if (!p || !confirm('Delete "' + p.name + '"? It will be hidden from the storefront.')) return;
      try {
        await api('/api/products/' + p.id, { method: 'DELETE' });
        toast('Product deleted.');
        loadProducts(); loadStats();
      } catch (err) { toast(err.message); }
    }
  });

  // ---------- cake requests ----------
  async function loadRequests() {
    try {
      const status = $('reqFilter').value;
      const { requests } = await api('/api/custom-cakes' + (status ? '?status=' + status : ''));
      $('reqGrid').innerHTML = requests.length ? requests.map((r) => (
        '<div class="req-card">' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<div class="meta">' + esc(r.email) + (r.phone ? ' · ' + esc(r.phone) : '') + ' · ' + when(r.created_at) + '</div>' +
        '<span class="pill ' + esc(r.status) + '">' + esc(r.status) + '</span>' +
        '<div class="req-rows">' +
        '<span><b>Occasion</b><br>' + (esc(r.occasion) || '—') + '</span>' +
        '<span><b>Design</b><br>' + (esc(r.design) || '—') + '</span>' +
        '<span><b>Flavor</b><br>' + (esc(r.flavor) || '—') + '</span>' +
        '<span><b>Size</b><br>' + (esc(r.size) || '—') + '</span>' +
        '<span><b>Toppings</b><br>' + (esc(r.toppings) || '—') + '</span>' +
        '<span><b>Budget</b><br>' + (esc(r.budget) || '—') + '</span>' +
        '<span><b>Needed by</b><br>' + (esc(r.needed_by) || '—') + '</span>' +
        '<span><b>Account</b><br>' + (r.user_id ? 'Registered #' + r.user_id : 'Guest') + '</span>' +
        '</div>' +
        (r.details ? '<div class="req-details">' + esc(r.details) + '</div>' : '') +
        '<div class="req-actions">' +
        ['pending', 'confirmed', 'completed', 'cancelled'].map((s) =>
          '<button class="btn sm ' + (s === 'cancelled' ? 'danger' : 'secondary') + '" data-req-status="' + r.id + ':' + s + '"' +
          (s === r.status ? ' disabled style="opacity:.45"' : '') + '>' + s + '</button>'
        ).join('') +
        '<button class="btn sm danger" data-req-del="' + r.id + '">Delete</button>' +
        '</div></div>'
      )).join('') : '<p class="muted">No requests' + (status ? ' with status "' + esc(status) + '"' : '') + '.</p>';
    } catch (err) { toast(err.message); }
  }

  $('reqFilter').addEventListener('change', loadRequests);

  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-req-del]');
    if (del) {
      if (!confirm('Permanently delete this request? This cannot be undone.')) return;
      try {
        await api('/api/custom-cakes/' + del.dataset.reqDel, { method: 'DELETE' });
        toast('Request deleted.');
        loadRequests(); loadStats();
      } catch (err) { toast(err.message); }
      return;
    }
    const b = e.target.closest('[data-req-status]');
    if (!b) return;
    const parts = b.dataset.reqStatus.split(':');
    try {
      await api('/api/custom-cakes/' + parts[0] + '/status', { method: 'PATCH', body: { status: parts[1] } });
      toast('Request marked ' + parts[1] + '.');
      loadRequests(); loadStats();
    } catch (err) { toast(err.message); }
  });

  // ---------- users ----------
  async function loadUsers() {
    try {
      const { users } = await api('/api/users');
      $('userRows').innerHTML = users.map((u) => (
        '<tr>' +
        '<td class="muted">' + u.id + '</td>' +
        '<td><b>' + esc(u.name) + '</b></td>' +
        '<td>' + esc(u.email) + '</td>' +
        '<td><span class="pill ' + esc(u.role) + '">' + esc(u.role) + '</span></td>' +
        '<td class="muted">' + when(u.created_at) + '</td>' +
        '<td>' + (u.role === 'admin'
          ? (me && u.id === me.id ? '<span class="muted">you</span>' : '<button class="btn sm secondary" data-user-role="' + u.id + ':customer">Make customer</button>')
          : '<button class="btn sm secondary" data-user-role="' + u.id + ':admin">Make admin</button>') +
        '</td></tr>'
      )).join('');
    } catch (err) { toast(err.message); }
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-user-role]');
    if (!b) return;
    const parts = b.dataset.userRole.split(':');
    if (!confirm('Change role to "' + parts[1] + '"?')) return;
    try {
      await api('/api/users/' + parts[0] + '/role', { method: 'PATCH', body: { role: parts[1] } });
      toast('Role updated.');
      loadUsers(); loadStats();
    } catch (err) { toast(err.message); }
  });

  // ---------- Sweet List (newsletter subscribers) ----------
  let subsCache = [];
  async function loadSubs() {
    try {
      const { subscribers, total } = await api('/api/newsletter');
      subsCache = subscribers || [];
      $('subsRows').innerHTML = subsCache.length ? subsCache.map((s) => (
        '<tr>' +
        '<td class="muted">' + s.id + '</td>' +
        '<td><b>' + esc(s.email) + '</b></td>' +
        '<td class="muted">' + when(s.created_at) + '</td>' +
        '<td><button class="btn sm danger" data-sub-del="' + s.id + '">Remove</button></td>' +
        '</tr>'
      )).join('') : '<tr><td colspan="4" class="muted">No subscribers yet. Emails from the storefront\'s "Join the Sweet List" form will appear here automatically.</td></tr>';
      const head = document.querySelector('#pane-subs .pane-head h2');
      if (head) head.textContent = 'Sweet List — Newsletter Subscribers (' + total + ')';
    } catch (err) { toast(err.message); }
  }
  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-sub-del]');
    if (!del) return;
    if (!confirm('Remove this email from the Sweet List?')) return;
    try {
      await api('/api/newsletter/' + del.dataset.subDel, { method: 'DELETE' });
      toast('Subscriber removed.');
      loadSubs();
    } catch (err) { toast(err.message); }
  });
  $('subsRefresh').addEventListener('click', loadSubs);
  $('subsExport').addEventListener('click', () => {
    if (!subsCache.length) { toast('Nothing to export yet.'); return; }
    const rows = [['email', 'joined']].concat(subsCache.map((s) => [s.email, s.created_at]));
    const csv = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'sweet-list-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV downloaded.');
  });

  // ---------- boot ----------
  (async function boot() {
    if (!token) return;
    try {
      const d = await api('/api/auth/me');
      me = d.user;
      if (me.role !== 'admin') { doLogout(true); return; }
      showApp();
    } catch (_) {
      doLogout(true);
    }
  })();
})();
