// Restituisce busy/free per un calendario.
// Scope richiesto: calendar.readonly (non serve l'API abilitata separatamente).
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT = process.env.GOOGLE_REDIRECT_URI || 'https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback';
const ORIGIN = process.env.SITE_ORIGIN || 'https://YOUR-SITE.netlify.app';
const ENC_KEY = process.env.ENC_KEY || 'dev-only-32-chars-replace-me!!!'; // 32 byte per AES-256
const crypto = require('crypto');

function enc(b64) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENC_KEY.slice(0, 32)), iv);
  const ct = Buffer.concat([cipher.update(b64, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}
function dec(data) {
  const b = Buffer.from(data, 'base64url');
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const ct = b.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY.slice(0, 32)), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

exports.handler = async () => {
  if (!CLIENT_ID) return { statusCode: 500, body: 'GOOGLE_CLIENT_ID mancante' };
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('prompt', 'consent');
  return { statusCode: 200, body: JSON.stringify({ url: u.toString() }), headers: { 'content-type': 'application/json' } };
};
