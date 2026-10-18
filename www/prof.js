'use strict';
/* Espace enseignant : regroupe les bilans envoyés par les élèves. Tout reste dans ce navigateur. */

const bilans = new Map(); // nom normalisé -> bilan le plus récent
const names = new Map(); // code de suivi -> nom, lu dans le fichier de correspondance de l'enseignant (jamais envoyé)
const label = b => names.get(String(b.nom).trim().toUpperCase()) || b.nom;
let chapterTitle = {};
let chapterOrder = {};

fetch('data/chapters.json').then(r => r.json()).then(list => {
  list.forEach((c, i) => { chapterTitle[c.code] = c.title; chapterOrder[c.code] = i; });
  chapterTitle.NC = 'Définitions sans chapitre';
  render();
}).catch(() => {});

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

function normName(s) {
  return String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

// Extrait tous les objets JSON de bilan présents dans un texte (un fichier ou plusieurs bilans collés à la suite).
function extractBilans(text) {
  const found = [];
  let i = text.indexOf('{');
  while (i >= 0) {
    let depth = 0, inStr = false, esc2 = false, end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc2) esc2 = false;
        else if (ch === '\\') esc2 = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    try {
      const obj = JSON.parse(text.slice(i, end + 1));
      if (obj && obj.app === 'flashcards-bcpst-bilan' && obj.resume && obj.nom) found.push(obj);
    } catch (e) { /* morceau qui n'est pas un bilan */ }
    i = text.indexOf('{', end + 1);
  }
  return found;
}

function addBilan(b) {
  const key = normName(b.nom);
  const prev = bilans.get(key);
  if (prev && prev.genere >= b.genere) return 0;
  bilans.set(key, b);
  return 1;
}

function addText(text, source) {
  let list = extractBilans(text);
  if (!list.length && text.includes('""')) list = extractBilans(text.replace(/""/g, '"')); // export .csv de l'onglet « Suivi »
  let added = 0;
  for (const b of list) added += addBilan(b);
  if (!list.length) toast(`Aucun bilan reconnu dans ${source}.`);
  return added;
}

async function addFiles(files) {
  let added = 0;
  for (const f of files) added += addText(await f.text(), `« ${f.name} »`);
  toast(`${added} bilan${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}.`);
  render();
}

const drop = document.getElementById('drop');
document.getElementById('files').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
document.getElementById('read-paste').onclick = () => {
  const ta = document.getElementById('paste');
  const added = addText(ta.value, 'le texte collé');
  if (added) { toast(`${added} bilan${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}.`); ta.value = ''; }
  render();
};
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));

/* ---------- Calculs ---------- */

const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
const fmtPct = v => (v === null ? '–' : `${v} %`);
const fmtDate = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

function students() {
  return [...bilans.values()].sort((a, b) => label(a).localeCompare(label(b), 'fr'));
}

function studentRows() {
  return students().map(b => {
    const r = b.resume;
    return {
      Élève: label(b),
      'Bilan du': fmtDate(b.genere),
      'Réponses 7 j': r.reponses_7j,
      'Réponses 30 j': r.reponses_30j,
      'Réussite 30 j (%)': pct(r.reponses_30j - r.ratees_30j, r.reponses_30j),
      'Jours actifs 7 j': r.jours_actifs_7j,
      'Jours actifs 30 j': r.jours_actifs_30j,
      Série: r.serie,
      'Définitions vues': r.cartes_vues,
      Acquises: r.cartes_acquises,
      'À revoir': r.cartes_a_revoir,
      _inactive: r.jours_actifs_7j === 0,
    };
  });
}

function chapterRows() {
  const agg = {};
  const n = bilans.size;
  for (const b of bilans.values()) {
    for (const c of b.chapitres || []) {
      const x = agg[c.code] || (agg[c.code] = { code: c.code, eleves: 0, vues: 0, total: 0, acquises: 0, reps: 0, ratees: 0 });
      x.eleves += 1;
      x.vues += c.vues;
      x.total += c.total;
      x.acquises += c.acquises;
      x.reps += c.reponses_30j;
      x.ratees += c.ratees_30j;
    }
  }
  return Object.values(agg)
    .sort((a, b) => (chapterOrder[a.code] ?? 9999) - (chapterOrder[b.code] ?? 9999) || a.code.localeCompare(b.code))
    .map(x => ({
      Partie: x.code === 'NC' ? 'Sans chapitre' : x.code,
      Intitulé: chapterTitle[x.code] || '',
      'Élèves qui l’ont commencée': `${x.eleves} / ${n}`,
      'Vues, moyenne (%)': pct(x.vues, x.total),
      'Acquises, moyenne (%)': pct(x.acquises, x.total),
      'Réponses 30 j': x.reps,
      'Échec 30 j (%)': pct(x.ratees, x.reps),
    }));
}

function hardRows() {
  const agg = {};
  for (const b of bilans.values()) {
    for (const h of b.plus_ratees || []) {
      const x = agg[h.terme] || (agg[h.terme] = { terme: h.terme, eleves: 0, ratees: 0 });
      x.eleves += 1;
      x.ratees += h.ratees || 0;
    }
  }
  return Object.values(agg).sort((a, b) => b.eleves - a.eleves || b.ratees - a.ratees).slice(0, 40)
    .map(x => ({ Définition: x.terme, 'Élèves qui la ratent': x.eleves, 'Réponses « Raté » sur 30 j': x.ratees }));
}

/* ---------- Affichage ---------- */

function table(rows, opts = {}) {
  if (!rows.length) return '<p class="muted">Rien à afficher.</p>';
  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  const fmt = (k, v) => (opts.pct && opts.pct.includes(k) ? fmtPct(v) : esc(v));
  return `<div class="scroll"><table><thead><tr>${cols.map(k => `<th class="${opts.txt && opts.txt.includes(k) ? 'txt' : ''}">${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr class="${r._inactive ? 'alert' : ''}">${cols.map(k => `<td class="${opts.txt && opts.txt.includes(k) ? 'txt' : ''}">${fmt(k, r[k])}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

function render() {
  const loaded = document.getElementById('loaded');
  const list = students();
  loaded.innerHTML = list.map(b => `<span>${esc(label(b))}</span>`).join('');
  const out = document.getElementById('results');
  if (!list.length) {
    out.innerHTML = '<section class="card"><p class="muted">Aucun bilan pour l’instant. Les tableaux de la classe apparaîtront ici dès le premier bilan déposé.</p></section>';
    return;
  }
  const versions = [...new Set(list.map(b => b.definitions))];
  out.innerHTML = `
    <div class="row-actions">
      <button class="primary" id="export">Télécharger le tableur (.xlsx)</button>
      <button id="clear">Vider la liste</button>
    </div>
    ${versions.length > 1 ? `<p class="warn">Les élèves n’ont pas tous la même version des définitions (${versions.map(esc).join(', ')}). Les totaux par chapitre peuvent légèrement différer.</p>` : ''}
    <section class="card"><h2>Élèves (${list.length})</h2>${table(studentRows(), { pct: ['Réussite 30 j (%)'] })}</section>
    <section class="card"><h2>Par partie du programme</h2>${table(chapterRows(), { pct: ['Vues, moyenne (%)', 'Acquises, moyenne (%)', 'Échec 30 j (%)'], txt: ['Intitulé'] })}
      <p class="muted small">Moyennes calculées sur les élèves qui ont commencé la partie.</p></section>
    <section class="card"><h2>Définitions les plus ratées dans la classe</h2>${table(hardRows(), { txt: ['Définition'] })}</section>
    <p class="muted small">Les bilans sont déclarés par les élèves : ils reflètent leur travail dans l’application, pas un contrôle.</p>`;
  document.getElementById('export').onclick = exportXlsx;
  document.getElementById('clear').onclick = () => { bilans.clear(); render(); };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = reject;
    document.head.appendChild(el);
  });
}

async function exportXlsx() {
  try {
    if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
    const X = window.XLSX;
    const clean = rows => rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(clean(studentRows())), 'Élèves');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(chapterRows()), 'Par partie');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(hardRows()), 'Les plus ratées');
    const days = new Set();
    students().forEach(b => Object.keys(b.jours || {}).forEach(d => days.add(d)));
    const sortedDays = [...days].sort();
    const daily = students().map(b => Object.assign({ Élève: label(b) }, Object.fromEntries(sortedDays.map(d => [d, (b.jours || {})[d] || 0]))));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(daily), 'Réponses par jour');
    const today = new Date().toISOString().slice(0, 10);
    X.writeFile(wb, `bilans-classe-${today}.xlsx`);
  } catch (e) {
    toast('Export impossible : ' + (e.message || e));
  }
}

/* ---------- Suivi automatique ---------- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I, faciles à confondre

function newCode() {
  const r = crypto.getRandomValues(new Uint32Array(6));
  return [...r].map(x => ALPHABET[x % ALPHABET.length]).join('');
}

try { document.getElementById('cle').value = sessionStorage.getItem('fc-cle') || ''; } catch (e) { /* stockage bloqué */ }

document.getElementById('load-suivi').onclick = async () => {
  const cle = document.getElementById('cle').value.trim();
  if (!cle) { toast('Indiquez la clé enseignant choisie dans le script.'); return; }
  try { sessionStorage.setItem('fc-cle', cle); } catch (e) { /* stockage bloqué */ }
  try {
    const conf = await fetch('config.json', { cache: 'no-cache' }).then(r => r.json());
    if (!conf.signalement) throw new Error('adresse du script absente de config.json');
    const data = await fetch(`${conf.signalement}?cle=${encodeURIComponent(cle)}`).then(r => r.json());
    if (data.erreur) { toast(data.erreur); return; }
    let added = 0;
    for (const b of data.bilans || []) if (b && b.resume && b.nom) added += addBilan(b);
    const n = (data.bilans || []).length;
    toast(n ? `${n} bilan${n > 1 ? 's' : ''} reçu${n > 1 ? 's' : ''}, dont ${added} nouveau${added > 1 ? 'x' : ''} ou plus récent${added > 1 ? 's' : ''}.` : 'Aucun bilan dans l’onglet « Suivi » pour l’instant.');
    render();
  } catch (e) {
    toast('Lecture impossible (' + (e.message || e) + '). Autre solution : dans le tableur, onglet « Suivi », Fichier > Télécharger > .csv, puis déposez ce fichier ci-dessous.');
  }
};

document.getElementById('names').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
    names.clear();
    for (const [code, nom] of rows) {
      const c = String(code).trim().toUpperCase();
      if (c && String(nom).trim() && c !== 'CODE') names.set(c, String(nom).trim());
    }
    document.getElementById('names-info').textContent = `${names.size} correspondances lues dans « ${f.name} » (gardées seulement dans cette page).`;
    render();
  } catch (err) {
    toast('Fichier de correspondance illisible : ' + (err.message || err));
  }
};

document.getElementById('make-codes').onclick = async () => {
  const n = Math.min(200, Math.max(1, Number(document.getElementById('ncodes').value) || 0));
  const codes = new Set();
  while (codes.size < n) codes.add(newCode());
  try {
    if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
    const X = window.XLSX;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Code', 'Nom'], ...[...codes].map(c => [c, ''])]), 'Correspondance');
    X.writeFile(wb, `codes-suivi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    toast('Création impossible : ' + (e.message || e));
  }
};

render();
