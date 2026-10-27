'use strict';
// ---- Config (publishable key is safe in the browser; never put service_role here) ----
const CFG = {
  brand: 'MUSIC ROOM',
  url: 'https://aotzfaaqyvzlusvmmwsn.supabase.co',
  key: 'sb_publishable_EG34lhzcB97-za0S7oQKJQ_B2C5nS5j',
  maxBytes: 50 * 1024 * 1024,
};
const sb = supabase.createClient(CFG.url, CFG.key);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => (isFinite(t) && t > 0 ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00');
document.querySelectorAll('[data-brand]').forEach((e) => (e.textContent = CFG.brand));

const S = { user: null, tracks: [], favs: new Set(), pls: [], pt: [], recent: [], view: 'all', q: '', sort: 'created_at',
  queue: [], i: -1, rep: 'off', shuf: false, counted: false, fails: 0, pending: null };
const A = new Audio(); A.preload = 'metadata';
const byId = (id) => S.tracks.find((t) => t.id === id);
const cur = () => byId(S.queue[S.i]);
let tt;
function toast(m) { const e = $('#toast'); e.textContent = m; e.hidden = false; clearTimeout(tt); tt = setTimeout(() => (e.hidden = true), 3500); }
const fail = (e, m) => { console.error(e); toast(m); };

// ---- Auth ----
let mode = 'login';
function setMode(m) {
  mode = m;
  $('#authTitle').textContent = { login: 'Log in', signup: 'Create account', reset: 'Reset password' }[m];
  $('#authBtn').textContent = { login: 'Log in', signup: 'Sign up', reset: 'Send reset link' }[m];
  $('#pwRow').hidden = m === 'reset'; $('#authErr').textContent = '';
  $('#toSignup').textContent = m === 'login' ? 'Create account' : 'Back to log in';
}
$('#toSignup').onclick = () => setMode(mode === 'login' ? 'signup' : 'login');
$('#toReset').onclick = () => setMode('reset');
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim(), password = $('#pw').value, err = $('#authErr');
  if (!/^\S+@\S+\.\S+$/.test(email)) return (err.textContent = 'Enter a valid email address.');
  if (mode !== 'reset' && password.length < 6) return (err.textContent = 'Password needs at least 6 characters.');
  err.textContent = '';
  const redirect = location.origin + location.pathname;
  let r;
  if (mode === 'login') r = await sb.auth.signInWithPassword({ email, password });
  else if (mode === 'signup') r = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
  else r = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
  if (r.error) return (err.textContent = r.error.message);
  if (mode === 'signup' && !r.data.session) toast('Check your email to confirm your account.');
  if (mode === 'reset') { toast('Reset link sent. Check your email.'); setMode('login'); }
};
$('#logout').onclick = async () => { A.pause(); A.removeAttribute('src'); await sb.auth.signOut(); };

let booted = null;
sb.auth.onAuthStateChange((ev, s) => {
  if (ev === 'PASSWORD_RECOVERY') {
    const p = prompt('Enter a new password (min 6 characters):');
    if (p && p.length >= 6) sb.auth.updateUser({ password: p }).then((r) => toast(r.error ? r.error.message : 'Password updated.'));
  }
  const uid = s?.user?.id || null;
  if (uid === booted) return;
  booted = uid; S.user = s?.user || null;
  $('#auth').hidden = !!S.user; $('#app').hidden = !S.user;
  if (S.user) setTimeout(boot, 0);
  else { S.tracks = []; S.queue = []; S.i = -1; renderPlayer(); }
});

// ---- Data ----
async function boot() { await loadAll(); go('all'); }
async function loadAll() {
  const [t, f, p, pt, h] = await Promise.all([
    sb.from('tracks').select('*').order('created_at', { ascending: false }),
    sb.from('favorites').select('track_id'),
    sb.from('playlists').select('*').order('created_at'),
    sb.from('playlist_tracks').select('*').order('position'),
    sb.from('play_history').select('track_id').order('played_at', { ascending: false }).limit(100),
  ]);
  const e = [t, f, p, pt, h].find((x) => x.error);
  if (e) return fail(e.error, 'Could not load your library. Did you run the SQL migration?');
  S.tracks = t.data; S.favs = new Set(f.data.map((x) => x.track_id)); S.pls = p.data; S.pt = pt.data;
  S.recent = [...new Set(h.data.map((x) => x.track_id))];
}

// ---- Views ----
function go(v) { S.view = v; S.q = ''; render(); renderNav(); }
function renderNav() {
  document.querySelectorAll('.nav[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  $('#plNav').innerHTML = S.pls.map((p) => `<button class="nav ${S.view === 'pl:' + p.id ? 'on' : ''}" data-view="pl:${p.id}">${esc(p.name)}</button>`).join('');
}
document.addEventListener('click', (e) => { const b = e.target.closest('.nav[data-view]'); if (b) go(b.dataset.view); });

function listFor() {
  let l;
  if (S.view === 'fav') l = S.tracks.filter((t) => S.favs.has(t.id));
  else if (S.view === 'recent') l = S.recent.map(byId).filter(Boolean);
  else if (S.view.startsWith('pl:')) l = S.pt.filter((x) => x.playlist_id === S.view.slice(3)).sort((a, b) => a.position - b.position).map((x) => byId(x.track_id)).filter(Boolean);
  else l = [...S.tracks];
  const q = S.q.toLowerCase();
  if (q) l = l.filter((t) => [t.title, t.artist, t.album].some((v) => (v || '').toLowerCase().includes(q)));
  if (S.view === 'all' || S.view === 'fav') {
    const k = S.sort;
    l.sort((a, b) => k === 'created_at' ? b.created_at.localeCompare(a.created_at) : k === 'duration_seconds' ? (a[k] || 0) - (b[k] || 0) : (a[k] || '').localeCompare(b[k] || ''));
  }
  return l;
}
function render() {
  const pl = S.pls.find((p) => 'pl:' + p.id === S.view);
  const title = pl ? pl.name : { all: 'All songs', fav: 'Favorites', recent: 'Recently played' }[S.view];
  const l = listFor();
  const total = l.reduce((s, t) => s + (t.duration_seconds || 0), 0);
  const empty = { all: 'No songs yet. Upload your first track.', fav: 'No favorites yet. Tap ♡ on a song.', recent: 'Nothing played yet.' }[S.view] || 'This playlist is empty. Add songs from All songs.';
  $('#main').innerHTML = `<div class="bar"><h1>${esc(title)}</h1>
    <input id="q" type="search" placeholder="Search title, artist, album" aria-label="Search" value="${esc(S.q)}">
    <select id="sort" aria-label="Sort"><option value="created_at">Date added</option><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option><option value="duration_seconds">Duration</option></select>
    <button class="btn" id="upBtn">Upload</button></div>
    <div class="bar"><button class="btn ghost" data-a="playall" ${l.length ? '' : 'disabled'}>Play all</button>
    <button class="btn ghost" data-a="shufall" ${l.length ? '' : 'disabled'}>Shuffle play</button>
    ${pl ? '<button class="btn ghost" data-a="renpl">Rename</button><button class="btn ghost" data-a="delpl">Delete playlist</button>' : ''}</div>
    <div class="stats">${l.length} songs · ${Math.round(total / 60)} min</div>
    ${l.length ? l.map((t) => row(t)).join('') : `<div class="empty">${S.q ? 'No matches.' : empty}</div>`}`;
  $('#sort').value = S.sort; $('#sort').hidden = !(S.view === 'all' || S.view === 'fav');
  $('#sort').onchange = (e) => { S.sort = e.target.value; render(); };
  const q = $('#q'); q.oninput = (e) => { S.q = e.target.value; const p = e.target.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
  $('#upBtn').onclick = () => $('#up').showModal();
}
function row(t) {
  const on = S.queue[S.i] === t.id, inPl = S.view.startsWith('pl:');
  return `<div class="row ${on ? 'now' : ''}" data-id="${t.id}">
   <button class="icon" data-a="play" aria-label="Play ${esc(t.title)}">${on && !A.paused ? '⏸' : '▶'}</button>
   <div class="t"><b>${esc(t.title)}</b><small>${esc(t.artist || 'Unknown artist')}</small></div>
   <div class="alb dim">${esc(t.album || '')}</div><div class="dim">${fmt(t.duration_seconds)}</div>
   <div><button class="icon ${S.favs.has(t.id) ? 'on' : ''}" data-a="fav" aria-label="Favorite">${S.favs.has(t.id) ? '♥' : '♡'}</button>
   <button class="icon" data-a="addpl" aria-label="Add to playlist">＋</button>
   ${inPl ? '<button class="icon" data-a="rmpl" aria-label="Remove from playlist">⊖</button>' : ''}
   <button class="icon" data-a="edit" aria-label="Edit">✎</button><button class="icon" data-a="del" aria-label="Delete">🗑</button></div></div>`;
}

$('#main').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = b.closest('.row')?.dataset.id, t = id && byId(id), l = listFor();
  if (a === 'play') { if (S.queue[S.i] === id) return togglePlay(); startQueue(l, l.findIndex((x) => x.id === id)); }
  else if (a === 'playall') startQueue(l, 0);
  else if (a === 'shufall') { S.shuf = true; startQueue(l, Math.floor(Math.random() * l.length)); }
  else if (a === 'fav') {
    const on = S.favs.has(id);
    const r = on ? await sb.from('favorites').delete().eq('track_id', id) : await sb.from('favorites').insert({ track_id: id });
    if (r.error) return fail(r.error, 'Could not update favorites.');
    on ? S.favs.delete(id) : S.favs.add(id); render();
  } else if (a === 'addpl') { S.pending = id; openPick(); }
  else if (a === 'rmpl') {
    const r = await sb.from('playlist_tracks').delete().eq('playlist_id', S.view.slice(3)).eq('track_id', id);
    if (r.error) return fail(r.error, 'Could not remove song.');
    S.pt = S.pt.filter((x) => !(x.playlist_id === S.view.slice(3) && x.track_id === id)); render();
  } else if (a === 'edit') {
    const title = prompt('Title', t.title); if (title === null) return;
    const artist = prompt('Artist', t.artist || ''); if (artist === null) return;
    const album = prompt('Album', t.album || ''); if (album === null) return;
    const genre = prompt('Genre', t.genre || ''); if (genre === null) return;
    if (!title.trim()) return toast('Title is required.');
    const r = await sb.from('tracks').update({ title: title.trim(), artist: artist.trim() || null, album: album.trim() || null, genre: genre.trim() || null }).eq('id', id).select().single();
    if (r.error) return fail(r.error, 'Could not save changes.');
    Object.assign(t, r.data); render(); renderPlayer();
  } else if (a === 'del') {
    if (!confirm(`Delete "${t.title}"? This removes the file and cannot be undone.`)) return;
    const s = await sb.storage.from('music-files').remove([t.storage_path]);
    if (s.error) return fail(s.error, 'Could not delete the file.');
    const r = await sb.from('tracks').delete().eq('id', id);
    if (r.error) return fail(r.error, 'File removed, but the record could not be deleted.');
    if (S.queue[S.i] === id) { A.pause(); S.queue = []; S.i = -1; renderPlayer(); }
    await loadAll(); render(); toast('Song deleted.');
  } else if (a === 'renpl') {
    const p = S.pls.find((x) => 'pl:' + x.id === S.view), name = prompt('Playlist name', p.name);
    if (!name?.trim()) return;
    const r = await sb.from('playlists').update({ name: name.trim() }).eq('id', p.id);
    if (r.error) return fail(r.error, 'Could not rename.'); p.name = name.trim(); render(); renderNav();
  } else if (a === 'delpl') {
    const p = S.pls.find((x) => 'pl:' + x.id === S.view);
    if (!confirm(`Delete playlist "${p.name}"? Songs stay in your library.`)) return;
    const r = await sb.from('playlists').delete().eq('id', p.id);
    if (r.error) return fail(r.error, 'Could not delete.'); await loadAll(); go('all');
  }
});

// ---- Playlists ----
$('#newPl').onclick = async () => {
  const name = prompt('Playlist name'); if (!name?.trim()) return;
  const r = await sb.from('playlists').insert({ name: name.trim() }).select().single();
  if (r.error) return fail(r.error, 'Could not create playlist.');
  S.pls.push(r.data); go('pl:' + r.data.id);
};
function openPick() {
  $('#plPickList').innerHTML = S.pls.length ? S.pls.map((p) => `<button class="nav" data-p="${p.id}">${esc(p.name)}</button>`).join('') : '<p class="dim">Create a playlist first (＋ in the sidebar).</p>';
  $('#plPick').showModal();
}
$('#plPickClose').onclick = () => $('#plPick').close();
$('#plPickList').onclick = async (e) => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  const pid = b.dataset.p;
  if (S.pt.some((x) => x.playlist_id === pid && x.track_id === S.pending)) { $('#plPick').close(); return toast('Already in that playlist.'); }
  const pos = S.pt.filter((x) => x.playlist_id === pid).length;
  const r = await sb.from('playlist_tracks').insert({ playlist_id: pid, track_id: S.pending, position: pos }).select().single();
  $('#plPick').close();
  if (r.error) return fail(r.error, 'Could not add song.');
  S.pt.push(r.data); toast('Added to playlist.');
};

// ---- Upload ----
$('#pick').onclick = () => $('#files').click();
$('#upClose').onclick = () => $('#up').close();
$('#files').onchange = (e) => upload([...e.target.files]);
const drop = $('#drop');
['dragover', 'dragenter'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => upload([...e.dataTransfer.files]));
function duration(file) {
  return new Promise((res) => {
    const a = new Audio(), u = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(u); res(v); };
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null); setTimeout(() => done(null), 8000); a.src = u;
  });
}
async function upload(files) {
  const ul = $('#ulist');
  for (const f of files) {
    const li = document.createElement('li'); li.textContent = f.name + ' — uploading…'; ul.append(li);
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!(f.type.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'].includes(ext))) { li.textContent = f.name + ' — not an audio file'; continue; }
    if (f.size > CFG.maxBytes) { li.textContent = f.name + ' — over 50 MB limit'; continue; }
    const path = `${S.user.id}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/g, '') || 'mp3'}`;
    const [dur, up] = await Promise.all([duration(f), sb.storage.from('music-files').upload(path, f, { contentType: f.type || undefined })]);
    if (up.error) { li.textContent = f.name + ' — failed: ' + up.error.message; continue; }
    const ins = await sb.from('tracks').insert({ title: f.name.replace(/\.[^.]+$/, '').slice(0, 200), duration_seconds: dur, storage_path: path, mime_type: f.type || null, file_size: f.size }).select().single();
    if (ins.error) { await sb.storage.from('music-files').remove([path]); li.textContent = f.name + ' — failed: ' + ins.error.message; continue; }
    S.tracks.unshift(ins.data); li.textContent = f.name + ' — done'; if (S.view === 'all') render();
  }
  $('#files').value = '';
}

// ---- Player ----
function startQueue(list, i) { S.queue = list.map((t) => t.id); S.i = Math.max(0, i); S.fails = 0; loadTrack(); }
async function loadTrack() {
  const t = cur(); if (!t) return;
  S.counted = false; $('#pTitle').textContent = t.title; $('#pArtist').textContent = 'Loading…';
  const { data, error } = await sb.storage.from('music-files').createSignedUrl(t.storage_path, 3600);
  if (error || !data) return onFail();
  A.src = data.signedUrl;
  try { await A.play(); } catch (e) { if (e.name !== 'AbortError') onFail(); }
  renderPlayer();
}
function onFail() {
  toast('This song could not be played.'); S.fails++;
  if (S.fails < S.queue.length) next(true); else { S.fails = 0; renderPlayer(); }
}
function togglePlay() { if (!cur()) return; A.paused ? A.play().catch(() => onFail()) : A.pause(); }
function next(auto) {
  if (!S.queue.length) return;
  if (auto === true && S.rep === 'one' && A.src && !A.error) { A.currentTime = 0; return void A.play(); }
  if (S.shuf && S.queue.length > 1) { let n; do { n = Math.floor(Math.random() * S.queue.length); } while (n === S.i); S.i = n; }
  else if (S.i + 1 < S.queue.length) S.i++;
  else if (S.rep === 'all' || auto !== true) S.i = 0;
  else { renderPlayer(); return render(); }
  loadTrack(); render();
}
function prev() { if (A.currentTime > 3 || S.i <= 0) A.currentTime = 0; else { S.i--; loadTrack(); render(); } }
async function logPlay() {
  const t = cur(); if (!t || S.counted) return; S.counted = true;
  const r = await sb.from('play_history').insert({ track_id: t.id, played_seconds: Math.round(A.currentTime) });
  if (r.error) return console.error(r.error);
  t.play_count++; t.last_played_at = new Date().toISOString();
  sb.from('tracks').update({ play_count: t.play_count, last_played_at: t.last_played_at }).eq('id', t.id).then(() => {});
  S.recent = [t.id, ...S.recent.filter((x) => x !== t.id)];
}
function renderPlayer() {
  const t = cur();
  $('#pTitle').textContent = t ? t.title : 'Nothing playing';
  $('#pArtist').textContent = t ? t.artist || 'Unknown artist' : 'Pick a song to start';
  $('#bPlay').textContent = A.paused ? '▶' : '⏸'; $('#bPlay').setAttribute('aria-label', A.paused ? 'Play' : 'Pause');
  $('#bShuf').classList.toggle('on', S.shuf); $('#bRep').classList.toggle('on', S.rep !== 'off');
  $('#bRep').textContent = S.rep === 'one' ? '↻1' : '↻'; $('#bRep').setAttribute('aria-label', 'Repeat ' + S.rep);
  $('#bMute').textContent = A.muted || A.volume === 0 ? '🔇' : '🔊';
}
A.onplay = A.onpause = () => { renderPlayer(); if (S.view !== 'x') document.querySelectorAll('.row').forEach((r) => { const b = r.querySelector('[data-a=play]'); b.textContent = r.dataset.id === S.queue[S.i] && !A.paused ? '⏸' : '▶'; }); };
A.onended = () => next(true);
A.onerror = () => { if (A.src) onFail(); };
A.onwaiting = () => ($('#pArtist').textContent = 'Buffering…');
A.onplaying = () => renderPlayer();
A.ontimeupdate = () => {
  const d = A.duration || cur()?.duration_seconds || 0;
  $('#tCur').textContent = fmt(A.currentTime); $('#tDur').textContent = fmt(d);
  if (d && !seeking) $('#seek').value = (A.currentTime / d) * 1000;
  if (A.currentTime > 10) logPlay();
};
A.onloadedmetadata = () => ($('#tDur').textContent = fmt(A.duration));
let seeking = false;
$('#seek').oninput = (e) => { seeking = true; if (A.duration) A.currentTime = (e.target.value / 1000) * A.duration; };
$('#seek').onchange = () => (seeking = false);
$('#bPlay').onclick = togglePlay; $('#bNext').onclick = () => next(false); $('#bPrev').onclick = prev;
$('#bShuf').onclick = () => { S.shuf = !S.shuf; localStorage.setItem('mr_shuf', S.shuf ? '1' : ''); renderPlayer(); };
$('#bRep').onclick = () => { S.rep = { off: 'all', all: 'one', one: 'off' }[S.rep]; localStorage.setItem('mr_rep', S.rep); renderPlayer(); };
$('#bMute').onclick = () => { A.muted = !A.muted; renderPlayer(); };
$('#vol').oninput = (e) => { A.volume = +e.target.value; A.muted = false; localStorage.setItem('mr_vol', e.target.value); renderPlayer(); };
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || !S.user || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'n') next(false); else if (e.key === 'p') prev();
});
try {
  S.rep = localStorage.getItem('mr_rep') || 'off'; S.shuf = !!localStorage.getItem('mr_shuf');
  const v = localStorage.getItem('mr_vol'); if (v) { A.volume = +v; $('#vol').value = v; } else A.volume = 0.8;
} catch (e) { /* storage unavailable */ }
renderPlayer();
