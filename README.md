# Calendar Site

Sito statico (Netlify) + Google Calendar per evidenziare slot dove tutti liberi.

## Privacy by design

- Scope OAuth: **`freebusy`** (non `calendar.readonly`).
- Endpoint `events` chiama `freebusy.query`: ritorna solo **slot occupati**, **mai titoli/dettagli** eventi.
- Token (access + refresh) **mai** passati al client. Salvati cifrati (AES-256-GCM) in Netlify Blobs, indicizzati per email.
- Client conosce solo la propria email + lista amici (email). Per leggere busy amico, la funzione `events` usa il token cifrato lato server.

## Setup

1. Google Cloud Console → progetto → abilita **Calendar API**.
2. Crea **OAuth 2.0 Client ID** (Web application).
   - Authorized redirect URI: `https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback`
3. Su Netlify → Site settings → Environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (es. `https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback`)
   - `SITE_ORIGIN` (es. `https://YOUR-SITE.netlify.app`)
   - `ENC_KEY` — 32+ caratteri random (`openssl rand -base64 32`). Usato per cifrare token in KV.
4. Deploy: `netlify deploy --prod` o collega repo GitHub.

## Sviluppo locale

```
cd dify/calendar-site
npm install
netlify dev
```

## Flusso

1. Utente apre sito → "Connetti Google".
2. OAuth Google → callback → token cifrati in Netlify Blobs.
3. Frontend aggiunge amici per email (deve aver fatto login anche lui almeno una volta).
4. Frontend chiede `/.netlify/functions/events?emails=a@x,b@y&timeMin=...&timeMax=...`.
5. Funzione recupera token cifrati, chiama `freebusy.query` per ciascuno, ritorna solo `{start, end}` slot occupati.
6. Frontend renderizza griglia: verde = tutti liberi, giallo = parzialmente, rosso = tutti occupati.

## Note

- **Refresh token**: gestito in `events.js`, access scaduto → usa refresh per ottenere nuovo access, risalva cifrato.
- **Sicurezza**:
  - imposta `ENC_KEY` robusta in produzione.
  - HTTPS obbligatorio.
  - KV Netlify Blobs ha scope per deploy; non accessibile da client.
- **Costi**: Netlify Blobs gratis fino a 1GB. Funzioni gratuite 125k req/mese.
