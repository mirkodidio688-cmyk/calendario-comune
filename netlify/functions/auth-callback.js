// netlify/functions/auth-callback.js (Versione corretta e stabile)
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ORIGIN = process.env.SITE_ORIGIN || 'https://calendario-comune.netlify.app';

// Leggiamo ENC_KEY correttamente. Se non c'è, generane una (per test locale)
const KEY_SOURCE = process.env.ENC_KEY;
const ENCRYPTION_KEY = KEY_SOURCE
  ? Buffer.from(KEY_SOURCE).slice(0, 32) // Usa il secret di produzione salvato in Netlify Settings
  : crypto.randomBytes(32);               // Chiave temporanea per test locale/dev

// ... (non devi modificare più nulla sotto riguardo alle variabili) ...

// 2. La funzione che gestisce Blobs senza crashare (giù nel file)
async function storeToken(email, encrypted) {
  if (!email) email = 'anon';
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('tokens');
    await store.set(email, encrypted);
    return { method: 'blobs', email };
  } catch (e) {
    // Questo blocco cattura l'errore "MissingBlobsEnvironmentError"
    // e permette il fallback sicuro ai cookie.
    console.warn('⚠️ Blobs non attivo, uso cookie.');
    return null;
  }
}

// --- Callback OAuth ---
exports.handler = async (event) => {
  const code = event.queryStringParameters?.code;
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