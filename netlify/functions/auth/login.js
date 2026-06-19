// Wrapper: mappa /api/auth/login → flusso OAuth (redirect diretto come Express)
const crypto = require('crypto');

const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback';

if (!CLIENT_ID) {
  console.error('[auth/login] GOOGLE_CLIENT_ID mancante. Imposta l\'env var su Netlify.');
}

exports.handler = async () => {
  if (!CLIENT_ID) {
    return { statusCode: 500, body: 'GOOGLE_CLIENT_ID mancante', headers: { 'content-type': 'application/json' } };
  }

  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');

  return { statusCode: 302, headers: { location: u.toString() } };
};
