'use strict';
/* Espace enseignant : cocher les chapitres vus en cours et publier data/ouverts.json.
   La publication directe passe par l'API GitHub avec une clé personnelle gardée dans ce navigateur. */

const TOKEN_KEY = 'fc-bcpst-prof-token';
const PATH = 'www/data/ouverts.json';
let chapters = [];
let cards = [];
let checked = new Set();
let published = '';
let expanded = new Set();
let repo = '';
let methods = true; // méthodes et techniques toujours dans les révisions espacées

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const covers = (sel, code) => code === sel || code.startsWith(sel + '-');
const parentOf = code => code.split('-').slice(0, -1).join('-');

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}

// liste minimale : une sous-partie couverte par une partie cochée n'est pas répétée ; ordre du programme
function selection() {
  const parts = new Map(chapters.filter(c => c.code.split('-').length === 2).map((c, i) => [c.code, i]));
  const part = code => parts.get(code.split('-').slice(0, 2).join('-')) ?? 999;
  return [...checked].filter(code => ![...checked].some(o => o !== code && covers(o, code)))
    .sort((a, b) => part(a) - part(b) || a.localeCompare(b, 'fr', { numeric: true }));
}

const count = code => cards.filter(c => c.codes.some(k => covers(code, k))).length;
const inReviews = () => cards.filter(c => (methods && c.method) || c.codes.some(k => selection().some(sel => covers(sel, k)))).length;
const state = () => JSON.stringify({ chapitres: selection(), methodes: methods });

function node(c) {
  const kids = chapters.filter(x => parentOf(x.code) === c.code);
  const byParent = [...checked].some(o => o !== c.code && covers(o, c.code));
  const on = checked.has(c.code) || byParent;
  const open = expanded.has(c.code);
  return `<li><div class="node">
      <input type="checkbox" id="cb-${c.code}" data-code="${c.code}" ${on ? 'checked' : ''} ${byParent ? 'disabled' : ''}>
      <label for="cb-${c.code}"><b>${esc(c.code)}</b> ${esc(c.title)}</label>
      <span class="count">${count(c.code)}</span>
      ${kids.length ? `<button class="toggle" data-toggle="${c.code}" aria-expanded="${open}">${open ? '▾' : '▸'}</button>` : ''}
    </div>
    ${kids.length && open ? `<ul class="tree">${kids.map(node).join('')}</ul>` : ''}</li>`;
}

function render() {
  const parts = chapters.filter(c => c.code.split('-').length === 2);
  const years = ['BCPST 1', 'BCPST 1 et 2', 'BCPST 2'];
  $('years').innerHTML = years.map(y => {
    const list = parts.filter(p => (p.year || '') === y);
    return list.length ? `<section class="card year"><h2>${esc(y)}</h2><ul class="tree">${list.map(node).join('')}</ul></section>` : '';
  }).join('');
  const sel = selection();
  const dirty = state() !== published;
  $('summary').innerHTML = `${sel.length ? `${sel.length} ${sel.length > 1 ? 'parties ou sous-parties cochées' : 'partie ou sous-partie cochée'}, ${inReviews()} définitions dans les révisions espacées.` : `Aucun chapitre coché : les révisions espacées ne proposeront ${methods && cards.some(c => c.method) ? 'que les méthodes et techniques' : 'aucune nouvelle définition'}.`}
    ${dirty ? '<span class="dirty">Modifications non publiées.</span>' : ''}`;
  $('token-state').textContent = getToken() ? '(enregistrée)' : '(absente)';
  document.querySelectorAll('[data-code]').forEach(cb => {
    cb.onchange = () => {
      const code = cb.dataset.code;
      if (cb.checked) {
        checked.add(code);
        [...checked].forEach(o => { if (o !== code && covers(code, o)) checked.delete(o); });
      } else checked.delete(code);
      render();
    };
  });
  document.querySelectorAll('[data-toggle]').forEach(b => {
    b.onclick = () => { const c = b.dataset.toggle; expanded.has(c) ? expanded.delete(c) : expanded.add(c); render(); };
  });
}

function fileContent() {
  const now = new Date().toISOString();
  return JSON.stringify({ version: now, chapitres: selection(), methodes: methods }, null, 1) + '\n';
}

const b64 = text => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

async function publish() {
  const token = getToken();
  if (!token) {
    $('token-box').open = true;
    $('token').focus();
    return toast('Enregistre d’abord ta clé d’accès GitHub, ou télécharge le fichier.');
  }
  const btn = $('publish');
  btn.disabled = true;
  try {
    const url = `https://api.github.com/repos/${repo}/contents/${PATH}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const cur = await fetch(`${url}?ref=main`, { headers, cache: 'no-store' });
    if (cur.status === 401 || cur.status === 403) throw new Error('clé refusée par GitHub');
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message: 'Chapitres vus en cours : ' + (selection().join(', ') || 'aucun'), content: b64(fileContent()), sha, branch: 'main' }),
    });
    if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
    published = state();
    render();
    toast('Publié. Les étudiants recevront la liste dans quelques minutes, à l’ouverture de l’application.');
  } catch (e) {
    toast('Publication impossible : ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

function download() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([fileContent()], { type: 'application/json' }));
  a.download = 'ouverts.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Dépose ce fichier sur GitHub dans www/data/, en remplaçant ouverts.json.');
}

async function main() {
  const [chaps, defs, open, conf] = await Promise.all([
    fetch('data/chapters.json').then(r => r.json()),
    fetch('data/definitions.json').then(r => r.json()),
    fetch('data/ouverts.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    fetch('config.json').then(r => r.json()).catch(() => ({})),
  ]);
  chapters = chaps;
  cards = defs.cards.filter(c => c.codes.length);
  repo = conf.depot || 'svtbordi/flashcards-definition';
  const list = open && Array.isArray(open.chapitres) ? open.chapitres : [];
  checked = new Set(list);
  methods = !(open && open.methodes === false);
  published = state();
  const nm = cards.filter(c => c.method).length;
  $('methods-box').hidden = !nm;
  $('methods').checked = methods;
  $('methods-count').textContent = nm;
  $('methods').onchange = () => { methods = $('methods').checked; render(); };
  list.forEach(code => { for (let p = parentOf(code); p.includes('-'); p = parentOf(p)) expanded.add(p); });
  render();
  $('publish').onclick = publish;
  $('download').onclick = download;
  $('token-save').onclick = () => {
    const v = $('token').value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { return toast('Impossible d’enregistrer la clé dans ce navigateur.'); }
    $('token').value = '';
    render();
    toast('Clé enregistrée sur cet appareil.');
  };
  $('token-forget').onclick = () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* rien */ } render(); toast('Clé oubliée.'); };
  window.addEventListener('beforeunload', e => { if (state() !== published) e.preventDefault(); });
}

main().catch(() => { $('years').innerHTML = '<p class="warn">Impossible de charger les chapitres. Vérifie ta connexion.</p>'; });
