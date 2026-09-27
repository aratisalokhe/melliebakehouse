const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function getTokenFromHeader(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

// Attaches req.user if a valid token is present; does not block the request.
function attachUser(req, _res, next) {
  const token = getTokenFromHeader(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      req.user = null;
    }
  }
  next();
}

// Blocks the request unless a valid token is present.
function requireAuth(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}

// Blocks the request unless the signed-in user is an admin.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

module.exports = { attachUser, requireAuth, requireAdmin, JWT_SECRET };
