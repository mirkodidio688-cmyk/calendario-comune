// Google API client — token refresh, freeBusy, all via plain HTTP (no googleapis SDK needed)

const crypto = require('crypto');

// --- Encryption helpers ---
function getEncKey() {
  const env = process.env.TOKEN_ENC_KEY;
  if (env && Buffer.byteLength(env, 'utf8') >= 32) return Buffer.from(env.slice(0, 32));
  // Fallback: generate once per process restart
  console.warn('[google] TOKEN_ENC_KEY too short — generating ephemeral key. Tokens will be lost on restart!');
  return crypto.randomBytes(32);
}

const ENC_KEY = getEncKey();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

function decrypt(b64) {
  try {
    const b = Buffer.from(b64, 'base64url');
    const iv = b.subarray(0, 12);
    const tag = b.subarray(12, 28);
    const ct = b.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// --- Google OAuth / API calls ---
const CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
  siteOrigin: process.env.SITE_ORIGIN || 'http://localhost:3000',
};

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

function buildAuthUrl() {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CONFIG.clientId);
  u.searchParams.set('redirect_uri', CONFIG.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

async function exchangeCode(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      redirect_uri: CONFIG.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Token exchange failed (${r.status}): ${text.slice(0, 500)}`);
  }

  return await r.json();
}

async function getUserInfo(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`userinfo (${r.status})`);
  return await r.json();
}

async function refreshAccessToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Refresh failed (${r.status}): ${text.slice(0, 500)}`);
  }

  return await r.json();
}

async function getFreeBusy(emails, timeMin, timeMax) {
  // Get all stored users' tokens, refresh any expired ones
  const { getDb } = require('./db');
  const db = getDb();

  const results = [];

  for (const email of emails) {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      results.push({ email, error: 'not_connected' });
      continue;
    }

    let accessToken = user.access_token;

    // Check expiry and refresh if needed (5min buffer)
    const expiresAtMs = user.expires_at;
    const now = Date.now();
    if (expiresAtMs - now < 300_000) {
      try {
        // Try to read current refresh token from DB in case it was updated externally
        const rawRefresh = decrypt(user.refresh_token);
        const refreshed = await refreshAccessToken(rawRefresh);

        if (refreshed.access_token) {
          accessToken = refreshed.access_token;
          const newRefresh = refreshed.refresh_token || rawRefresh;
          const nowMs = Date.now();

          // Update in DB
          db.prepare(`UPDATE users SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ? WHERE email = ?`).run(
            encrypt(accessToken),
            encrypt(newRefresh),
            nowMs + (refreshed.expires_in || 3599) * 1000,
            nowMs,
            email
          );
        } else {
          throw new Error('No access_token in refresh response');
        }
      } catch (err) {
        console.error(`[google] Token refresh failed for ${email}:`, err.message);
        results.push({ email, error: 'token_expired', error_detail: 'refresh_failed' });
        continue;
      }
    }

    // Call freeBusy API
    const u = new URL('https://www.googleapis.com/calendar/v3/freeBusy');
    u.searchParams.set('timeMin', timeMin);
    u.searchParams.set('timeMax', timeMax);
    u.searchParams.set('items', JSON.stringify([{ id: 'primary' }]));

    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        results.push({ email, error: String(data.error?.message || `calendar_api_${r.status}`) });
        continue;
      }

      const data = await r.json();
      const busySlots = data.calendars?.primary?.busy || [];
      results.push({
        email,
        busy: busySlots.map(s => ({ s: s.start, e: s.end })),
      });
    } catch (err) {
      console.error(`[google] freeBusy for ${email}:`, err.message);
      results.push({ email, error: 'freebusy_request_failed' });
    }
  }

  return { results };
}

module.exports = {
  CONFIG,
  SCOPES,
  buildAuthUrl,
  exchangeCode,
  getUserInfo,
  refreshAccessToken,
  getFreeBusy,
};
