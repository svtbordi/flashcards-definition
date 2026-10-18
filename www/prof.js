'use strict';
/* Espace enseignant : regroupe les bilans envoyés par les élèves. Tout reste dans ce navigateur. */

const bilans = new Map(); // nom normalisé -> bilan le plus récent
const names = new Map(); // code de suivi -> nom, lu dans le fichier de correspondance de l'enseignant (jamais envoyé)
const label = b => names.get(String(b.nom).trim().toUpperCase()) || b.nom;
let chapterTitle = {};
let chapterOrder = {};

fetch('data/ouverts.json', { cache: 'no-cache' }).then(r => r.json()).then(o => {
  if (o && Array.isArray(o.chapitres)) { opened = o.chapitres; render(); }
}).catch(() => {});

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
   Carte sue : sa dernière réponse est autre que « Raté » (Difficile, Su, Facile). Carte ratée : dernière réponse « Raté ».
   On suit des nombres de cartes, pas des pourcentages, pour que l'ajout de définitions ne fausse pas la lecture. */

const INACTIF_JOURS = 7; // au-delà, l'élève est signalé dans le tableau
const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const fmtShort = d => { const [, m, j] = d.split('-'); return `${Number(j)}/${Number(m)}`; };
const partName = code => (code === 'NC' ? 'Sans chapitre' : code);
const byPart = (a, b) => (chapterOrder[a] ?? 9999) - (chapterOrder[b] ?? 9999) || a.localeCompare(b);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const lastUse = b => b.resume.derniere_utilisation || null;

// Parties ouvertes en cours (data/ouverts.json) : une partie est ouverte si elle, une de ses sous-parties ou son domaine l'est.
let opened = null;
const isOpen = code => !opened || opened.some(o => o === code || o.startsWith(code + '-') || code.startsWith(o + '-'));

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

const evo = b => b.evolution || [];
// Variation des cartes sues sur 4 semaines : dernier point comparé au point d'il y a 28 jours ou plus
function gain(b) {
  const e = evo(b);
  if (e.length < 2) return null;
  const last = e[e.length - 1];
  const limit = new Date(last.d);
  limit.setDate(limit.getDate() - 28);
  const ref = [...e].reverse().find(p => new Date(p.d) <= limit) || e[0];
  return last.s - ref.s;
}
const signed = v => (v === null ? '–' : v > 0 ? `+${v}` : String(v));

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
      'Cartes sues': r.cartes_sues ?? '–',
      'Cartes ratées': r.cartes_ratees ?? '–',
      'Sues, sur 4 semaines': signed(gain(b)),
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
    'Vu en cours': isOpen(c.code) ? 'oui' : 'non',
    'Définitions vues': `${c.vues} / ${c.total}`,
    'Cartes sues': c.cartes_sues ?? '–',
    'Cartes ratées': c.cartes_ratees ?? '–',
  }));
}

function chapterRows() {
  const agg = {};
  const n = bilans.size;
  for (const b of bilans.values()) {
    for (const c of b.chapitres || []) {
      if (!c.vues) continue;
      const x = agg[c.code] || (agg[c.code] = { code: c.code, eleves: 0, sues: 0, ratees: 0, total: c.total });
      x.eleves += 1;
      x.sues += c.cartes_sues || 0;
      x.ratees += c.cartes_ratees || 0;
      x.total = Math.max(x.total, c.total);
    }
  }
  return Object.values(agg).sort((a, b) => byPart(a.code, b.code)).map(x => ({
    Partie: partName(x.code),
    Intitulé: chapterTitle[x.code] || '',
    'Vu en cours': isOpen(x.code) ? 'oui' : 'non',
    'Élèves qui l’ont abordée': `${x.eleves} / ${n}`,
    'Définitions de la partie': x.total,
    'Cartes sues (classe)': x.sues,
    'Cartes ratées (classe)': x.ratees,
    'Sues par élève, en moyenne': Math.round(x.sues / x.eleves),
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

// Évolution de la classe : à chaque date, somme des élèves (pour chacun, son dernier point à cette date)
function classEvolution() {
  const list = students().filter(b => evo(b).length);
  const dates = [...new Set(list.flatMap(b => evo(b).map(p => p.d)))].sort();
  return dates.map(d => {
    const p = { d, s: 0, r: 0, t: {} };
    for (const b of list) {
      const q = [...evo(b)].reverse().find(x => x.d <= d);
      if (!q) continue;
      p.s += q.s;
      p.r += q.r;
      for (const [code, [s, r]] of Object.entries(q.t)) {
        const x = p.t[code] || (p.t[code] = [0, 0]);
        x[0] += s;
        x[1] += r;
      }
    }
    return p;
  });
}

/* ---------- Courbes ---------- */

const niceMax = v => { if (v <= 5) return 5; const m = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / m) * m; };

// Deux courbes : cartes sues (trait plein) et cartes ratées (pointillés). muted : partie pas encore vue en cours.
function lineChart(points, { w = 900, h = 220, max = null, compact = false, muted = false, title = '' } = {}) {
  if (!points.length) return '<p class="muted small">Pas encore de réponse.</p>';
  const pad = compact ? { l: 26, r: 8, t: 8, b: 18 } : { l: 36, r: 44, t: 12, b: 24 };
  const top = niceMax(max ?? Math.max(1, ...points.map(p => Math.max(p.s, p.r))));
  const t0 = Date.parse(points[0].d);
  const t1 = Date.parse(points[points.length - 1].d);
  const x = d => pad.l + (t1 === t0 ? (w - pad.l - pad.r) / 2 : (Date.parse(d) - t0) / (t1 - t0) * (w - pad.l - pad.r));
  const y = v => h - pad.b - v / top * (h - pad.t - pad.b);
  const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const cls = muted ? 'muted-series' : '';
  const grid = [0, top / 2, top].map(v => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 4}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const last = points[points.length - 1];
  const dots = key => points.length === 1 ? `<circle class="${key} ${cls}" cx="${x(last.d)}" cy="${y(last[key])}" r="4"/>` : '';
  const labels = compact ? '' : `<text class="end s" x="${x(last.d) + 6}" y="${y(last.s) + 4}">${last.s} sues</text><text class="end r" x="${x(last.d) + 6}" y="${y(last.r) + (Math.abs(y(last.r) - y(last.s)) < 14 ? 16 : 4)}">${last.r} ratées</text>`;
  const step = points.length > 1 ? (x(points[1].d) - x(points[0].d)) : 40;
  const hits = points.map(p => `<rect class="hit" x="${x(p.d) - step / 2}" y="${pad.t}" width="${Math.max(step, 8)}" height="${h - pad.t - pad.b}"><title>${fmtShort(p.d)} : ${p.s} cartes sues, ${p.r} ratées</title></rect>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title || 'Évolution')} : ${last.s} cartes sues et ${last.r} ratées au ${fmtShort(last.d)}">
    ${grid}
    <text class="tick" x="${pad.l}" y="${h - 4}">${fmtShort(points[0].d)}</text>
    ${points.length > 1 ? `<text class="tick" x="${w - pad.r}" y="${h - 4}" text-anchor="end">${fmtShort(last.d)}</text>` : ''}
    <path class="line s ${cls}" d="${path('s')}"/><path class="line r ${cls}" d="${path('r')}"/>${dots('s')}${dots('r')}
    ${labels}${hits}
  </svg>`;
}

const legend = '<p class="legend-line"><span class="key s"></span>Cartes sues <span class="key r"></span>Cartes ratées <span class="key m"></span>Partie pas encore vue en cours</p>';

// Une petite courbe par thème, même échelle pour toutes ; les parties vues en cours en couleur, les autres en gris
function themeCharts(points) {
  const codes = [...new Set(points.flatMap(p => Object.keys(p.t)))].sort(byPart);
  if (!codes.length) return '';
  const series = code => points.filter(p => p.t[code] || points.indexOf(p) === points.length - 1).map(p => ({ d: p.d, s: (p.t[code] || [0, 0])[0], r: (p.t[code] || [0, 0])[1] }));
  const max = Math.max(1, ...codes.flatMap(c => series(c).map(p => Math.max(p.s, p.r))));
  return `<div class="multiples">${codes.map(code => `<figure class="${isOpen(code) ? '' : 'closed'}">
      <figcaption><b>${esc(partName(code))}</b> ${esc(chapterTitle[code] || '')}${isOpen(code) ? '' : ' <span class="muted">(pas encore vue)</span>'}</figcaption>
      ${lineChart(series(code), { w: 260, h: 110, max, compact: true, muted: !isOpen(code), title: partName(code) })}
    </figure>`).join('')}</div>`;
}

/* ---------- Affichage ---------- */

function table(rows, opts = {}) {
  if (!rows.length) return '<p class="muted">Rien à afficher.</p>';
  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  const txt = opts.txt || [];
  return `<div class="scroll"><table><thead><tr>${cols.map(k => `<th class="${txt.includes(k) ? 'txt' : ''}">${esc(k)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr class="${r._inactive ? 'alert' : ''}">${cols.map(k => `<td class="${txt.includes(k) ? 'txt' : ''}">${esc(r[k] ?? '–')}</td>`).join('')}</tr>`).join('')
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
  const old = list.filter(b => !b.evolution).length;
  const cls = classEvolution();
  out.innerHTML = `
    <div class="row-actions">
      <button class="primary" id="export">Télécharger le tableur (.xlsx)</button>
      <button id="clear">Vider la liste</button>
    </div>
    ${versions.length > 1 ? `<p class="warn">Les élèves n’ont pas tous la même version des définitions (${versions.map(esc).join(', ')}).</p>` : ''}
    ${old ? `<p class="warn">${plural(old, 'bilan vient', 'bilans viennent')} d’une ancienne version de l’application : pas de nombres de cartes ni d’évolution pour ${old > 1 ? 'eux' : 'lui'} avant leur prochain envoi.</p>` : ''}
    <section class="card"><h2>Élèves (${list.length})</h2>${table(studentRows())}
      <p class="muted small">Carte sue : dernière réponse Su (ou Difficile, Facile). Carte ratée : dernière réponse Raté ; elle redevient sue quand l’élève la réussit. « Sues, sur 4 semaines » : cartes sues gagnées depuis 4 semaines. En rouge : aucune utilisation depuis ${INACTIF_JOURS} jours ou plus.</p></section>
    <section class="card"><h2>La classe</h2>${legend}
      <h3>Toutes les définitions</h3>${lineChart(cls, { title: 'Classe' })}
      <h3>Par thème</h3>${themeCharts(cls)}
      ${table(chapterRows(), { txt: ['Intitulé'] })}</section>
    <section class="card"><h2>Définitions les plus ratées dans la classe</h2>${table(hardRows(), { txt: ['Définition'] })}</section>
    <section class="card"><h2>Élève par élève</h2>
      ${list.map(b => `<details class="student"><summary><b>${esc(label(b))}</b> <span class="muted">· ${b.resume.cartes_sues ?? '–'} sues, ${b.resume.cartes_ratees ?? '–'} ratées · ${plural(themeRows(b).length, 'thème abordé', 'thèmes abordés')}</span></summary>
        ${legend}<h3>Toutes les définitions</h3>${lineChart(evo(b), { title: label(b) })}
        <h3>Par thème</h3>${themeCharts(evo(b))}${table(themeRows(b), { txt: ['Intitulé'] })}</details>`).join('')}
    </section>
    <p class="muted small">Les réponses Su ou Raté sont déclarées par les élèves : elles reflètent leur travail dans l’application, pas un contrôle.</p>`;
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
    const sheet = rows => X.utils.json_to_sheet(rows.length ? rows : [{ '': 'Rien à afficher' }]);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, sheet(clean(studentRows())), 'Élèves');
    X.utils.book_append_sheet(wb, sheet(students().flatMap(b => themeRows(b).map(r => Object.assign({ Élève: label(b) }, r)))), 'Élèves par thème');
    X.utils.book_append_sheet(wb, sheet(chapterRows()), 'Classe par thème');
    X.utils.book_append_sheet(wb, sheet(hardRows()), 'Les plus ratées');
    const rows = [];
    for (const b of students()) {
      for (const p of evo(b)) {
        rows.push({ Élève: label(b), Date: p.d, Thème: 'Toutes', 'Cartes sues': p.s, 'Cartes ratées': p.r });
        for (const [code, [s, r]] of Object.entries(p.t).sort(([a], [c]) => byPart(a, c))) {
          rows.push({ Élève: label(b), Date: p.d, Thème: partName(code), 'Cartes sues': s, 'Cartes ratées': r });
        }
      }
    }
    X.utils.book_append_sheet(wb, sheet(rows), 'Évolution');
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
