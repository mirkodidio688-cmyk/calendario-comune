// Legge busy/free per qualsiasi utente registrato. Usa freebusy.query (no titoli eventi).
// Gestisce refresh token se access scaduto. Mai restituisce dettagli.
const ENC_KEY = process.env.ENC_KEY || 'dev-only-32-chars-replace-me!!!';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function dec(data) {
  const b = Buffer.from(data, 'base64url');
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const ct = b.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY.slice(0, 32)), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENC_KEY.slice(0, 32)), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

async function getValidToken(store, email) {
  const blob = await store.get(email);
  if (!blob) return null;
  let data = JSON.parse(dec(blob));
  if (data.expires_at > Date.now() + 60_000) return data.access_token;
  if (!data.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: data.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const t = await r.json();
  if (!t.access_token) return null;
  data = { ...data, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  await store.set(email, enc(JSON.stringify(data)));
  return data.access_token;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const emails = (q.emails || '').split(',').map(s => s.trim()).filter(Boolean);
  const timeMin = q.timeMin, timeMax = q.timeMax;
  if (!emails.length || !timeMin || !timeMax) return { statusCode: 400, body: 'emails/timeMin/timeMax richiesti' };

  const store = getStore('tokens');
  const out = [];
  for (const email of emails) {
    const tok = await getValidToken(store, email);
    if (!tok) { out.push({ email, error: 'not_connected' }); continue; }
    const u = new URL('https://www.googleapis.com/calendar/v3/freeBusy');
    u.searchParams.set('timeMin', timeMin);
    u.searchParams.set('timeMax', timeMax);
    u.searchParams.set('items', JSON.stringify([{ id: 'primary' }]));
    const r = await fetch(u, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    });
    const data = await r.json();
    if (!r.ok) { out.push({ email, error: data }); continue; }
    const busy = data.calendars?.primary?.busy || [];
    out.push({ email, busy: busy.map(b => ({ s: b.start, e: b.end })) });
  }
  return { statusCode: 200, body: JSON.stringify({ results: out }), headers: { 'content-type': 'application/json' } };
};
