// Main Express server — replaces Netlify Functions
// Auth proxy + Google Calendar API gateway + static file server

const path = require('path');
const express = require('express');
const session = require('cookie-session');
const { getDb } = require('./db');
const google = require('./google');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session config — cookie-based, encrypted with same key
app.use(session({
  name: 'cal_session',
  keys: [process.env.SESSION_SECRET || 'change-me-in-production-at-least-32-chars!!!!!!!'],
  maxAge: 24 * 60 * 60 * 1000, // 24h
  secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
  httpOnly: true,
  sameSite: 'lax',
}));

// --- Auth routes ---

// GET /api/auth/login → redirect to Google
app.get('/api/auth/login', (_req, res) => {
  if (!google.CONFIG.clientId) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  }
  const url = google.buildAuthUrl();
  res.redirect(url);
});

// GET /api/auth/google/callback → OAuth callback from Google
app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  const origin = google.CONFIG.siteOrigin || 'http://localhost:3000';

  if (!code) {
    return res.status(400).send('No authorization code received');
  }

  try {
    // Exchange code for tokens
    const tokenData = await google.exchangeCode(code);
    if (!tokenData.access_token) {
      return res.status(400).send(`Google returned no access_token: ${JSON.stringify(tokenData).slice(0, 500)}`);
    }

    // Get user info
    const userInfo = await google.getUserInfo(tokenData.access_token);

    // Store in SQLite
    const db = getDb();
    const expiresAtMs = Date.now() + (tokenData.expires_in || 3599) * 1000;

    db.prepare(`INSERT OR REPLACE INTO users (email, display_name, picture_url, access_token, refresh_token, expires_at, token_resp, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userInfo.email,
      userInfo.name || '',
      userInfo.picture || '',
      google.encrypt(tokenData.access_token),
      google.encrypt(tokenData.refresh_token || ''),
      expiresAtMs,
      JSON.stringify({ ...tokenData }),
      Date.now()
    );

    // Set session
    req.session = { email: userInfo.email };

    // Redirect to frontend with user info
    const u = new URL('/index.html', origin);
    u.searchParams.set('me', JSON.stringify({ email: userInfo.email, name: userInfo.name, picture: userInfo.picture }));
    res.redirect(u.toString());

  } catch (err) {
    console.error('[auth-callback] Error:', err.message);
    res.status(500).send(`Auth error: ${err.message.slice(0, 500)}`);
  }
});

// GET /api/auth/logout → clear session and token
app.get('/api/auth/logout', (req, res) => {
  const email = req.session?.email;
  req.session = null;

  if (email) {
    const db = getDb();
    db.prepare('DELETE FROM users WHERE email = ?').run(email);
  }

  res.redirect('/');
});

// GET /api/auth/me → current user info
app.get('/api/auth/me', (req, res) => {
  const email = req.session?.email;
  if (!email) return res.status(401).json({ error: 'not_authenticated' });

  const db = getDb();
  const user = db.prepare('SELECT email, display_name, picture_url FROM users WHERE email = ?').get(email);
  if (!user) {
    req.session = null;
    return res.status(401).json({ error: 'not_connected' });
  }

  res.json(user);
});

// --- Calendar API routes ---

// GET /api/calendar/busy?emails=a@b.com,c@d.com&timeMin=...&timeMax=...
app.get('/api/calendar/busy', async (req, res) => {
  const email = req.session?.email;
  if (!email) return res.status(401).json({ error: 'not_authenticated' });

  const rawEmails = (req.query.emails || '').split(',').map(s => s.trim()).filter(Boolean);
  const timeMin = req.query.timeMin;
  const timeMax = req.query.timeMax;

  if (!rawEmails.length || !timeMin || !timeMax) {
    return res.status(400).json({ error: 'emails, timeMin and timeMax are required' });
  }

  // Ensure current user is in the list
  if (!rawEmails.includes(email)) rawEmails.unshift(email);

  try {
    const data = await google.getFreeBusy(rawEmails, timeMin, timeMax);
    res.json(data);
  } catch (err) {
    console.error('[calendar/busy] Error:', err.message);
    res.status(502).json({ error: 'google_api_error', detail: err.message.slice(0, 500) });
  }
});

// GET /api/calendar/status → health check of all connected users
app.get('/api/calendar/status', (req, res) => {
  const email = req.session?.email;
  if (!email) return res.status(401).json({ error: 'not_authenticated' });

  const db = getDb();
  const users = db.prepare('SELECT email, expires_at FROM users ORDER BY email').all();

  // Check which tokens are still valid (5min buffer)
  const now = Date.now();
  res.json({
    connected: users.map(u => ({
      email: u.email,
      is_current_user: u.email === email,
      token_valid: u.expires_at > now + 300_000,
      expires_in_ms: Math.max(0, u.expires_at - now),
      updated_at: u.updated_at,
    })),
  });
});

// --- Admin / Demo routes ---

// GET /api/debug-tokens → mostra tutti gli utenti connessi (dev only)
app.get('/api/debug-tokens', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'debug-tokens disabled in production' });
  }
  try {
    const db = getDb();
    const users = db.prepare('SELECT email, display_name, expires_at, updated_at FROM users ORDER BY email').all();
    const result = users.map(u => ({
      ...u,
      token_valid: u.expires_at > Date.now() + 300_000,
      expires_in_min: Math.max(0, Math.round((u.expires_at - Date.now()) / 60_000)),
    }));
    return res.json({ users: result, count: result.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/demo-setup?name=X&email=Y → create a demo user (dev only!)
app.get('/api/demo-setup', async (req, res) => {
  const name = req.query.name || 'Demo';
  const email = req.query.email || 'demo@example.com';

  // Only allow in non-production
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'demo-setup disabled in production' });
  }

  try {
    // Use Google's test token flow or create a placeholder
    const db = getDb();
    const alreadyExists = db.prepare('SELECT email FROM users WHERE email = ?').get(email);
    if (alreadyExists) {
      return res.send(`Demo user ${email} already exists. <a href="/">Go to app</a>`);
    }

    // Create a dummy user for testing — will need real OAuth for actual data
    const expiresAtMs = Date.now() + 86400_000; // 24h
    db.prepare(`INSERT INTO users (email, display_name, picture_url, access_token, refresh_token, expires_at, token_resp, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      email, name, '',
      'DEMO_TOKEN', 'DEMO_REFRESH', expiresAtMs,
      JSON.stringify({ demo: true }), Date.now()
    );

    // Auto-login via session
    req.session = { email };

    res.send(`Demo user created! <a href="/">Go to app</a>`);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// --- Serve frontend static files ---
app.use(express.static(path.join(__dirname, '..', 'public')));

// Catch-all → serve index.html for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- Start server ---
const { init, save, findUser, findUserInfo, upsertUser, deleteUser, listAllUsers } = require('./db');
init().then(() => {
  const demo = db.exec("SELECT email FROM users LIMIT 1");
  if (!demo.length || !demo[0].values?.length) {
    console.log('[db] Nessun utente — vai su /api/demo-setup per creare un account di test');
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n[server] Listening on http://localhost:${PORT}\n`);
  if (!google.CONFIG.clientId) {
    console.warn('[server] WARNING: GOOGLE_CLIENT_ID not set!');
  }
  if (!google.CONFIG.clientSecret) {
    console.warn('[server] WARNING: GOOGLE_CLIENT_SECRET not set!');
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[server] Demo mode — run /api/demo-setup?name=Test&email=test@test.com to create a test account\n`);
  }
});

module.exports = app; // for testing
