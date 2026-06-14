// Scambia code → token (access + refresh), cifra access_token, restituisce al client
// uno "share token" che la funzione events userà per recuperare i busy.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT = process.env.GOOGLE_REDIRECT_URI || 'https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback';
const ORIGIN = process.env.SITE_ORIGIN || 'https://YOUR-SITE.netlify.app';
const ENC_KEY = process.env.ENC_KEY || 'dev-only-32-chars-replace-me!!!';
const crypto = require('crypto');

// KV Netlify (Netlify Blobs) come store. In dev/altrove: passare a Supabase/Upstash.
const { getStore } = require('@netlify/blobs');

function enc(b64) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENC_KEY.slice(0, 32)), iv);
  const ct = Buffer.concat([cipher.update(b64, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

exports.handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) return { statusCode: 400, body: 'code mancante' };

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }),
  });
  const tok = await r.json();
  if (!tok.access_token) return { statusCode: 400, body: JSON.stringify(tok) };

  const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${tok.access_token}` },
  }).then(r => r.json());

  // Salva refresh+access token cifrati nel KV, indicizzati per email.
  const store = getStore('tokens');
  const payload = JSON.stringify({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (tok.expires_in * 1000),
    email: me.email,
  });
  await store.set(me.email, enc(payload));

  // Restituisci shareToken al client (è la email in chiaro, recuperabile lato server).
  // NB: NON passare token nel URL. Solo email.
  const u = new URL(ORIGIN);
  u.searchParams.set('me', JSON.stringify({ email: me.email, name: me.name, picture: me.picture }));
  return { statusCode: 302, headers: { location: u.toString() } };
};
