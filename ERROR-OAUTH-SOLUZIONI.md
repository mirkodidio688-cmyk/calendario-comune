# Problema OAuth 2.0 di Google — Soluzioni

## Errore visualizzato

```
Non puoi accedere a questa app perché non è conforme alle norme OAuth 2.0 di Google.

Se hai sviluppato tu l'app, registra l'URI di reindirizzamento in Google Cloud Console.
Richiedi dettagli: redirect_uri=https://calendario-comune.netlify.app/.netlify/functions/auth-callback flowName=GeneralOAuthFlow
```

## Perché succede

Hai creato un progetto su Google Cloud Console con OAuth 2.0 → User type **External** → stato **Testing** (non verified).
Google permette solo le email che hai aggiunto come **"Test users"**. Se l'account che stai usando per il login
**non è in quella lista**, vedi esattamente questo errore.

---

## Soluzione A — Aggiungi la tua email come test user (veloce)

1. **Google Cloud Console** → APIs & Services → **OAuth consent screen**
2. Vai su **"Test users"** → **"Add users"**
3. Inserisci **tutte le email** che devono fare il login (le tue + dei tuoi amici)
4. Salva → riprova

## Soluzione B — Pubblicare l'app (per produzione, più lungo)

1. Su **OAuth consent screen** → **"App status"** → **"Publish app"** (conferma)
2. Google richiede: **dominio verificato**, privacy policy, security review
3. Tempo: giorni/settimane → non immediato

## Soluzione C — User type "Internal" (se hai Google Workspace)

1. Se hai un account Workspace (azienda/scuola), cambia user type su **Internal**
2. Tutti nel dominio possono usare l'app senza essere test users
3. Richiede che il dominio sia gestito con Workspace

---

## Checklist rapida per evitare problemi

| Problema | Controllo |
|---|---|
| Redirect URI non corrisponde | Google Cloud: `https://calendario-comune.netlify.app/.netlify/functions/auth-callback` **esattamente** come su Netlify env vars |
| Scope mancante | Devono esserci: `freebusy`, `userinfo.email`, `userinfo.profile` |
| Email non in test users | Google Cloud → OAuth consent screen → Test users → la tua email deve esserci |
| Dopo il deploy Netlify | Ricordati di aggiungere il redirect URI **netlify** (non solo localhost) su Google Cloud |

---

## Altro errore possibile: redirect_uri_mismatch

Se Google restituisce **"redirect_uri_mismatch"**:

1. Il redirect URI su **Google Cloud Console → Credentials → Authorized redirect URIs**
   DEVE corrispondere ESATTAMENTE a quello nelle **Environment Variables di Netlify**.
2. Su Netlify, vai su Site settings → Environment variables → controlla `GOOGLE_REDIRECT_URI`.
3. Deve essere: `https://calendario-comune.netlify.app/.netlify/functions/auth-callback`
4. Copialo e incollalo su Google Cloud Console — **nessuna differenza** di carattere.

---

## Errore: "Access blocked: This app's request is invalid"

Significa che manca almeno uno scope richiesto su Google Cloud Console.

1. Vai su **OAuth consent screen → App domain**
2. Controlla che gli scope richiesti includano:
   - `https://www.googleapis.com/auth/freebusy`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
3. Se l'app è in test mode, aggiungi la tua email tra i **Test users**.
