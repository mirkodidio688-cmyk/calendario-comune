// Frontend: gestisce OAuth, amici, renderizza griglia 4 settimane.
// PRIVACY: il client vede solo slot busy/free. Mai titoli/dettagli.
const $ = (id) => document.getElementById(id);
const STATE = { me: null, friends: [], weekStart: null };

const FRIENDS_KEY = 'cal_friends_v1';

function loadFriends() {
  try { return JSON.parse(localStorage.getItem(FRIENDS_KEY) || '[]'); } catch { return []; }
}
function saveFriends() { localStorage.setItem(FRIENDS_KEY, JSON.stringify(STATE.friends)); }

function parseHash() {
  const u = new URL(location.href);
  const me = u.searchParams.get('me');
  if (me) {
    sessionStorage.setItem('cal_me', me);
    u.searchParams.delete('me');
    history.replaceState({}, '', u.toString());
  }
}
function loadMe() {
  const m = sessionStorage.getItem('cal_me');
  return m ? JSON.parse(m) : null;
}

async function startLogin() {
  const r = await fetch('/.netlify/functions/auth-start');
  const { url } = await r.json();
  location.href = url;
}

async function fetchBusy(emails, timeMin, timeMax) {
  const r = await fetch(`/.netlify/functions/events?emails=${encodeURIComponent(emails.join(','))}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
  if (!r.ok) throw new Error(`events ${r.status}`);
  return (await r.json()).results || [];
}

function startOfWeek(d) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7;
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - dow);
  return x;
}

function buildGrid(start) {
  const days = 7, weeks = 4;
  const hours = Array.from({ length: 16 }, (_, i) => i + 7);
  const grid = $('grid');
  grid.style.gridTemplateColumns = `60px repeat(${days * weeks}, 1fr)`;
  grid.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'cell time';
  grid.appendChild(corner);
  for (let i = 0; i < days * weeks; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const c = document.createElement('div');
    c.className = 'cell day';
    c.textContent = d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });
    grid.appendChild(c);
  }
  for (const h of hours) {
    const t = document.createElement('div');
    t.className = 'cell time';
    t.textContent = `${String(h).padStart(2, '0')}:00`;
    grid.appendChild(t);
    for (let i = 0; i < days * weeks; i++) {
      const c = document.createElement('div');
      c.className = 'cell';
      c.title = '';
      grid.appendChild(c);
    }
  }
  return { hours, days: days * weeks, start };
}

async function render() {
  if (!STATE.weekStart) STATE.weekStart = startOfWeek(new Date());
  const end = new Date(STATE.weekStart);
  end.setDate(end.getDate() + 28);
  $('range').textContent = `${STATE.weekStart.toLocaleDateString('it-IT')} → ${new Date(end - 1).toLocaleDateString('it-IT')}`;

  const grid = $('grid');
  const meta = buildGrid(STATE.weekStart);
  const allCells = [...grid.querySelectorAll('.cell:not(.time):not(.day)')];

  // Costruisci slot temporali
  const slots = [];
  for (let i = 0; i < allCells.length; i++) {
    const hourIdx = Math.floor(i / meta.days);
    const dayIdx = i % meta.days;
    const s = new Date(meta.start);
    s.setDate(s.getDate() + dayIdx);
    s.setHours(meta.hours[hourIdx], 0, 0, 0);
    const e = new Date(s);
    e.setHours(e.getHours() + 1);
    slots.push({ start: s, end: e, idx: i });
  }
  const now = Date.now();
  for (const s of slots) if (s.end <= now) allCells[s.idx].style.opacity = .3;

  // Recupera busy per [me, ...amici]
  const emails = [STATE.me.email, ...STATE.friends.map(f => f.email)];
  let results = [];
  try { results = await fetchBusy(emails, STATE.weekStart.toISOString(), end.toISOString()); }
  catch (e) { console.warn(e); return; }

  const busy = new Array(slots.length).fill(0);
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push(r.email); continue; }
    for (const b of r.busy) {
      const bs = new Date(b.s), be = new Date(b.e);
      for (const s of slots) {
        if (bs < s.end && be > s.start) busy[s.idx]++;
      }
    }
  }
  const total = results.filter(r => !r.error).length;
  for (let i = 0; i < slots.length; i++) {
    const c = allCells[i];
    if (total === 0) { c.classList.add('mixed'); c.textContent = '?'; continue; }
    if (busy[i] === 0) { c.classList.add('free'); c.textContent = '✓'; c.title = 'Tutti liberi'; }
    else if (busy[i] >= total) { c.classList.add('busy'); c.textContent = '✗'; c.title = 'Tutti occupati'; }
    else { c.classList.add('mixed'); c.textContent = `${total - busy[i]}/${total}`; c.title = `${busy[i]}/${total} occupati`; }
  }
  if (errors.length) $('who').textContent += ` — non collegati: ${errors.join(', ')}`;
}

function renderFriends() {
  const ul = $('friends');
  ul.innerHTML = '';
  for (const f of STATE.friends) {
    const li = document.createElement('li');
    li.textContent = `${f.email} `;
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.onclick = () => { STATE.friends = STATE.friends.filter(x => x.email !== f.email); saveFriends(); renderFriends(); render(); };
    li.appendChild(rm);
    ul.appendChild(li);
  }
  const add = document.createElement('li');
  const inp = document.createElement('input');
  inp.placeholder = 'amico@email (deve aver fatto login)';
  const btn = document.createElement('button');
  btn.textContent = '+';
  btn.onclick = () => {
    const v = inp.value.trim();
    if (v && !STATE.friends.some(f => f.email === v)) {
      STATE.friends.push({ email: v });
      saveFriends();
      renderFriends();
      render();
    }
  };
  add.append(inp, btn);
  ul.appendChild(add);
}

function showApp() {
  $('login').hidden = true;
  $('logout').hidden = false;
  $('who').textContent = `Collegato come ${STATE.me.email} (visibile: solo slot liberi/occupati)`;
  $('app').hidden = false;
  STATE.friends = loadFriends();
  renderFriends();
  render();
}

function showInviteBanner() {
  const u = new URL(location.href);
  if (u.searchParams.get('invited')) {
    const b = document.createElement('div');
    b.id = 'banner';
    b.textContent = 'Qualcuno ti ha invitato a condividere il calendario. Fai login per essere visibile.';
    document.body.insertBefore(b, document.body.firstChild);
    u.searchParams.delete('invited');
    history.replaceState({}, '', u.toString());
  }
}

function copyInvite() {
  const url = `${location.origin}${location.pathname}?invited=1`;
  navigator.clipboard.writeText(url).then(() => {
    $('inviteMsg').textContent = 'Link copiato. Mandalo all’amico.';
    setTimeout(() => { $('inviteMsg').textContent = ''; }, 3000);
  });
}

async function init() {
  parseHash();
  showInviteBanner();
  STATE.me = loadMe();
  if (STATE.me) showApp();
  $('login').onclick = startLogin;
  $('logout').onclick = () => { sessionStorage.clear(); localStorage.removeItem(FRIENDS_KEY); location.reload(); };
  $('prev').onclick = () => { STATE.weekStart.setDate(STATE.weekStart.getDate() - 7); render(); };
  $('next').onclick = () => { STATE.weekStart.setDate(STATE.weekStart.getDate() + 7); render(); };
  $('copyInvite').onclick = copyInvite;
}
init();
