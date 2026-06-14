# Guida deploy passo-passo

Tempo stimato: 15-20 minuti.

## 1. Google Cloud Console (5 min)

1. Vai su https://console.cloud.google.com
2. Crea nuovo progetto → nome "calendar-site" → Crea.
3. Menu hamburger → **APIs & Services** → **Library** → cerca "Google Calendar API" → **Enable**.
4. Menu → **APIs & Services** → **OAuth consent screen**:
   - User type: **External**
   - App name: `Calendar Site`
   - User support email: tua email
   - Developer contact: tua email
   - **Save and Continue**
   - Scopes: **Add or remove scopes** → cerca `auth/freebusy` → seleziona `https://www.googleapis.com/auth/freebusy` (e anche `openid`, `email`, `profile` per il profilo) → Save.
   - **Test users**: aggiungi le email tue e dei tuoi amici (per ora siete in "test mode" finché non pubblichi app)
   - Save.
5. Menu → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**:
   - Application type: **Web application**
   - Name: `calendar-site`
   - Authorized redirect URIs: per ora metti `http://localhost:8888/.netlify/functions/auth-callback` (lo aggiungerai dopo per produzione).
   - **Create**.
6. Annota:
   - **Client ID** (finisce con `.apps.googleusercontent.com`)
   - **Client secret**

⚠️ **Ricorda**: dopo aver fatto il primo deploy, torna qui e aggiungi anche `https://TUO-SITO.netlify.app/.netlify/functions/auth-callback` agli Authorized redirect URIs.

## 2. Repository Git (3 min)

Opzione A — GitHub (consigliato per Netlify):
```bash
cd dify/calendar-site
git init
git add .
git commit -m "init calendar site"
gh repo create calendar-site --public --source=. --push
```
(Opzione B: crea repo su github.com manualmente e fai push.)

## 3. Netlify (3 min)

1. Vai su https://app.netlify.com → **Add new site** → **Import an existing project**.
2. Connetti GitHub → seleziona repo `calendar-site`.
3. Configurazione build (Netlify la rileva da `netlify.toml`):
   - Build command: lascia vuoto (non serve, è sito statico)
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. **Add environment variables** (Site settings → Environment variables):
   - `GOOGLE_CLIENT_ID` = il Client ID di prima
   - `GOOGLE_CLIENT_SECRET` = il Client secret di prima
   - `GOOGLE_REDIRECT_URI` = per ora `http://localhost:8888/.netlify/functions/auth-callback` (lo aggiornerai dopo)
   - `SITE_ORIGIN` = per ora `http://localhost:8888`
   - `ENC_KEY` = genera con: `openssl rand -base64 32` (incolla output)
5. **Deploy site**. Dura 30 secondi. URL tipo `https://random-name-123.netlify.app`.

## 4. Aggiorna Google OAuth (2 min)

Torna su Google Cloud Console → Credentials → modifica OAuth Client:
- Aggiungi redirect URI: `https://random-name-123.netlify.app/.netlify/functions/auth-callback`
- Save.

Torna su Netlify → Site settings → Environment variables:
- `GOOGLE_REDIRECT_URI` = `https://random-name-123.netlify.app/.netlify/functions/auth-callback`
- `SITE_ORIGIN` = `https://random-name-123.netlify.app`
- Salva → **Trigger deploy** (Deploys → Trigger deploy → Deploy site).

## 5. Test (2 min)

1. Apri `https://random-name-123.netlify.app`
2. Clicca **Connetti Google** → scegli account → consenti.
3. Torna alla home → vedi griglia 4 settimane (tutta vuota/verde la prima volta).
4. Clicca **Copia link invito** → invialo a un amico.
5. Amico apre link → banner → login.
6. Torni sul tuo → aggiungi sua email in lista amici → griglia mostra slot condivisi.

## 6. Dominio custom (opzionale, 5 min)

Netlify → Domain settings → Add custom domain → segui istruzioni DNS. Poi aggiorna `SITE_ORIGIN` e OAuth redirect URI con il nuovo dominio.

## Troubleshooting

- **"redirect_uri_mismatch"**: OAuth Client non ha il redirect URI. Aggiungi esattamente quello in uso.
- **"Access blocked: This app's request is invalid"**: OAuth consent screen non configurato o scope mancante.
- **Griglia tutta gialla `?`**: amico non ha fatto login, o `ENC_KEY` cambiata dopo aver salvato token (i vecchi token non sono più decifrabili, rifare login).
- **"This app is not verified"**: normale in test mode. Clicca "Advanced" → "Go to ...". Quando pubblichi serve verifica Google (richiede dominio verificato).
