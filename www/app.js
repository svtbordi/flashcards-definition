'use strict';
/* Flashcards BCPST : répétition espacée (FSRS) sur les définitions du programme.
   Toutes les données restent dans le navigateur de l'élève (localStorage). */

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = window.FSRS;

const STORE_KEY = 'fc-bcpst-v1';
const DECK_KEY = 'fc-bcpst-deck-v1';
const DAY_START_HOUR = 4; // une « journée » de révision commence à 4 h, comme dans Anki
const MASTERED_DAYS = 21; // carte considérée comme acquise au-delà de 21 jours de stabilité
const NO_CODE = 'NC';
// « (principe) » ou « (objectifs) » d'une méthode : caché dans les propositions du QCM, où il trahirait la bonne réponse
const FACET = /\s*\((principe|objectifs)\)$/i;
const QCM_SIZE = 10; // questions de l'échauffement

const DEFAULT_SETTINGS = {
  newPerDay: 20,
  dailyGoal: 30,
  buttons: 2,
  retention: 0.9,
  reminderTime: '18:00',
};

/* ---------- Stockage ---------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    toast('Impossible d’enregistrer : stockage plein ou bloqué.');
    return false;
  }
}

const store = Object.assign(
  { cards: {}, log: [], days: {}, settings: {}, selection: [], qcmLog: [], pendingReports: [] },
  loadJSON(STORE_KEY, {})
);
store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings);
const persist = () => saveJSON(STORE_KEY, store);

/* ---------- Dates ---------- */

function dayKey(date = new Date()) {
  const d = new Date(date.getTime() - DAY_START_HOUR * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function endOfStudyDay(now = new Date()) {
  const d = new Date(now.getTime() - DAY_START_HOUR * 3600e3);
  d.setHours(24 + DAY_START_HOUR, 0, 0, 0);
  return d;
}

function today() {
  const k = dayKey();
  if (!store.days[k]) store.days[k] = { reviews: 0, newCards: 0, again: 0 };
  return store.days[k];
}

function streak() {
  let n = 0;
  const d = new Date();
  if (!(store.days[dayKey(d)] && store.days[dayKey(d)].reviews)) d.setDate(d.getDate() - 1);
  while (store.days[dayKey(d)] && store.days[dayKey(d)].reviews > 0) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* ---------- FSRS ---------- */

let scheduler = makeScheduler();

function makeScheduler() {
  return fsrs(generatorParameters({
    request_retention: store.settings.retention,
    maximum_interval: 365,
    enable_fuzz: true,
    learning_steps: ['10m'],
    relearning_steps: ['10m'],
  }));
}

function toCard(saved) {
  return Object.assign({}, saved, {
    due: new Date(saved.due),
    last_review: saved.last_review ? new Date(saved.last_review) : undefined,
  });
}

function fromCard(card) {
  return Object.assign({}, card, {
    due: card.due.toISOString(),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : undefined,
  });
}

function stateOf(id) {
  const s = store.cards[id];
  return s ? toCard(s) : null;
}

function retrievability(card, now = new Date()) {
  if (!card || card.state === State.New) return 0;
  try {
    return scheduler.get_retrievability(card, now, false);
  } catch (e) {
    return 0;
  }
}

/* ---------- Définitions et chapitres ---------- */

let deck = { version: '', cards: [] };
let chapters = [];
const chapterTitle = {};
const chapterOrder = {};

function normTerm(term) {
  return String(term).trim().toLowerCase()
    .replace(/œ/g, 'oe').replace(/’/g, "'").replace(/ /g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function partOf(code) {
  return code === NO_CODE ? NO_CODE : code.split('-').slice(0, 2).join('-');
}

function cardCodes(c) {
  return c.codes.length ? c.codes : [NO_CODE];
}

// METHODS dans une sélection : les définitions de méthodes et techniques (colonne E du tableur), tous chapitres confondus
const METHODS = '@methodes';

function matchesSelection(card, selected) {
  if (card.method && selected.includes(METHODS)) return true;
  return cardCodes(card).some(code => selected.some(sel => code === sel || code.startsWith(sel + '-')));
}

function cardOrderKey(c) {
  const code = cardCodes(c)[0];
  const order = chapterOrder[code] ?? chapterOrder[partOf(code)] ?? 9999;
  return [order, c.term];
}

async function loadDeck() {
  const [bundled, chaps, conf, open] = await Promise.all([
    fetch('data/definitions.json').then(r => r.json()),
    fetch('data/chapters.json').then(r => r.json()),
    fetch('config.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => ({})),
    fetch('data/ouverts.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null),
    fetch('data/leurres.json').then(r => r.json()).then(QCM.setCurated).catch(() => null),
  ]);
  config = conf || {};
  opened = open && Array.isArray(open.chapitres) ? open : null;
  chapters = chaps;
  chapters.forEach((c, i) => {
    chapterTitle[c.code] = c.title;
    chapterOrder[c.code] = i;
  });
  chapterTitle[NO_CODE] = 'Définitions sans chapitre';
  chapterOrder[NO_CODE] = 9998;
  const imported = loadJSON(DECK_KEY, null);
  deck = imported && imported.version >= bundled.version ? imported : bundled;
  deck.cards = deck.cards.filter(c => c.codes.length); // une définition sans chapitre n'est pas proposée
  bundledVersion = bundled.version;
}
let bundledVersion = '';
let config = {};
let opened = null; // chapitres vus en cours, cochés par l'enseignant (data/ouverts.json) ; null : tout le programme

// Les révisions espacées prennent leurs nouvelles cartes dans les chapitres vus en cours,
// et dans les méthodes et techniques, qui servent partout, sauf si l'enseignant les a exclues.
function openChapters() {
  if (!opened) return ['SV', 'BG', 'ST'];
  return opened.methodes === false ? opened.chapitres : [...opened.chapitres, METHODS];
}

const methodCards = () => deck.cards.filter(c => c.method);

const isStarted = c => { const st = store.cards[c.id]; return !!st && st.state !== State.New; };

function setDeck(newDeck, persistIt) {
  deck = newDeck;
  if (persistIt) saveJSON(DECK_KEY, newDeck);
}

/* ---------- Statistiques ---------- */

function cardStatus(c, now, endDay) {
  const st = stateOf(c.id);
  if (!st || st.state === State.New) return 'new';
  if (st.due <= endDay) return 'due';
  if (st.stability >= MASTERED_DAYS) return 'mastered';
  return 'learning';
}

function statsFor(cards) {
  const now = new Date();
  const endDay = endOfStudyDay(now);
  const s = { total: cards.length, new: 0, due: 0, learning: 0, mastered: 0 };
  for (const c of cards) s[cardStatus(c, now, endDay)] += 1;
  s.seen = s.total - s.new;
  return s;
}

function startedCodes() {
  const codes = new Set();
  for (const c of deck.cards) {
    const st = store.cards[c.id];
    if (st && st.reps > 0) cardCodes(c).forEach(code => codes.add(code));
  }
  return [...codes];
}

function dueCountAll() {
  return statsFor(deck.cards).due;
}

function updateBadge() {
  const n = dueCountAll();
  try {
    if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  } catch (e) { /* non pris en charge */ }
}

/* ---------- Séance ---------- */

let session = null;

// Cartes d'une séance. En révisions espacées : les chapitres vus en cours, plus toute carte déjà commencée
// ailleurs (en entraînement libre), qui continue d'être révisée selon son calendrier.
function inScope(c, selected, reviews) {
  return matchesSelection(c, selected) || (reviews && isStarted(c));
}

function buildSession(selected, { ahead = false, label = '', reviews = false } = {}) {
  const now = new Date();
  const endDay = endOfStudyDay(now);
  const pool = deck.cards.filter(c => inScope(c, selected, reviews));
  const due = [];
  const fresh = [];
  const notDue = [];
  for (const c of pool) {
    const st = stateOf(c.id);
    if (!st || st.state === State.New) fresh.push(c);
    else if (st.due <= endDay) due.push({ c, r: retrievability(st, now) });
    else notDue.push({ c, r: retrievability(st, now) });
  }
  due.sort((a, b) => a.r - b.r);
  let queue;
  if (ahead) {
    notDue.sort((a, b) => a.r - b.r);
    queue = notDue.slice(0, store.settings.dailyGoal).map(x => x.c);
  } else {
    fresh.sort((a, b) => {
      const ka = cardOrderKey(a), kb = cardOrderKey(b);
      return ka[0] - kb[0] || ka[1].localeCompare(kb[1], 'fr');
    });
    const newLeft = Math.max(0, store.settings.newPerDay - today().newCards);
    queue = due.map(x => x.c).concat(fresh.slice(0, newLeft));
  }
  return {
    selected, label, ahead, reviews,
    pool, queue,
    relearn: [], // cartes ratées, à revoir dans la séance
    done: 0, again: 0,
    current: null, revealed: false, undo: null,
    poolStats: { due: due.length, fresh: fresh.length, notDue: notDue.length },
  };
}

function nextCard() {
  const s = session;
  const now = Date.now();
  // une carte ratée revient quand ses 10 minutes sont passées, ou au plus tard quand il n'y a plus rien d'autre
  const readyIdx = s.relearn.findIndex(x => x.due <= now);
  if (readyIdx >= 0) return s.relearn.splice(readyIdx, 1)[0].card;
  if (s.queue.length) return s.queue.shift();
  if (s.relearn.length) {
    s.relearn.sort((a, b) => a.due - b.due);
    return s.relearn.shift().card;
  }
  return null;
}

function answer(rating) {
  const s = session;
  const c = s.current;
  const now = new Date();
  const before = store.cards[c.id] ? JSON.parse(JSON.stringify(store.cards[c.id])) : null;
  const dayBefore = Object.assign({}, today());
  const card = stateOf(c.id) || createEmptyCard(now);
  const wasNew = card.state === State.New;
  const { card: next } = scheduler.next(card, now, rating);
  store.cards[c.id] = fromCard(next);
  const d = today();
  d.reviews += 1;
  if (wasNew) d.newCards += 1;
  if (rating === Rating.Again) {
    d.again += 1;
    s.again += 1;
    s.relearn.push({ card: c, due: next.due.getTime() });
  }
  store.log.push({ id: c.id, t: now.toISOString(), g: rating, s: s.label });
  if (store.log.length > 20000) store.log.splice(0, store.log.length - 20000);
  s.done += 1;
  s.undo = { card: c, before, dayBefore, rating, relearnLen: s.relearn.length };
  persist();
  updateBadge();
  s.current = nextCard();
  s.revealed = false;
  render();
}

function undoLast() {
  const s = session;
  if (!s || !s.undo) return;
  const u = s.undo;
  if (u.before) store.cards[u.card.id] = u.before;
  else delete store.cards[u.card.id];
  store.days[dayKey()] = u.dayBefore;
  store.log.pop();
  if (u.rating === Rating.Again) {
    const i = s.relearn.findIndex(x => x.card.id === u.card.id);
    if (i >= 0) s.relearn.splice(i, 1);
    s.again -= 1;
  }
  if (s.current) s.queue.unshift(s.current);
  s.current = u.card;
  s.revealed = true;
  s.done -= 1;
  s.undo = null;
  persist();
  updateBadge();
  render();
}

/* ---------- Interface ---------- */

const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('btn-back');
let view = 'home';
let viewStack = [];
let expanded = new Set();

function go(next, push = true) {
  if (push && view !== next) viewStack.push(view);
  view = next;
  if (next === 'home' && !session && updateReady) return location.reload();
  render();
  window.scrollTo(0, 0);
}

function back() {
  if (view === 'session') session = null;
  view = viewStack.pop() || 'home';
  if (view === 'home' && !session && updateReady) return location.reload();
  render();
}

backBtn.addEventListener('click', back);
document.getElementById('btn-settings').addEventListener('click', () => go('settings'));
document.getElementById('btn-lexicon').addEventListener('click', () => go('lexicon'));

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

function askConfirm(message, okLabel) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">
      <p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="modal-actions"><button id="m-cancel">Annuler</button><button class="primary" id="m-ok">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(box);
    const done = v => { box.remove(); resolve(v); };
    box.querySelector('#m-cancel').onclick = () => done(false);
    box.querySelector('#m-ok').onclick = () => done(true);
    box.querySelector('#m-ok').focus();
  });
}

function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

function bar(s) {
  const pct = x => (s.total ? (100 * x / s.total) : 0).toFixed(1);
  return `<div class="bar" aria-hidden="true">
    <span class="b-mastered" style="width:${pct(s.mastered)}%"></span><span class="b-learning" style="width:${pct(s.learning)}%"></span><span class="b-due" style="width:${pct(s.due)}%"></span>
  </div>`;
}

function render() {
  backBtn.hidden = view === 'home';
  // pas de lexique pendant une séance : chercher la réponse avant de la donner annule l'effet du test
  document.getElementById('btn-lexicon').hidden = view === 'session' || view === 'lexicon';
  const titles = { home: 'Flashcards BCPST', choose: 'Choisir des chapitres', session: 'Entraînement', progress: 'Ma progression', settings: 'Réglages', privacy: 'Données et confidentialité', install: 'Installer l’application', bilan: 'Mon bilan', lexicon: 'Lexique' };
  titleEl.textContent = titles[view] || 'Flashcards BCPST';
  ({ home: renderHome, choose: renderChoose, session: renderSession, progress: renderProgress, settings: renderSettings, privacy: renderPrivacy, install: renderInstall, bilan: renderBilan, lexicon: renderLexicon })[view]();
}

function renderHome() {
  queueSuivi();
  const all = statsFor(deck.cards);
  const openList = openChapters();
  const revs = statsFor(deck.cards.filter(c => inScope(c, openList, true)));
  const started = startedCodes();
  const startedStats = started.length ? statsFor(deck.cards.filter(c => matchesSelection(c, started))) : null;
  const d = today();
  const goal = store.settings.dailyGoal;
  const pct = Math.min(100, Math.round(100 * d.reviews / goal));
  const st = streak();
  const newToday = Math.min(revs.new, Math.max(0, store.settings.newPerDay - d.newCards));
  const lateWarning = d.reviews < goal && new Date().getHours() >= 18;
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${plural(revs.due, 'carte à revoir', 'cartes à revoir')} aujourd’hui</p>
      <p class="muted">${newToday ? `+ ${plural(newToday, 'nouvelle carte disponible', 'nouvelles cartes disponibles')}` : 'Limite de nouvelles cartes atteinte pour aujourd’hui'}</p>
      <div class="goal"><div class="goal-fill" style="width:${pct}%"></div></div>
      <p class="muted">Objectif du jour : ${Math.min(d.reviews, goal)} / ${goal} cartes${st ? ` · ${plural(st, 'jour', 'jours')} d’affilée` : ''}</p>
      ${lateWarning ? `<p class="warn">Il vous reste ${goal - d.reviews} cartes pour atteindre votre objectif du jour.</p>` : ''}
    </section>
    <div class="actions">
      <button class="primary" id="go-all" ${revs.due + newToday ? '' : 'disabled'}>Révisions espacées du jour
        <small>${opened ? `chapitres vus en cours (${plural(opened.chapitres.length, 'partie ou sous-partie', 'parties ou sous-parties')})${openList.includes(METHODS) && methodCards().length ? ' et méthodes' : ''}` : 'tout le programme'}</small></button>
    </div>
    <h2 class="section">Entraînement libre</h2>
    <p class="muted small">N’importe quel chapitre, par exemple pour anticiper une révision. Les cartes commencées ici entrent ensuite dans vos révisions espacées.</p>
    <div class="actions">
      <button id="go-choose">Choisir un ou plusieurs chapitres</button>
      ${store.selection.length ? `<button id="go-last">Reprendre ma dernière sélection <small>(${esc(store.selection.slice(0, 3).join(', '))}${store.selection.length > 3 ? '…' : ''})</small></button>` : ''}
      ${methodCards().length ? `<button id="go-methods">Méthodes et techniques <small>(principe et objectif de ${plural(methodCards().length, 'méthode', 'méthodes')}, tous chapitres)</small></button>` : ''}
      <button id="go-started" ${startedStats ? '' : 'disabled'}>Mes chapitres commencés${startedStats ? ` <small>(${startedStats.due} à revoir)</small>` : ''}</button>
    </div>
    <div class="actions secondary">
      <button id="go-progress">Ma progression</button>
      <button id="go-lexicon">Lexique : chercher une définition</button>
      <button id="go-install">Installer l’application et les rappels</button>
      ${canReport() ? '<button id="go-suggest">Suggérer une amélioration ou faire une demande</button>' : ''}
    </div>
    <p class="muted small">${deck.cards.length} définitions · version ${esc(deck.version)}</p>`;
  document.getElementById('go-all').onclick = () => startSession(openList, 'Révisions espacées', { reviews: true });
  document.getElementById('go-started').onclick = () => startSession(started, 'Mes chapitres commencés');
  document.getElementById('go-choose').onclick = () => go('choose');
  const last = document.getElementById('go-last');
  if (last) last.onclick = () => startSession(store.selection, 'Dernière sélection');
  const methods = document.getElementById('go-methods');
  if (methods) methods.onclick = () => startSession([METHODS], 'Méthodes et techniques');
  document.getElementById('go-progress').onclick = () => go('progress');
  document.getElementById('go-lexicon').onclick = () => go('lexicon');
  document.getElementById('go-install').onclick = () => go('install');
  const suggest = document.getElementById('go-suggest');
  if (suggest) suggest.onclick = openSuggestion;
}

function matchesAny(code, selected) {
  return selected.some(sel => code === sel || code.startsWith(sel + '-'));
}

function chapterTree() {
  // parties -> sous-parties qui ont au moins une carte
  const used = new Set();
  deck.cards.forEach(c => cardCodes(c).forEach(code => used.add(code)));
  const parts = [];
  const seenParts = new Set();
  const addPart = code => {
    if (seenParts.has(code)) return;
    seenParts.add(code);
    const subs = [...used].filter(u => u !== code && partOf(u) === code)
      .sort((a, b) => (chapterOrder[a] ?? 999) - (chapterOrder[b] ?? 999) || a.localeCompare(b));
    parts.push({ code, subs });
  };
  chapters.filter(c => /^[A-Z]{2}-[A-Z]$/.test(c.code)).forEach(c => {
    if ([...used].some(u => partOf(u) === c.code)) addPart(c.code);
  });
  [...used].map(partOf).filter(p => !seenParts.has(p) && p !== NO_CODE).sort().forEach(addPart);
  if (used.has(NO_CODE)) parts.push({ code: NO_CODE, subs: [] });
  return parts;
}

let chooseSel = new Set();

function openTag(code) {
  if (!opened) return '';
  const list = opened.chapitres;
  if (matchesAny(code, list)) return ' <span class="tag-open">vu en cours</span>';
  return list.some(o => o.startsWith(code + '-')) ? ' <span class="tag-open">en partie vu</span>' : '';
}

function renderChoose() {
  if (!chooseSel.size && store.selection.length) chooseSel = new Set(store.selection);
  const tree = chapterTree();
  const groups = { SV: 'Sciences de la vie', BG: 'Biogéosciences', ST: 'Sciences de la Terre', NC: 'Autres' };
  let html = '<p class="muted">Cochez une partie entière ou des sous-parties. Les nombres indiquent les cartes à revoir aujourd’hui et le total.</p>';
  let lastGroup = '';
  for (const p of tree) {
    const g = p.code.slice(0, 2);
    if (g !== lastGroup) { html += `<h2>${groups[g] || ''}</h2>`; lastGroup = g; }
    const cards = deck.cards.filter(c => matchesSelection(c, [p.code]));
    const s = statsFor(cards);
    const checked = chooseSel.has(p.code);
    const open = expanded.has(p.code);
    html += `<div class="chap">
      <label class="row"><input type="checkbox" data-code="${p.code}" ${checked ? 'checked' : ''}>
        <span class="chap-name"><b>${p.code === NO_CODE ? '' : esc(p.code) + ' '}</b>${esc(chapterTitle[p.code] || '')}${openTag(p.code)}</span>
        <span class="count">${s.due ? `<em>${s.due}</em> / ` : ''}${s.total}</span></label>
      ${p.subs.length ? `<button class="link toggle" data-toggle="${p.code}">${open ? 'Masquer' : 'Voir'} les sous-parties (${p.subs.length})</button>` : ''}
      ${bar(s)}
      ${open ? '<div class="subs">' + p.subs.map(code => {
        const sc = statsFor(deck.cards.filter(c => matchesSelection(c, [code])));
        return `<label class="row sub"><input type="checkbox" data-code="${code}" ${checked || chooseSel.has(code) ? 'checked' : ''} ${checked ? 'disabled' : ''}>
          <span class="chap-name"><b>${esc(code)}</b> ${esc(chapterTitle[code] || '')}${openTag(code)}</span>
          <span class="count">${sc.due ? `<em>${sc.due}</em> / ` : ''}${sc.total}</span></label>`;
      }).join('') + '</div>' : ''}
    </div>`;
  }
  const selected = [...chooseSel];
  const selCards = selected.length ? deck.cards.filter(c => matchesSelection(c, selected)) : [];
  const ss = statsFor(selCards);
  html += `<div class="sticky">
    <p>${selected.length ? `${plural(selCards.length, 'carte', 'cartes')} sélectionnées : ${ss.due} à revoir, ${ss.new} nouvelles` : 'Aucun chapitre sélectionné'}</p>
    <button class="primary" id="start" ${selected.length ? '' : 'disabled'}>Commencer</button>
    ${selected.length ? '<button class="link" id="clear">Tout décocher</button>' : ''}
  </div>`;
  app.innerHTML = html;
  app.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = () => {
      const code = cb.dataset.code;
      if (cb.checked) {
        chooseSel.add(code);
        if (!code.includes('-', 3)) [...chooseSel].forEach(x => { if (x !== code && x.startsWith(code + '-')) chooseSel.delete(x); });
      } else chooseSel.delete(code);
      render();
    };
  });
  app.querySelectorAll('[data-toggle]').forEach(b => {
    b.onclick = () => {
      const code = b.dataset.toggle;
      expanded.has(code) ? expanded.delete(code) : expanded.add(code);
      render();
    };
  });
  document.getElementById('start').onclick = () => {
    store.selection = [...chooseSel];
    persist();
    startSession(store.selection, store.selection.join(', '));
  };
  const clear = document.getElementById('clear');
  if (clear) clear.onclick = () => { chooseSel.clear(); render(); };
}

function startSession(selected, label, { ahead = false, reviews = false, offerWarmup = !ahead && !reviews } = {}) {
  session = buildSession(selected, { label, ahead, reviews });
  // l'échauffement précède toujours des flashcards : proposé seulement s'il y a des cartes à faire ensuite
  if (offerWarmup && session.queue.length && session.pool.length >= 4) session.phase = 'intro';
  else session.current = nextCard();
  go('session', view !== 'session');
}

/* ---------- Échauffement par QCM ---------- */

// Définitions interrogées : celles de la séance qui suit, jamais vues ou ratées d'abord, puis le reste du thème.
function pickQcmCards(s, n = QCM_SIZE) {
  const inQueue = new Set(s.queue.map(c => c.id));
  const weak = c => {
    const st = stateOf(c.id);
    return !st || st.state !== State.Review || st.lapses > 0;
  };
  const rank = c => (inQueue.has(c.id) ? 0 : 2) + (weak(c) ? 0 : 1);
  return QCM.shuffle(s.pool).sort((a, b) => rank(a) - rank(b)).slice(0, n);
}

function firstTimeOn(s) {
  const ids = new Set(s.pool.map(c => c.id));
  return !s.pool.some(c => store.cards[c.id] && store.cards[c.id].reps > 0) && !store.qcmLog.some(x => ids.has(x.id));
}

function startQcm() {
  const s = session;
  s.qcm = { items: pickQcmCards(s).map(c => QCM.makeQuestion(c, deck.cards)), i: 0, ok: 0, failed: [], chosen: null };
  s.phase = 'qcm';
  render();
}

// Une erreur au QCM compte comme « Raté » pour l'algorithme ; une bonne réponse ne compte pas comme « Su » :
// reconnaître un terme parmi quatre ne prouve pas qu'on saurait retrouver la définition.
function qcmChoose(k) {
  const s = session;
  const Q = s.qcm;
  const q = Q.items[Q.i];
  if (Q.chosen !== null) return;
  Q.chosen = k;
  const ok = q.options[k].id === q.card.id;
  const now = new Date();
  store.qcmLog.push({ id: q.card.id, t: now.toISOString(), ok: ok ? 1 : 0, pick: q.options[k].id });
  if (store.qcmLog.length > 5000) store.qcmLog.splice(0, store.qcmLog.length - 5000);
  if (ok) Q.ok += 1;
  else {
    Q.failed.push(q.card);
    const card = stateOf(q.card.id) || createEmptyCard(now);
    if (card.state === State.New) today().newCards += 1;
    store.cards[q.card.id] = fromCard(scheduler.next(card, now, Rating.Again).card);
  }
  persist();
  updateBadge();
  render();
}

function qcmNext() {
  const Q = session.qcm;
  Q.i += 1;
  Q.chosen = null;
  if (Q.i >= Q.items.length) session.phase = 'qcmEnd';
  render();
  window.scrollTo(0, 0);
}

function qcmToCards() {
  const old = session;
  const failed = old.qcm.failed;
  const failedIds = new Set(failed.map(c => c.id));
  session = buildSession(old.selected, { label: old.label, reviews: old.reviews });
  // les définitions ratées au QCM reviennent après leur délai de 10 minutes, comme une carte ratée en séance
  session.queue = session.queue.filter(c => !failedIds.has(c.id));
  for (const c of failed) session.relearn.push({ card: c, due: stateOf(c.id).due.getTime() });
  session.phase = 'cards';
  session.current = nextCard();
  render();
  window.scrollTo(0, 0);
}

function renderWarmupIntro(s) {
  const first = firstTimeOn(s);
  const n = Math.min(QCM_SIZE, s.pool.length);
  const qcmBtn = `<button class="${first ? 'primary' : ''}" id="qcm-go">S’échauffer avec ${n} QCM, puis les flashcards</button>`;
  const cardsBtn = `<button class="${first ? '' : 'primary'}" id="cards-go">Commencer directement les flashcards</button>`;
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${first ? 'Première fois sur ce thème' : 'Avant les flashcards'}</p>
      <p>${first
        ? 'Nous vous conseillons de commencer par un échauffement : pour chaque définition, retrouvez le terme parmi quatre propositions.'
        : 'Vous pouvez vous échauffer : pour chaque définition, retrouvez le terme parmi quatre propositions.'}</p>
    </section>
    <div class="actions">${first ? qcmBtn + cardsBtn : cardsBtn + qcmBtn}</div>
    <p class="muted small">Le QCM ne remplace pas les flashcards : elles suivent toujours l’échauffement.</p>`;
  document.getElementById('qcm-go').onclick = startQcm;
  document.getElementById('cards-go').onclick = () => {
    s.phase = 'cards';
    s.current = nextCard();
    render();
  };
}

function renderQcm(s) {
  const Q = s.qcm;
  const q = Q.items[Q.i];
  const answered = Q.chosen !== null;
  const picked = answered ? q.options[Q.chosen] : null;
  const ok = answered && picked.id === q.card.id;
  const last = Q.i + 1 >= Q.items.length;
  app.innerHTML = `
    <div class="progress-line"><span>Échauffement${s.label ? ' · ' + esc(s.label) : ''}</span><span>Question ${Q.i + 1} / ${Q.items.length}</span></div>
    <article class="flash qcm">
      ${answered && canReport() ? reportButton() : ''}
      <p class="hint muted">${answered ? esc(q.card.term) : 'Quel terme correspond à cette définition ?'}</p>
      <p class="def">${esc(answered ? q.card.def : q.def)}</p>
    </article>
    <div class="options">${q.options.map((o, k) => {
      const cls = !answered ? '' : o.id === q.card.id ? 'right' : k === Q.chosen ? 'wrong' : 'dim';
      return `<button class="opt ${cls}" data-k="${k}" ${answered ? 'disabled' : ''}><small>${k + 1}</small>${esc(o.term.replace(FACET, ''))}</button>`;
    }).join('')}</div>
    ${answered ? `<div class="feedback ${ok ? 'ok' : 'ko'}">
      ${ok ? '<p><b>Bonne réponse.</b></p>'
        : `<p><b>La bonne réponse est « ${esc(q.card.term)} ».</b></p><p>Vous avez choisi « ${esc(picked.term.replace(FACET, ''))} »${picked.def ? ` : ${esc(picked.def)}` : '.'}</p>`}
    </div>
    <button class="primary wide" id="qcm-next">${last ? 'Voir mon score' : 'Question suivante'} <small>Entrée</small></button>` : ''}`;
  app.querySelectorAll('.opt').forEach(b => { b.onclick = () => qcmChoose(Number(b.dataset.k)); });
  const next = document.getElementById('qcm-next');
  if (next) { next.onclick = qcmNext; next.focus({ preventScroll: true }); }
  const rep = app.querySelector('.report-btn');
  if (rep) rep.onclick = () => openReport(q.card, 'qcm', { propositions: q.options.map(o => o.term), choisi: picked.term });
}

function renderQcmEnd(s) {
  const Q = s.qcm;
  const n = Q.items.length;
  const nf = Q.failed.length;
  const verdict = Q.ok >= 0.8 * n ? 'Plutôt réussi.'
    : Q.ok >= 0.5 * n ? 'Résultat moyen : plusieurs définitions sont encore fragiles.'
      : 'Ces définitions ne sont pas encore connues. C’est normal au début d’un thème.';
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${Q.ok} / ${n} bonnes réponses</p>
      <p>${verdict}</p>
    </section>
    <section class="card">
      <p>Reconnaître le bon terme parmi quatre est plus facile que retrouver une définition de mémoire : <b>ce score ne suffit pas à dire que vous savez ces définitions.</b> Les flashcards du thème vont le vérifier.</p>
      ${nf ? `<p class="muted">${nf > 1 ? `Les ${nf} définitions ratées reviendront` : 'La définition ratée reviendra'} en flashcard dans une dizaine de minutes.</p>` : ''}
    </section>
    <button class="primary wide" id="to-cards">Passer aux flashcards <small>Entrée</small></button>`;
  const b = document.getElementById('to-cards');
  b.onclick = qcmToCards;
  b.focus();
}

function ratingButtons(keysOk = true) {
  const off = keysOk ? '' : 'disabled title="Cochez d’abord tous les éléments-clés"';
  if (store.settings.buttons === 4) {
    return `<div class="grade four">
      <button class="again" data-r="${Rating.Again}">Raté<small>1</small></button>
      <button class="hard" data-r="${Rating.Hard}" ${off}>Difficile<small>2</small></button>
      <button class="good" data-r="${Rating.Good}" ${off}>Su<small>3</small></button>
      <button class="easy" data-r="${Rating.Easy}" ${off}>Facile<small>4</small></button></div>`;
  }
  return `<div class="grade">
    <button class="again" data-r="${Rating.Again}">Raté<small>1</small></button>
    <button class="good" data-r="${Rating.Good}" ${off}>Su<small>2</small></button></div>
    ${keysOk ? '' : '<p class="muted small center">« Su » s’active quand tous les éléments-clés sont cochés.</p>'}`;
}

function renderSession() {
  const s = session;
  if (!s) return go('home', false);
  if (s.phase === 'intro') return renderWarmupIntro(s);
  if (s.phase === 'qcm') return renderQcm(s);
  if (s.phase === 'qcmEnd') return renderQcmEnd(s);
  if (!s.current) {
    const ahead = s.ahead;
    const endDay = endOfStudyDay();
    const notDue = deck.cards.filter(c => {
      const st = stateOf(c.id);
      return st && st.state !== State.New && st.due > endDay && inScope(c, s.selected, s.reviews);
    }).length;
    s.poolStats.notDue = notDue;
    app.innerHTML = `<section class="card hero">
      <p class="big">${s.done ? 'Séance terminée' : 'Rien à revoir pour l’instant'}</p>
      ${s.done ? `<p>${plural(s.done, 'réponse', 'réponses')}${s.again ? `, dont ${plural(s.again, 'carte ratée', 'cartes ratées')} et revues dans la séance` : ', aucune ratée'}.</p>` : ''}
      ${!s.done && !ahead ? `<p class="muted">Toutes les cartes de cette sélection sont à jour${s.poolStats.fresh ? ' et la limite de nouvelles cartes du jour est atteinte' : ''}.</p>` : ''}
    </section>
    <div class="actions">
      ${s.poolStats.notDue ? '<button id="ahead">Réviser en avance (les cartes les moins sûres)</button>' : ''}
      <button class="primary" id="home">Retour à l’accueil</button>
    </div>
    ${s.poolStats.notDue ? '<p class="muted small">Réviser en avance ne fausse pas le calendrier : une carte revue trop tôt est simplement moins repoussée.</p>' : ''}`;
    const a = document.getElementById('ahead');
    if (a) a.onclick = () => startSession(s.selected, s.label, { ahead: true, reviews: s.reviews });
    document.getElementById('home').onclick = () => { session = null; viewStack = []; go('home', false); };
    return;
  }
  const c = s.current;
  const st = stateOf(c.id);
  const left = s.queue.length + s.relearn.length + 1;
  const tag = !st || st.state === State.New ? '<span class="tag new">nouvelle</span>'
    : (st.state === State.Relearning || st.state === State.Learning) ? '<span class="tag again">à retravailler</span>' : '';
  app.innerHTML = `
    <div class="progress-line"><span>${s.label ? esc(s.label) : ''}${s.ahead ? ' · en avance' : ''}</span><span>${left} restantes</span></div>
    <article class="flash ${s.revealed ? 'revealed' : ''}">
      ${s.revealed && canReport() ? reportButton() : ''}
      <div class="codes">${cardCodes(c).map(x => `<span>${esc(x === NO_CODE ? 'sans chapitre' : x)}</span>`).join('')}${c.method ? '<span>méthode</span>' : ''} ${tag}</div>
      <h2 class="term">${esc(c.term)}</h2>
      ${s.revealed ? `<p class="def">${defWithKeys(c)}</p>${keyChecklist(c, s)}` : '<p class="hint muted">Formulez la définition de tête (ou à l’écrit), puis retournez la carte.</p>'}
    </article>
    ${s.revealed ? ratingButtons(keysDone(c, s)) : '<button class="primary reveal" id="reveal">Voir la définition <small>Espace</small></button>'}
    ${s.undo ? '<button class="link undo" id="undo">Annuler la dernière réponse</button>' : ''}`;
  const r = document.getElementById('reveal');
  if (r) r.onclick = () => { s.revealed = true; render(); };
  app.querySelectorAll('[data-r]').forEach(b => { b.onclick = () => answer(Number(b.dataset.r)); });
  const u = document.getElementById('undo');
  if (u) u.onclick = undoLast;
  const rep = app.querySelector('.report-btn');
  if (rep) rep.onclick = () => openReport(c, 'flashcard');
  app.querySelectorAll('[data-key]').forEach(cb => {
    cb.onchange = () => { s.keysOk[Number(cb.dataset.key)] = cb.checked; render(); };
  });
}

/* ---------- Mots-clés à vérifier au verso ----------
   L'élève coche les éléments-clés qu'il a cités ; « Su » n'est possible que s'il les a tous.
   Comparer sa réponse à des éléments précis corrige la tendance à se juger trop vite (Dunlosky et Rawson, 2012). */

function defWithKeys(c) {
  if (!c.keys) return esc(c.def);
  let html = '';
  let pos = 0;
  for (const [a, b] of QCM.findSpans(c.def, c.keys)) {
    html += esc(c.def.slice(pos, a)) + '<mark>' + esc(c.def.slice(a, b)) + '</mark>';
    pos = b;
  }
  return html + esc(c.def.slice(pos));
}

function keyChecklist(c, s) {
  if (!c.keys) return '';
  if (s.keysFor !== c.id) { s.keysFor = c.id; s.keysOk = []; }
  return `<fieldset class="keys"><legend>Cochez ce que vous aviez cité :</legend>
    ${c.keys.map((k, i) => `<label><input type="checkbox" data-key="${i}" ${s.keysOk[i] ? 'checked' : ''}> ${esc(k)}</label>`).join('')}
  </fieldset>`;
}

function keysDone(c, s) {
  return !c.keys || (s.keysFor === c.id && c.keys.every((k, i) => s.keysOk[i]));
}

document.addEventListener('keydown', e => {
  if (view !== 'session' || !session || e.target.tagName === 'INPUT' || document.querySelector('.modal')) return;
  if (session.phase === 'qcm') {
    const Q = session.qcm;
    if (Q.chosen === null && /^[1-4]$/.test(e.key) && Number(e.key) <= Q.items[Q.i].options.length) { e.preventDefault(); qcmChoose(Number(e.key) - 1); }
    else if (Q.chosen !== null && e.key === 'Enter') { e.preventDefault(); qcmNext(); }
    return;
  }
  if (session.phase === 'qcmEnd' && e.key === 'Enter') { e.preventDefault(); qcmToCards(); return; }
  if (!session.current) return;
  if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    session.revealed = true;
    render();
    return;
  }
  if (session.revealed) {
    const map = store.settings.buttons === 4
      ? { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy }
      : { 1: Rating.Again, 2: Rating.Good };
    if (map[e.key] && (map[e.key] === Rating.Again || keysDone(session.current, session))) { e.preventDefault(); answer(map[e.key]); }
  }
});

function renderProgress() {
  const tree = chapterTree();
  const all = statsFor(deck.cards);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const revs = k => (store.days[k] ? store.days[k].reviews : 0);
  const maxRev = Math.max(1, ...days.map(revs));
  const anyDay = days.some(k => revs(k) > 0);
  let html = `${suiviCard()}<button class="${store.settings.suiviCode ? '' : 'primary '}wide" id="go-bilan">Préparer mon bilan pour le professeur</button>
  <section class="card">
    <div class="legend"><span class="l-mastered">acquises</span><span class="l-learning">en cours</span><span class="l-due">à revoir</span><span class="l-new">jamais vues</span></div>
    <p><b>Tout le programme</b> : ${all.mastered} acquises, ${all.learning} en cours, ${all.due} à revoir, ${all.new} jamais vues.</p>
    ${bar(all)}
  </section>`;
  if (anyDay) {
    html += `<section class="card"><h2>Réponses des 14 derniers jours</h2><div class="hist">${days.map(k => {
      const n = revs(k);
      return `<div class="hcol" title="${k} : ${n} réponses"><small>${n || ''}</small><div class="hbar" style="height:${Math.round(80 * n / maxRev)}%"></div><span>${Number(k.slice(8))}</span></div>`;
    }).join('')}</div></section>`;
  }
  html += '<section class="card"><h2>Par partie</h2>';
  for (const p of tree) {
    const s = statsFor(deck.cards.filter(c => matchesSelection(c, [p.code])));
    html += `<div class="prow"><div class="row"><span class="chap-name"><b>${p.code === NO_CODE ? '' : esc(p.code)}</b> ${esc(chapterTitle[p.code] || '')}</span><span class="count">${s.seen}/${s.total} vues</span></div>${bar(s)}</div>`;
  }
  html += '</section>';
  const hard = mostFailed(store.log).slice(0, 10);
  if (hard.length) {
    html += `<section class="card"><h2>Les définitions que vous ratez le plus</h2><ol class="hard">${hard.map(x => `<li><b>${esc(x.c.term)}</b> <span class="muted">(${plural(x.n, 'fois', 'fois')})</span></li>`).join('')}</ol></section>`;
  }
  app.innerHTML = html;
  bindSuivi(renderProgress);
  document.getElementById('go-bilan').onclick = () => go('bilan');
}

/* ---------- Signalement d'une erreur ---------- */

// Le signalement part vers l'adresse configurée dans config.json (script Google de l'enseignant, qui range le signalement dans son tableur).
// L'élève ne voit pas le destinataire. Hors connexion, il est gardé et envoyé plus tard.
const canReport = () => !!config.signalement;
const reportButton = () => '<button class="report-btn" aria-label="Signaler une erreur" title="Signaler une erreur">&#9888;&#xFE0E;</button>';

const REPORT_TYPES = {
  definition: 'Erreur dans la définition',
  coquille: 'Coquille (orthographe, formulation)',
  qcm: 'Question ambiguë (plusieurs bonnes réponses)',
  autre: 'Autre',
};

function openReport(card, context, extra = {}) {
  const types = Object.keys(REPORT_TYPES).filter(k => k !== 'qcm' || context === 'qcm');
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<form class="modal-box report-box" role="dialog" aria-modal="true" aria-labelledby="rep-title">
    <h2 id="rep-title">Signaler un problème</h2>
    <p class="muted">Définition de <b>${esc(card.term)}</b></p>
    <fieldset>${types.map(k => `<label class="radio"><input type="radio" name="rep-type" value="${k}"> ${esc(REPORT_TYPES[k])}</label>`).join('')}</fieldset>
    <label><span id="rep-label">Précisez si vous le souhaitez (facultatif)</span><input type="text" id="rep-text" maxlength="300" autocomplete="off"></label>
    <div class="modal-actions"><button type="button" id="rep-cancel">Annuler</button><button class="primary" id="rep-send" disabled>Envoyer</button></div>
  </form>`;
  document.body.appendChild(box);
  const form = box.querySelector('form');
  const text = box.querySelector('#rep-text');
  const send = box.querySelector('#rep-send');
  const type = () => (form.querySelector('input[name=rep-type]:checked') || {}).value;
  const check = () => {
    const autre = type() === 'autre';
    box.querySelector('#rep-label').textContent = autre ? 'Précisez ce qui ne va pas' : 'Précisez si vous le souhaitez (facultatif)';
    send.disabled = !type() || (autre && !text.value.trim());
  };
  form.addEventListener('change', check);
  text.addEventListener('input', check);
  const before = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); if (before && before.isConnected) before.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('#rep-cancel').onclick = close;
  form.onsubmit = async e => {
    e.preventDefault();
    if (send.disabled) return;
    store.pendingReports.push(Object.assign({
      terme: card.term,
      id: card.id,
      definition: card.def,
      codes: card.codes.join(', '),
      type: REPORT_TYPES[type()],
      precision: text.value.trim(),
      contexte: { flashcard: 'flashcard', qcm: 'QCM d’échauffement', lexique: 'lexique' }[context] || context,
      version: deck.version,
      date: new Date().toISOString(),
    }, extra));
    persist();
    close();
    toast(await flushReports() ? 'Merci, votre signalement a été transmis.' : 'Pas de connexion : votre signalement sera transmis dès que possible.');
  };
}

const SUGGESTION_TYPES = {
  amelioration: 'Amélioration de l’application',
  demande: 'Demande (définition ou chapitre à ajouter, autre)',
  bug: 'Problème technique',
};

// Suggestion ou demande sur l'application : même circuit que les signalements, rangée à part dans le tableur.
function openSuggestion() {
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<form class="modal-box report-box" role="dialog" aria-modal="true" aria-labelledby="sug-title">
    <h2 id="sug-title">Suggestion ou demande</h2>
    <fieldset>${Object.keys(SUGGESTION_TYPES).map(k => `<label class="radio"><input type="radio" name="sug-type" value="${k}"> ${esc(SUGGESTION_TYPES[k])}</label>`).join('')}</fieldset>
    <label>Votre message<textarea id="sug-text" rows="5" maxlength="1000"></textarea></label>
    <div class="modal-actions"><button type="button" id="sug-cancel">Annuler</button><button class="primary" id="sug-send" disabled>Envoyer</button></div>
  </form>`;
  document.body.appendChild(box);
  const form = box.querySelector('form');
  const text = box.querySelector('#sug-text');
  const send = box.querySelector('#sug-send');
  const type = () => (form.querySelector('input[name=sug-type]:checked') || {}).value;
  const check = () => { send.disabled = !type() || !text.value.trim(); };
  form.addEventListener('change', check);
  text.addEventListener('input', check);
  const before = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); if (before && before.isConnected) before.focus(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.querySelector('#sug-cancel').onclick = close;
  form.onsubmit = async e => {
    e.preventDefault();
    if (send.disabled) return;
    store.pendingReports.push({
      nature: 'suggestion',
      type: SUGGESTION_TYPES[type()],
      message: text.value.trim(),
      terme: 'Suggestion', precision: text.value.trim(), // lisibles aussi par un script pas encore mis à jour
      version: deck.version,
      date: new Date().toISOString(),
    });
    persist();
    close();
    toast(await flushReports() ? 'Merci, votre message a été transmis.' : 'Pas de connexion : votre message sera transmis dès que possible.');
  };
}

let flushing = null;
function flushReports() {
  if (!flushing) {
    flushing = (async () => {
      while (store.pendingReports.length && canReport()) {
        const item = store.pendingReports[0];
        try {
          // no-cors : la réponse du script n'est pas lisible, seule une panne réseau est détectée ;
          // keepalive : l'envoi aboutit même si l'élève ferme l'application juste après
          await fetch(config.signalement, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(item) });
        } catch (e) {
          return false;
        }
        // la file a pu changer pendant l'envoi (bilan de suivi remplacé) : on retire l'élément envoyé, pas le premier
        const k = store.pendingReports.indexOf(item);
        if (k >= 0) store.pendingReports.splice(k, 1);
        persist();
      }
      return true;
    })().finally(() => { flushing = null; });
  }
  return flushing;
}

window.addEventListener('online', () => flushReports());

/* ---------- Suivi par l'enseignant ----------
   Avec un code de suivi (donné par l'enseignant), le bilan part automatiquement vers son tableur, sous ce code et
   sans le nom de l'élève : seul l'enseignant sait à qui correspond chaque code, et cette liste ne va jamais en ligne. */

const SUIVI_CODE = /^[A-Z0-9-]{4,20}$/;
const SUIVI_GAP = 10 * 60e3; // au plus un envoi toutes les 10 minutes
// config.json « suivi »: true une fois le script de l'enseignant à jour (il range les bilans dans l'onglet « Suivi »)
const canSuivi = () => canReport() && config.suivi === true;
const suiviOn = () => !!store.settings.suiviCode && canSuivi();

function queueSuivi(force = false) {
  if (!suiviOn()) return;
  const last = store.suivi || {};
  if (!force && (last.n === store.log.length || Date.now() - (last.t ? Date.parse(last.t) : 0) < SUIVI_GAP)) return;
  // un seul bilan en attente : le plus récent remplace le précédent
  store.pendingReports = store.pendingReports.filter(x => x.nature !== 'suivi');
  const bilan = buildBilan(store.settings.suiviCode);
  // une cellule du tableur contient au plus 50 000 caractères : on espace les points anciens de l'évolution si besoin
  while (JSON.stringify(bilan).length > 40000 && bilan.evolution.length > 8) {
    bilan.evolution = bilan.evolution.filter((x, i, a) => i % 2 === 1 || i >= a.length - 4);
  }
  store.pendingReports.push({ nature: 'suivi', code: store.settings.suiviCode, bilan });
  store.suivi = { t: new Date().toISOString(), n: store.log.length };
  persist();
  flushReports();
}

function suiviCard() {
  if (!canSuivi()) return '';
  const code = store.settings.suiviCode;
  if (code) {
    const t = store.suivi && store.suivi.t;
    return `<section class="card form" id="suivi">
      <h2>Suivi par votre professeur : activé</h2>
      <p>Votre bilan est envoyé automatiquement à votre professeur après vos séances, sous le code <b>${esc(code)}</b>, <b>sans votre nom</b>.${t ? ` Dernier envoi : ${esc(new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}.` : ''}</p>
      <div class="actions"><button id="suivi-now">Envoyer mon bilan maintenant</button><button id="suivi-stop">Arrêter le suivi</button></div>
    </section>`;
  }
  return `<section class="card form" id="suivi">
    <h2>Suivi par votre professeur (facultatif)</h2>
    <p>Si votre professeur vous a remis un code de suivi, saisissez-le : votre bilan lui sera envoyé automatiquement après vos séances, sous ce code et <b>sans votre nom</b>. Le suivi est facultatif et peut être arrêté à tout moment.</p>
    <label>Code de suivi <input type="text" id="suivi-code" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    <button class="primary" id="suivi-start">Activer le suivi</button>
  </section>`;
}

function bindSuivi(rerender) {
  const start = document.getElementById('suivi-start');
  if (start) start.onclick = () => {
    const input = document.getElementById('suivi-code');
    const code = input.value.trim().toUpperCase().replace(/\s+/g, '');
    if (!SUIVI_CODE.test(code)) { toast('Code de suivi non valide : 4 à 20 lettres ou chiffres, comme votre professeur vous l’a remis.'); input.focus(); return; }
    store.settings.suiviCode = code;
    persist();
    queueSuivi(true);
    toast('Suivi activé : votre bilan part vers votre professeur.');
    rerender();
  };
  const now = document.getElementById('suivi-now');
  if (now) now.onclick = async () => {
    queueSuivi(true);
    toast(await flushReports() ? 'Bilan envoyé.' : 'Pas de connexion : votre bilan partira dès que possible.');
    rerender();
  };
  const stop = document.getElementById('suivi-stop');
  if (stop) stop.onclick = () => {
    if (!confirm('Arrêter l’envoi automatique de votre bilan ? Votre professeur garde le dernier bilan reçu et sera informé de l’arrêt.')) return;
    // le professeur est prévenu de l'arrêt : sa ligne du tableur change de couleur
    store.pendingReports = store.pendingReports.filter(x => x.nature !== 'suivi');
    store.pendingReports.push({ nature: 'suivi-arret', code: store.settings.suiviCode });
    store.settings.suiviCode = '';
    persist();
    flushReports();
    rerender();
  };
}

/* ---------- Lexique ---------- */

let lexQuery = '';
let lexOpenParts = new Set();
let lexShown = ''; // code dont la liste des termes est affichée

const byTerm = (a, b) => a.term.localeCompare(b.term, 'fr', { sensitivity: 'base' });

// Termes qui correspondent à la saisie : début du terme, puis début d'un mot, puis n'importe où.
function lexSuggest(query, max = 8) {
  const q = normTerm(query);
  if (!q) return [];
  const rank = c => {
    const t = c.id;
    if (t.startsWith(q)) return 0;
    if (t.split(/[\s'-]+/).some(w => w.startsWith(q))) return 1;
    return t.includes(q) ? 2 : 3;
  };
  return deck.cards.map(c => [rank(c), c]).filter(([r]) => r < 3)
    .sort((a, b) => a[0] - b[0] || a[1].term.length - b[1].term.length || byTerm(a[1], b[1]))
    .slice(0, max).map(([, c]) => c);
}

function showDefinition(card) {
  const box = document.createElement('div');
  box.className = 'modal';
  const codes = cardCodes(card).map(code => `<li><b>${code === NO_CODE ? '' : esc(code)}</b> ${esc(chapterTitle[code] || chapterTitle[partOf(code)] || '')}</li>`).join('');
  box.innerHTML = `<div class="modal-box def-box" role="dialog" aria-modal="true" aria-labelledby="def-term">
    <h2 id="def-term">${esc(card.term)}</h2>
    <p>${esc(card.def).replace(/\n/g, '<br>')}</p>
    <ul class="def-codes muted small">${codes}</ul>
    ${canReport() ? reportButton() : ''}
    <button class="primary wide" id="def-close">Fermer</button></div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.report-box')) close(); };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', e => { if (e.target === box) close(); });
  box.querySelector('#def-close').onclick = close;
  box.querySelector('#def-close').focus();
  const rep = box.querySelector('.report-btn');
  if (rep) rep.onclick = () => openReport(card, 'lexique');
}

function termList(code) {
  const cards = deck.cards.filter(c => matchesSelection(c, [code])).sort(byTerm);
  return `<ul class="terms">${cards.map(c => `<li><button class="term" data-id="${esc(c.id)}">${esc(c.term)}</button></li>`).join('')}</ul>`;
}

function renderLexicon() {
  const tree = chapterTree();
  const count = code => deck.cards.filter(c => matchesSelection(c, [code])).length;
  const item = (code, label) => `<button class="lex-item ${lexShown === code ? 'open' : ''}" data-show="${code}">
      <span class="chap-name">${label}</span><span class="count">${count(code)}</span></button>
    ${lexShown === code ? termList(code) : ''}`;
  let html = `<div class="lex-search" role="combobox" aria-expanded="false" aria-owns="lex-sugg" aria-haspopup="listbox">
      <input type="search" id="lex-q" placeholder="Tapez un terme…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Chercher un terme" aria-controls="lex-sugg" value="${esc(lexQuery)}">
      <ul id="lex-sugg" class="sugg" role="listbox" hidden></ul>
    </div>
    <h2>Sommaire</h2>
    <p class="muted small">Touchez une partie pour voir ses sous-parties, puis un titre pour voir ses termes par ordre alphabétique.</p>`;
  for (const p of tree) {
    const title = `<b>${p.code === NO_CODE ? '' : esc(p.code)}</b> ${esc(chapterTitle[p.code] || '')}`;
    if (!p.subs.length) { html += `<div class="chap">${item(p.code, title)}</div>`; continue; }
    const open = lexOpenParts.has(p.code);
    html += `<div class="chap"><button class="lex-item" data-part="${p.code}" aria-expanded="${open}">
        <span class="chap-name">${title}</span><span class="count">${count(p.code)} ${open ? '▾' : '▸'}</span></button>
      ${open ? `<div class="subs">${item(p.code, 'Tous les termes de la partie')}${p.subs.map(code => item(code, `<b>${esc(code)}</b> ${esc(chapterTitle[code] || '')}`)).join('')}</div>` : ''}
    </div>`;
  }
  app.innerHTML = html;

  const byId = new Map(deck.cards.map(c => [c.id, c]));
  app.querySelectorAll('[data-part]').forEach(b => {
    b.onclick = () => { const c = b.dataset.part; lexOpenParts.has(c) ? lexOpenParts.delete(c) : lexOpenParts.add(c); render(); };
  });
  app.querySelectorAll('[data-show]').forEach(b => {
    b.onclick = () => { lexShown = lexShown === b.dataset.show ? '' : b.dataset.show; render(); };
  });
  app.querySelectorAll('.term').forEach(b => { b.onclick = () => showDefinition(byId.get(b.dataset.id)); });

  const input = document.getElementById('lex-q');
  const list = document.getElementById('lex-sugg');
  let items = [];
  let active = -1;
  const paint = () => {
    list.innerHTML = items.length
      ? items.map((c, i) => `<li role="option" id="sg-${i}" data-i="${i}" aria-selected="${i === active}">${esc(c.term)}</li>`).join('')
      : (input.value.trim() ? '<li class="none">Aucun terme trouvé</li>' : '');
    list.hidden = !input.value.trim();
    input.setAttribute('aria-activedescendant', active >= 0 ? `sg-${active}` : '');
  };
  const pick = c => { if (!c) return; input.value = c.term; lexQuery = c.term; items = []; paint(); list.hidden = true; showDefinition(c); };
  input.oninput = () => { lexQuery = input.value; items = lexSuggest(input.value); active = -1; paint(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[active] || items[0]); }
  };
  // pointerdown plutôt que click : la liste ne disparaît pas avant que le choix soit pris en compte
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pick(items[Number(li.dataset.i)]); }
  });
  if (lexQuery) { items = lexSuggest(lexQuery); paint(); list.hidden = true; }
  input.onfocus = () => { if (input.value.trim()) { items = lexSuggest(input.value); paint(); } };
}

/* ---------- Bilan pour l'enseignant ---------- */

// Définitions classées par nombre de réponses « Raté » dans les entrées du journal données.
function mostFailed(entries) {
  const byId = new Map(deck.cards.map(c => [c.id, c]));
  const count = new Map();
  for (const r of entries) if (r.g === Rating.Again && byId.has(r.id)) count.set(r.id, (count.get(r.id) || 0) + 1);
  return [...count].map(([id, n]) => ({ c: byId.get(id), n })).sort((a, b) => b.n - a.n || a.c.term.localeCompare(b.c.term, 'fr'));
}

// Évolution, à chaque fin de semaine (dimanche soir) et aujourd'hui : nombre de cartes sues (dernière réponse autre
// que « Raté ») et de cartes ratées (dernière réponse « Raté »), au total et par partie du programme. Des nombres de
// cartes, et non des pourcentages, pour que l'ajout de nouvelles définitions ne fausse pas la lecture.
function evolution(byId, partsOf, now) {
  if (!store.log.length) return [];
  const ends = [];
  const d = new Date(store.log[0].t);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // premier dimanche
  d.setHours(23, 59, 59, 999);
  while (d < now) { ends.push(new Date(d)); d.setDate(d.getDate() + 7); }
  ends.push(now);
  const last = new Map();
  const points = [];
  let k = 0;
  for (const end of ends.slice(-52)) { // une année au plus
    while (k < store.log.length && Date.parse(store.log[k].t) <= end.getTime()) { last.set(store.log[k].id, store.log[k].g); k += 1; }
    const p = { d: dayKey(end), s: 0, r: 0, t: {} };
    for (const [id, g] of last) {
      const c = byId.get(id);
      if (!c) continue;
      const failedNow = g === Rating.Again;
      if (failedNow) p.r += 1; else p.s += 1;
      for (const code of partsOf(c)) {
        const x = p.t[code] || (p.t[code] = [0, 0]);
        x[failedNow ? 1 : 0] += 1;
      }
    }
    points.push(p);
  }
  return points;
}

function buildBilan(name) {
  const now = new Date();
  const since = d => now.getTime() - d * 864e5;
  const recent = store.log.filter(x => Date.parse(x.t) >= since(30));
  const week = recent.filter(x => Date.parse(x.t) >= since(7));
  const activeDays = n => Object.keys(store.days).filter(k => store.days[k].reviews > 0 && k >= dayKey(new Date(since(n)))).length;
  const byId = new Map(deck.cards.map(c => [c.id, c]));
  const endDay = endOfStudyDay(now);
  const chap = {};
  // regroupement par partie du programme (SV-A, BG-C…) : les codes des cartes n'ont pas tous la même précision
  const partsOf = c => [...new Set(cardCodes(c).map(partOf))];
  for (const c of deck.cards) {
    const status = cardStatus(c, now, endDay);
    for (const code of partsOf(c)) {
      const x = chap[code] || (chap[code] = { code, total: 0, vues: 0, acquises: 0, a_revoir: 0, reponses_30j: 0, ratees_30j: 0, reponses_total: 0, ratees_total: 0 });
      x.total += 1;
      if (status !== 'new') x.vues += 1;
      if (status === 'mastered') x.acquises += 1;
      if (status === 'due') x.a_revoir += 1;
    }
  }
  const start30 = since(30);
  for (const r of store.log) { // depuis le début (l'historique garde les 20 000 dernières réponses)
    const c = byId.get(r.id);
    if (!c) continue;
    const in30 = Date.parse(r.t) >= start30;
    for (const code of partsOf(c)) {
      chap[code].reponses_total += 1;
      if (r.g === Rating.Again) chap[code].ratees_total += 1;
      if (in30) {
        chap[code].reponses_30j += 1;
        if (r.g === Rating.Again) chap[code].ratees_30j += 1;
      }
    }
  }
  const evo = evolution(byId, partsOf, now);
  const today = evo.length ? evo[evo.length - 1] : { s: 0, r: 0, t: {} };
  for (const x of Object.values(chap)) [x.cartes_sues, x.cartes_ratees] = today.t[x.code] || [0, 0];
  const all = statsFor(deck.cards);
  const jours = {};
  Object.keys(store.days).filter(k => k >= dayKey(new Date(since(30)))).sort()
    .forEach(k => { jours[k] = store.days[k].reviews; });
  return {
    app: 'flashcards-bcpst-bilan',
    v: 3,
    nom: name,
    genere: now.toISOString(),
    definitions: deck.version,
    resume: {
      reponses_7j: week.length,
      reponses_30j: recent.length,
      ratees_30j: recent.filter(x => x.g === Rating.Again).length,
      jours_actifs_7j: activeDays(7),
      jours_actifs_30j: activeDays(30),
      serie: streak(),
      cartes_sues: today.s,
      cartes_ratees: today.r,
      reponses_total: store.log.length,
      ratees_total: store.log.filter(x => x.g === Rating.Again).length,
      jours_actifs_total: Object.keys(store.days).filter(k => store.days[k].reviews > 0).length,
      premiere_utilisation: store.log.length ? store.log[0].t : null,
      derniere_utilisation: store.log.length ? store.log[store.log.length - 1].t : null,
      cartes_vues: all.seen,
      cartes_acquises: all.mastered,
      cartes_a_revoir: all.due,
      cartes_total: all.total,
    },
    chapitres: Object.values(chap).filter(x => x.vues > 0)
      .sort((a, b) => (chapterOrder[a.code] ?? 9999) - (chapterOrder[b.code] ?? 9999) || a.code.localeCompare(b.code)),
    plus_ratees: mostFailed(recent).slice(0, 20).map(x => ({ terme: x.c.term, ratees: x.n })),
    plus_ratees_total: mostFailed(store.log).slice(0, 20).map(x => ({ terme: x.c.term, ratees: x.n })),
    evolution: evo,
    jours,
  };
}

function renderBilan() {
  const name = store.settings.studentName || '';
  const b = buildBilan(name);
  const r = b.resume;
  const pct = r.reponses_30j ? Math.round(100 * (1 - r.ratees_30j / r.reponses_30j)) : null;
  app.innerHTML = `
    <section class="card form">
      <p>Votre bilan résume votre travail des 30 derniers jours. Il ne part nulle part tout seul : c’est vous qui l’envoyez à votre professeur (par l’ENT ou par mail).</p>
      <label>Votre nom (tel que votre professeur vous connaît) <input type="text" id="sname" maxlength="60" autocomplete="name" value="${esc(name)}"></label>
    </section>
    <section class="card">
      <h2>Ce que contient le bilan</h2>
      <ul class="facts">
        <li><b>${r.reponses_7j}</b> réponses cette semaine, <b>${r.reponses_30j}</b> sur 30 jours${pct === null ? '' : `, dont ${pct} % réussies`}</li>
        <li><b>${r.jours_actifs_7j}</b> ${r.jours_actifs_7j > 1 ? 'jours' : 'jour'} de travail sur 7, <b>${r.jours_actifs_30j}</b> sur 30</li>
        <li><b>${r.cartes_vues}</b> définitions vues sur ${r.cartes_total}, dont <b>${r.cartes_acquises}</b> acquises</li>
        <li>${plural(b.chapitres.length, 'chapitre travaillé', 'chapitres travaillés')}, ${plural(b.plus_ratees.length, 'définition souvent ratée', 'définitions souvent ratées')}</li>
      </ul>
    </section>
    <div class="actions">
      <button class="primary" id="bilan-file">Enregistrer le fichier du bilan</button>
      <button id="bilan-copy">Copier le bilan (à coller dans un message)</button>
    </div>
    <p class="muted small">Le nom n’est enregistré que sur cet appareil et n’apparaît que dans le bilan que vous envoyez.</p>`;
  const input = document.getElementById('sname');
  input.onchange = () => { store.settings.studentName = input.value.trim(); persist(); };
  const current = () => {
    store.settings.studentName = input.value.trim();
    persist();
    if (!store.settings.studentName) { toast('Indiquez votre nom pour que votre professeur reconnaisse votre bilan.'); input.focus(); return null; }
    return buildBilan(store.settings.studentName);
  };
  document.getElementById('bilan-file').onclick = () => {
    const data = current();
    if (!data) return;
    const slug = normTerm(data.nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'eleve';
    download(`bilan-${slug}-${dayKey()}.json`, JSON.stringify(data), 'application/json');
  };
  document.getElementById('bilan-copy').onclick = async () => {
    const data = current();
    if (!data) return;
    const text = `Bilan flashcards BCPST de ${data.nom} (${dayKey()})\n` + JSON.stringify(data);
    try {
      await navigator.clipboard.writeText(text);
      toast('Bilan copié. Collez-le dans un message à votre professeur.');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'copy-fallback';
      app.appendChild(ta);
      ta.select();
      toast('Sélectionnez le texte affiché et copiez-le.');
    }
  };
}

/* ---------- Réglages, import, sauvegarde ---------- */

function renderSettings() {
  const s = store.settings;
  app.innerHTML = `
    <section class="card form">
      <h2>Entraînement</h2>
      <label>Nouvelles cartes par jour <input type="number" min="0" max="200" id="newPerDay" value="${s.newPerDay}"></label>
      <label>Objectif quotidien (réponses) <input type="number" min="5" max="500" id="dailyGoal" value="${s.dailyGoal}"></label>
      <label>Boutons de réponse
        <select id="buttons"><option value="2" ${s.buttons === 2 ? 'selected' : ''}>2 : Raté / Su</option><option value="4" ${s.buttons === 4 ? 'selected' : ''}>4 : Raté / Difficile / Su / Facile</option></select></label>
      <label>Exigence de mémorisation
        <select id="retention">
          <option value="0.85" ${s.retention === 0.85 ? 'selected' : ''}>Légère (85 %)</option>
          <option value="0.9" ${s.retention === 0.9 ? 'selected' : ''}>Normale (90 %, recommandé)</option>
          <option value="0.95" ${s.retention === 0.95 ? 'selected' : ''}>Concours proche (95 %, bien plus de révisions)</option>
        </select></label>
    </section>
    <section class="card form">
      <h2>Définitions</h2>
      <p class="muted">Version actuelle : ${esc(deck.version)} (${deck.cards.length} définitions). La progression est conservée lors d’une mise à jour, tant que le terme ne change pas.</p>
      <button id="check-update">Vérifier s’il existe une nouvelle version</button>
      <label class="file">Importer un fichier tableur (.xlsx)<input type="file" id="xlsx" accept=".xlsx,.xls,.ods"></label>
      <p class="muted small">Format attendu : colonne A terme, B code(s) de partie (ex. « SV-G-1, SV-H »), C définition. L’onglet « Toutes » est utilisé s’il existe, sinon le premier onglet.</p>
    </section>
    <section class="card form">
      <h2>Sauvegarde</h2>
      <p class="muted">Votre progression est enregistrée uniquement dans ce navigateur, sur cet appareil. Exportez-la de temps en temps, et avant de changer de téléphone.</p>
      <button id="export">Exporter ma progression</button>
      <label class="file">Restaurer une sauvegarde<input type="file" id="import" accept=".json,application/json"></label>
      <button class="danger" id="reset">Effacer toute ma progression</button>
    </section>
    <button class="link" id="privacy">Données et confidentialité</button>
    <p><a class="link" href="prof.html">Espace enseignant : regrouper les bilans des élèves</a></p>
    <p><a class="link" href="chapitres.html">Espace enseignant : chapitres vus en cours</a></p>`;
  const num = (id, min, max) => {
    const el = document.getElementById(id);
    el.onchange = () => {
      const v = Math.round(Number(el.value));
      if (Number.isFinite(v)) { s[id] = Math.min(max, Math.max(min, v)); persist(); }
      el.value = s[id];
    };
  };
  num('newPerDay', 0, 200);
  num('dailyGoal', 5, 500);
  document.getElementById('buttons').onchange = e => { s.buttons = Number(e.target.value); persist(); };
  document.getElementById('retention').onchange = e => {
    s.retention = Number(e.target.value);
    persist();
    scheduler = makeScheduler();
    toast('Réglage pris en compte à partir des prochaines réponses.');
  };
  document.getElementById('check-update').onclick = checkUpdate;
  document.getElementById('xlsx').onchange = e => e.target.files[0] && importXlsx(e.target.files[0]);
  document.getElementById('export').onclick = exportBackup;
  document.getElementById('import').onchange = e => e.target.files[0] && importBackup(e.target.files[0]);
  document.getElementById('reset').onclick = async () => {
    if (!await askConfirm('Effacer toute votre progression sur cet appareil ? Cette action est définitive.', 'Tout effacer')) return;
    store.cards = {}; store.log = []; store.days = {}; store.selection = [];
    persist();
    updateBadge();
    toast('Progression effacée.');
  };
  document.getElementById('privacy').onclick = () => go('privacy');
}

function describeChange(oldCards, newCards) {
  const oldIds = new Map(oldCards.map(c => [c.id, c]));
  const newIds = new Set(newCards.map(c => c.id));
  let added = 0, changed = 0;
  for (const c of newCards) {
    const o = oldIds.get(c.id);
    if (!o) added += 1;
    else if (o.def !== c.def || o.codes.join() !== c.codes.join() || (o.keys || []).join() !== (c.keys || []).join() || !o.method !== !c.method) changed += 1;
  }
  const removed = oldCards.filter(c => !newIds.has(c.id)).length;
  return { added, changed, removed };
}

async function applyDeck(newDeck, source) {
  const ch = describeChange(deck.cards, newDeck.cards);
  const msg = `${source}\n\n${newDeck.cards.length} définitions : ${ch.added} nouvelles, ${ch.changed} modifiées, ${ch.removed} retirées.\n\nVotre progression sur les définitions conservées est gardée.`;
  if (!await askConfirm(msg, 'Mettre à jour')) return;
  setDeck(newDeck, true);
  toast('Définitions mises à jour.');
  render();
}

async function checkUpdate() {
  try {
    const remote = await fetch('data/definitions.json', { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
    if (remote.version <= deck.version) return toast('Vous avez déjà la dernière version.');
    applyDeck(remote, `Nouvelle version disponible : ${remote.version}.`);
  } catch (e) {
    toast('Pas de connexion : impossible de vérifier pour l’instant.');
  }
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

async function importXlsx(file) {
  try {
    if (!window.XLSX) await loadScript('vendor/xlsx.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheetName = wb.SheetNames.includes('Toutes') ? 'Toutes' : wb.SheetNames[0];
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    const seen = new Map();
    const cards = [];
    let noCode = 0;
    for (const row of rows) {
      const term = String(row[0] || '').trim();
      const def = String(row[2] || '').trim();
      if (!term || !def) continue;
      if (/^terme$/i.test(term) && /^d[ée]finition$/i.test(def)) continue; // ligne d'en-tête éventuelle
      const codes = String(row[1] || '').split(/[,;]/).map(x => x.trim().toUpperCase()).filter(Boolean);
      if (!codes.length) { noCode += 1; continue; }
      const base = normTerm(term);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const keys = String(row[3] || '').split(';').map(x => x.trim()).filter(Boolean);
      const card = { id: n > 1 ? `${base}#${n}` : base, term, def, codes };
      if (keys.length) card.keys = keys;
      if (/^m/i.test(String(row[4] || '').trim())) card.method = true; // colonne E : « M » pour une méthode ou technique
      cards.push(card);
    }
    if (!cards.length) return toast('Aucune définition avec un code de chapitre dans ce fichier.');
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const skipped = noCode ? ` ${plural(noCode, 'définition sans code de chapitre est ignorée', 'définitions sans code de chapitre sont ignorées')}.` : '';
    applyDeck({ version: stamp, source: file.name, cards }, `Fichier « ${file.name} », onglet « ${sheetName} ».${skipped}`);
  } catch (e) {
    toast('Lecture du fichier impossible : ' + (e.message || e));
  }
}

async function download(filename, text, type) {
  // dans l'aperçu hébergé par Claude, les téléchargements passent par la plateforme
  if (window.claude && window.claude.use) {
    const dl = await window.claude.use('downloads').catch(() => null);
    if (dl) {
      try { await dl.save({ filename, data: new Blob([text], { type }) }); } catch (e) { /* refusé par l'utilisateur */ }
      return;
    }
  }
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportBackup() {
  const data = { app: 'flashcards-bcpst', exported: new Date().toISOString(), store };
  download(`flashcards-bcpst-sauvegarde-${dayKey()}.json`, JSON.stringify(data), 'application/json');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'flashcards-bcpst' || !data.store || typeof data.store.cards !== 'object') throw new Error('fichier non reconnu');
    if (!await askConfirm(`Restaurer la sauvegarde du ${data.exported.slice(0, 10)} ? Elle remplace la progression actuelle de cet appareil.`, 'Restaurer')) return;
    Object.assign(store, { cards: {}, log: [], days: {}, selection: [] }, data.store);
    store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings);
    persist();
    scheduler = makeScheduler();
    updateBadge();
    toast('Sauvegarde restaurée.');
    render();
  } catch (e) {
    toast('Sauvegarde illisible : ' + (e.message || e));
  }
}

/* ---------- Installation et rappels ---------- */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (view === 'install') render(); });

function icsReminder(time) {
  const [h, m] = time.split(':').map(Number);
  const start = new Date();
  start.setHours(h, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate() + 1);
  const p = n => String(n).padStart(2, '0');
  const local = d => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const end = new Date(start.getTime() + 15 * 60e3);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flashcards BCPST//FR', 'BEGIN:VEVENT',
    `UID:flashcards-bcpst-${stamp}@local`, `DTSTAMP:${stamp}`, `DTSTART:${local(start)}`, `DTEND:${local(end)}`,
    'RRULE:FREQ=DAILY', 'SUMMARY:Flashcards BCPST : révisions du jour',
    'DESCRIPTION:Ouvre l\'application Flashcards BCPST et faites vos cartes à revoir.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Flashcards BCPST', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function renderInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  app.innerHTML = `
    <section class="card">
      <h2>Installer</h2>
      ${standalone ? '<p>L’application est déjà installée.</p>' : installPrompt
        ? '<button class="primary" id="install">Installer sur cet appareil</button>'
        : ios ? '<p>Sur iPhone ou iPad : ouvrez cette page dans <b>Safari</b>, touchez le bouton <b>Partager</b>, puis <b>Sur l’écran d’accueil</b>.</p>'
          : '<p>Sur Android, depuis votre navigateur habituel (Chrome, Samsung Internet, Firefox, Edge, Opera, Mi Browser…) : ouvrez son menu (<b>⋮</b> ou <b>≡</b>), puis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.<br>Sur ordinateur (Chrome ou Edge) : icône d’installation à droite de la barre d’adresse.</p>'}
      <p class="muted small">Une fois installée, l’application fonctionne sans connexion. Sur iPhone, installez-la pour éviter que Safari efface vos données après plusieurs semaines sans visite.</p>
      <p class="warn"><b>Ouvrez toujours l’application par son icône.</b> Votre progression et votre suivi sont enregistrés dans le navigateur qui a servi à l’installer : ouverte depuis un autre navigateur, l’application repart de zéro, et ce navigateur enverrait un bilan vide sous votre code.</p>
    </section>
    <section class="card form">
      <h2>Rappel quotidien</h2>
      <p>Ajoutez un rappel répété chaque jour dans le calendrier de votre téléphone. ${'setAppBadge' in navigator ? 'L’icône de l’application affiche aussi le nombre de cartes à revoir.' : ''}</p>
      <label>Heure du rappel <input type="time" id="rtime" value="${store.settings.reminderTime}"></label>
      <button id="ics">Ajouter le rappel au calendrier</button>
      <p class="muted small">Le fichier téléchargé s’ouvre avec l’application Calendrier. Pour arrêter le rappel, supprimez l’événement dans votre calendrier.</p>
    </section>`;
  const i = document.getElementById('install');
  if (i) i.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); };
  document.getElementById('rtime').onchange = e => { store.settings.reminderTime = e.target.value || '18:00'; persist(); };
  document.getElementById('ics').onclick = () => download('rappel-flashcards-bcpst.ics', icsReminder(store.settings.reminderTime), 'text/calendar');
}

function renderPrivacy() {
  app.innerHTML = `<section class="card prose">
    <h2>En bref</h2>
    <p><b>Votre travail reste sur votre appareil, sauf ce que vous choisissez d’envoyer.</b> L’application ne demande ni compte, ni adresse e-mail, et n’utilise ni cookie, ni mesure d’audience, ni publicité. Votre nom n’est jamais envoyé en ligne.</p>

    <h2>Sur votre appareil</h2>
    <p>Le stockage de votre navigateur garde l’état de chaque carte (prochaine révision, stabilité, difficulté, oublis), l’historique de vos réponses, vos réglages, votre dernière sélection de chapitres et, si vous les saisissez, votre nom pour le bilan manuel et votre code de suivi. Personne d’autre n’y a accès.</p>

    <h2>Ce qui peut être envoyé à votre professeur</h2>
    <p><b>Un signalement d’erreur</b> (bouton &#9888;&#xFE0E;) ou <b>une suggestion</b> : le terme et sa définition, le type de problème et ce que vous avez écrit, sans votre nom.</p>
    <p><b>Le suivi par votre professeur</b>, seulement si vous l’activez avec le code qu’il vous a remis (Ma progression). Votre bilan part alors après vos séances, au plus toutes les 10 minutes : votre code de suivi ; vos dates de première et de dernière utilisation ; vos nombres de réponses, de cartes sues et de cartes ratées (7 jours, 30 jours, depuis le début, et leur évolution par semaine) ; vos jours de travail ; vos définitions vues, acquises et à revoir, par partie du programme ; les définitions que vous ratez le plus ; la version des définitions. Si vous arrêtez le suivi, un dernier envoi signale seulement l’arrêt. <b>Votre nom n’est pas envoyé</b> : seul votre professeur sait à qui correspond votre code, et il garde cette liste hors ligne.</p>
    <p>Un code n’est pas un anonymat complet : votre professeur peut vous reconnaître. C’est le but du suivi.</p>

    <h2>Pourquoi, et qui y a accès</h2>
    <p>Ces données servent uniquement à votre professeur pour suivre votre travail et celui de la classe, et pour adapter son enseignement. Il est le seul à les consulter ; elles ne sont ni vendues, ni transmises à d’autres. Le suivi est mis en œuvre par votre professeur dans le cadre de sa mission d’enseignement ; le responsable du traitement est votre établissement.</p>
    <p>Le suivi est facultatif : vous pouvez l’activer quand vous voulez et l’arrêter à tout moment (Ma progression, puis « Arrêter le suivi »). Les envois cessent aussitôt.</p>

    <h2>Où sont les données, et combien de temps</h2>
    <p>Les envois sont rangés dans un tableur Google de votre professeur (Google peut héberger ces données hors de l’Union européenne). L’application elle-même est hébergée par GitHub, qui ne reçoit pas vos réponses. Le tableur n’enregistre pas ton adresse IP, mais, comme pour tout site, les serveurs de Google et de GitHub la voient passer.</p>
    <p>Les bilans de suivi sont conservés jusqu’à la fin de l’année scolaire, puis effacés par votre professeur, avec la liste des codes.</p>

    <h2>Vos droits</h2>
    <p>Vous pouvez demander à consulter, corriger ou effacer les données envoyées sous votre code, ou vous opposer au suivi : adressez-vous à votre professeur, ou au délégué à la protection des données de votre académie. Vous pouvez aussi adresser une réclamation à la CNIL (cnil.fr).</p>
    <p>Pour tout effacer sur votre appareil : Réglages, puis « Effacer toute ma progression », ou supprimez l’application. Une sauvegarde exportée est un fichier qui vous appartient : vous choisissez où il va.</p>
  </section>`;
}

/* ---------- Démarrage ---------- */

async function main() {
  try {
    await loadDeck();
  } catch (e) {
    app.innerHTML = '<p class="warn">Impossible de charger les définitions. Vérifiez votre connexion au premier lancement.</p>';
    return;
  }
  render();
  updateBadge();
  flushReports();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; }).catch(() => {});
    // nouvelle version installée : on recharge, mais jamais au milieu d'une séance
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => { updateReady = true; reloadIfIdle(); });
    }
  }
}

let swReg = null;
let updateReady = false;
function reloadIfIdle() {
  if (updateReady && !session && view === 'home') location.reload();
}

document.addEventListener('visibilitychange', () => {
  // sur téléphone, l'application est souvent reprise sans être relancée : on cherche alors une mise à jour
  if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {});
  if (document.visibilityState === 'visible' && view === 'home') render();
  if (document.visibilityState === 'hidden') queueSuivi(); // l'élève quitte l'application : on envoie la séance
});

main();
