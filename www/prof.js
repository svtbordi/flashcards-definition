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

/* ---------- Calculs ----------
   « Su » : toute réponse autre que « Raté » (Difficile, Su, Facile). Les pourcentages portent sur les réponses
   données depuis le début ; un bilan ancien (sans ces totaux) se rabat sur ses 30 derniers jours. */

const INACTIF_JOURS = 7; // au-delà, l'élève est signalé dans le tableau
const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
const fmtPct = v => (v === null ? '–' : `${v} %`);
const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const partName = code => (code === 'NC' ? 'Sans chapitre' : code);
const byPart = (a, b) => (chapterOrder[a] ?? 9999) - (chapterOrder[b] ?? 9999) || a.localeCompare(b);

const total = r => (r.reponses_total ?? r.reponses_30j ?? 0);
const failed = r => (r.ratees_total ?? r.ratees_30j ?? 0);
const chapTotal = c => (c.reponses_total ?? c.reponses_30j ?? 0);
const chapFailed = c => (c.ratees_total ?? c.ratees_30j ?? 0);
const lastUse = b => b.resume.derniere_utilisation || null;

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - start) / 864e5));
}

function students() {
  return [...bilans.values()].sort((a, b) => label(a).localeCompare(label(b), 'fr'));
}

function studentRows() {
  return students().map(b => {
    const r = b.resume;
    const last = lastUse(b);
    const idle = daysSince(last);
    return {
      Élève: label(b),
      'Dernière utilisation': fmtDate(last),
      'Jours sans utilisation': idle ?? '–',
      'Jours actifs (30 j)': r.jours_actifs_30j,
      'Réponses depuis le début': total(r),
      'Su (%)': pct(total(r) - failed(r), total(r)),
      'Raté (%)': pct(failed(r), total(r)),
      'Définitions vues': r.cartes_vues,
      Acquises: r.cartes_acquises,
      'À revoir': r.cartes_a_revoir,
      'Bilan reçu le': fmtDate(b.genere),
      _inactive: idle === null || idle >= INACTIF_JOURS,
    };
  });
}

// Thèmes (parties du programme) abordés par un élève
function themeRows(b) {
  return (b.chapitres || []).filter(c => c.vues > 0).sort((x, y) => byPart(x.code, y.code)).map(c => ({
    Partie: partName(c.code),
    Intitulé: chapterTitle[c.code] || '',
    'Définitions vues': `${c.vues} / ${c.total}`,
    Réponses: chapTotal(c),
    'Su (%)': pct(chapTotal(c) - chapFailed(c), chapTotal(c)),
    'Raté (%)': pct(chapFailed(c), chapTotal(c)),
    'Acquises (%)': pct(c.acquises, c.total),
  }));
}

function chapterRows() {
  const agg = {};
  const n = bilans.size;
  for (const b of bilans.values()) {
    for (const c of b.chapitres || []) {
      if (!c.vues) continue;
      const x = agg[c.code] || (agg[c.code] = { code: c.code, eleves: 0, vues: 0, total: 0, acquises: 0, reps: 0, ratees: 0 });
      x.eleves += 1;
      x.vues += c.vues;
      x.total += c.total;
      x.acquises += c.acquises;
      x.reps += chapTotal(c);
      x.ratees += chapFailed(c);
    }
  }
  return Object.values(agg).sort((a, b) => byPart(a.code, b.code)).map(x => ({
    Partie: partName(x.code),
    Intitulé: chapterTitle[x.code] || '',
    'Élèves qui l’ont abordée': `${x.eleves} / ${n}`,
    Réponses: x.reps,
    'Su (%)': pct(x.reps - x.ratees, x.reps),
    'Raté (%)': pct(x.ratees, x.reps),
    'Vues, moyenne (%)': pct(x.vues, x.total),
    'Acquises, moyenne (%)': pct(x.acquises, x.total),
  }));
}

function hardRows() {
  const agg = {};
  for (const b of bilans.values()) {
    for (const h of b.plus_ratees_total || b.plus_ratees || []) {
      const x = agg[h.terme] || (agg[h.terme] = { terme: h.terme, eleves: 0, ratees: 0 });
      x.eleves += 1;
      x.ratees += h.ratees || 0;
    }
  }
  return Object.values(agg).sort((a, b) => b.eleves - a.eleves || b.ratees - a.ratees).slice(0, 40)
    .map(x => ({ Définition: x.terme, 'Élèves qui la ratent': x.eleves, 'Réponses « Raté » depuis le début': x.ratees }));
}

/* ---------- Affichage ---------- */

const PCT_COLS = ['Su (%)', 'Raté (%)', 'Acquises (%)', 'Vues, moyenne (%)', 'Acquises, moyenne (%)'];

function table(rows, opts = {}) {
  if (!rows.length) return '<p class="muted">Rien à afficher.</p>';
  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  const txt = opts.txt || [];
  const fmt = (k, v) => (PCT_COLS.includes(k) ? fmtPct(v) : esc(v ?? '–'));
  return `<div class="scroll"><table><thead><tr>${cols.map(k => `<th class="${txt.includes(k) ? 'txt' : ''}">${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr class="${r._inactive ? 'alert' : ''}">${cols.map(k => `<td class="${txt.includes(k) ? 'txt' : ''}">${fmt(k, r[k])}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

function render() {
  const loaded = document.getElementById('loaded');
  const list = students();
  loaded.innerHTML = list.map(b => `<span>${esc(label(b))}</span>`).join('');
  const out = document.getElementById('results');
  if (!list.length) {
    out.innerHTML = '<section class="card"><p class="muted">Aucun bilan pour l’instant. Les tableaux de la classe apparaîtront ici dès le premier bilan chargé ou déposé.</p></section>';
    return;
  }
  const versions = [...new Set(list.map(b => b.definitions))];
  const old = list.filter(b => b.resume.reponses_total === undefined).length;
  out.innerHTML = `
    <div class="row-actions">
      <button class="primary" id="export">Télécharger le tableur (.xlsx)</button>
      <button id="clear">Vider la liste</button>
    </div>
    ${versions.length > 1 ? `<p class="warn">Les élèves n’ont pas tous la même version des définitions (${versions.map(esc).join(', ')}). Les totaux par thème peuvent légèrement différer.</p>` : ''}
    ${old ? `<p class="warn">${old} bilan${old > 1 ? 's' : ''} d’une ancienne version de l’application : pourcentages calculés sur 30 jours seulement.</p>` : ''}
    <section class="card"><h2>Élèves (${list.length})</h2>${table(studentRows())}
      <p class="muted small">Su et Raté : part des réponses données depuis le début (Difficile et Facile comptent comme Su). En rouge : aucune utilisation depuis ${INACTIF_JOURS} jours ou plus.</p></section>
    <section class="card"><h2>Résultats par thème, élève par élève</h2>
      ${list.map(b => `<details class="student"><summary><b>${esc(label(b))}</b> <span class="muted">· ${plural(themeRows(b).length, 'thème abordé', 'thèmes abordés')}</span></summary>${table(themeRows(b), { txt: ['Intitulé'] })}</details>`).join('')}
    </section>
    <section class="card"><h2>La classe, par thème</h2>${table(chapterRows(), { txt: ['Intitulé'] })}
      <p class="muted small">Su et Raté : toutes les réponses des élèves sur le thème. Moyennes de vues et d’acquises : sur les élèves qui ont abordé le thème.</p></section>
    <section class="card"><h2>Définitions les plus ratées dans la classe</h2>${table(hardRows(), { txt: ['Définition'] })}</section>
    <p class="muted small">Les réponses Su ou Raté sont déclarées par les élèves : elles reflètent leur travail dans l’application, pas un contrôle.</p>`;
  document.getElementById('export').onclick = exportXlsx;
  document.getElementById('clear').onclick = () => { bilans.clear(); render(); };
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

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
    const detail = students().flatMap(b => themeRows(b).map(r => Object.assign({ Élève: label(b) }, r)));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(detail.length ? detail : [{ Élève: '' }]), 'Élèves par thème');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(chapterRows()), 'Classe par thème');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(hardRows()), 'Les plus ratées');
    const days = new Set();
    students().forEach(b => Object.keys(b.jours || {}).forEach(d => days.add(d)));
    const sortedDays = [...days].sort();
    const daily = students().map(b => Object.assign({ Élève: label(b) }, Object.fromEntries(sortedDays.map(d => [d, (b.jours || {})[d] || 0]))));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(daily), 'Réponses par jour (30 j)');
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
    document.getElementById('names-info').textContent = `${names.size} correspondance${names.size > 1 ? 's' : ''} lue${names.size > 1 ? 's' : ''} dans « ${f.name} » (gardée${names.size > 1 ? 's' : ''} seulement dans cette page).`;
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
