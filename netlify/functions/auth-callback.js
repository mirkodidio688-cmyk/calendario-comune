const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ORIGIN = process.env.SITE_ORIGIN || 'https://calendario-comune.netlify.app';

// Genera una chiave 32-byte se mancante (sicuro)
function getEncKey() {
  return process.env.ENC_KEY ? Buffer.from(process.env.ENC_KEY).slice(0, 32) : crypto.randomBytes(32);
}
const ENC_KEY = getEncKey(); // Valida all'avvio del container

// --- Funzioni di crittografia ---
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url'); // base64url per sicurezza cookie
}

// --- Storage sicuro (Blobs con fallback automatico) ---
async function storeToken(email, encrypted) {
  if (!email) email = 'anon'; // Blobs richiede chiave stringa
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('tokens'); // Nome del "Bucket" Blobs: tokens
    await store.set(email, encrypted);
    return { method: 'blobs', email };
  } catch (e) {
    // Se Blobs non è configurato (es. errore env var), torniamo null per usare il cookie
    console.warn('⚠️ Netlify Blobs non disponibile (fallback sicuro su cookie): ', e.message);
    return null; 
  }
}

// --- Callback OAuth ---
exports.handler = async (event) => {
  const code = event.queryStringParameters?.code;
  const REDIRECT = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8888/.netlify/functions/auth-callback'; // Definizione locale

  if (!code || !CLIENT_ID) {
    return { statusCode: 400, body: 'Codice mancante o variabili GOOGLE non configurate.' };
  }

  // 1. Scambio codice -> token Google
  const r = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  }).then(r => r.json());

  if (!r.access_token) return { statusCode: 400, body: JSON.stringify(r) };

  // 2. Verifica identità utente (Google)
  const me = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${r.access_token}` } }).then(r => r.json());
  
  // 4. Cifra i token e prova il salvataggio
  const payload = JSON.stringify({ access_token: r.access_token, refresh_token: r.refresh_token, expires_at: Date.now() + (r.expires_in * 1000) });
  const encrypted = enc(payload);

  // 5. Tenta Blobs; se fallisce torniamo { method: 'cookie' } per usare il Set-Cookie
  const storageInfo = await storeToken(me.email, encrypted); 

  // 6. Redirect verso l'app (passando email e pic via URL safe)
  const u = new URL(ORIGIN);
  u.searchParams.set('me', JSON.stringify({ email: me.email, name: me.name, picture: me.picture }));

  // Preparo i headers
  const headers = { location: u.toString() };

  if (!storageInfo) {
    // Fallback cookie se Blobs non va
    headers['Set-Cookie'] = `auth=${encodeURIComponent(encrypted)}; Path=/; Max-Age=2592000; SameSite=Lax`;
  } else {
    // Se Blobs ha funzionato e salvato la chiave crittografata, possiamo usare 
    // un cookie minimo di sessione per recuperare l'accesso al "bucket tokens"
    headers['Set-Cookie'] = `cal_token_key=${me.email}; Path=/; Max-Age=2592000; SameSite=Lax`;
  }

  return { statusCode: 302, headers };
};