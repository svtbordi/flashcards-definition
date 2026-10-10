'use strict';
/* Flashcards BCPST : répétition espacée (FSRS) sur les définitions du programme.
   Toutes les données restent dans le navigateur de l'élève (localStorage). */

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = window.FSRS;

const STORE_KEY = 'fc-bcpst-v1';
const DECK_KEY = 'fc-bcpst-deck-v1';
const DAY_START_HOUR = 4; // une « journée » de révision commence à 4 h, comme dans Anki
const MASTERED_DAYS = 21; // carte considérée comme acquise au-delà de 21 jours de stabilité
const NO_CODE = 'NC';

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
  { cards: {}, log: [], days: {}, settings: {}, selection: [] },
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

function matchesSelection(card, selected) {
  return cardCodes(card).some(code => selected.some(sel => code === sel || code.startsWith(sel + '-')));
}

function cardOrderKey(c) {
  const code = cardCodes(c)[0];
  const order = chapterOrder[code] ?? chapterOrder[partOf(code)] ?? 9999;
  return [order, c.term];
}

async function loadDeck() {
  const [bundled, chaps] = await Promise.all([
    fetch('data/definitions.json').then(r => r.json()),
    fetch('data/chapters.json').then(r => r.json()),
  ]);
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

function buildSession(selected, { ahead = false, label = '' } = {}) {
  const now = new Date();
  const endDay = endOfStudyDay(now);
  const pool = deck.cards.filter(c => matchesSelection(c, selected));
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
    selected, label, ahead,
    queue,
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
  render();
  window.scrollTo(0, 0);
}

function back() {
  if (view === 'session') session = null;
  view = viewStack.pop() || 'home';
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
  const all = statsFor(deck.cards);
  const started = startedCodes();
  const startedStats = started.length ? statsFor(deck.cards.filter(c => matchesSelection(c, started))) : null;
  const d = today();
  const goal = store.settings.dailyGoal;
  const pct = Math.min(100, Math.round(100 * d.reviews / goal));
  const st = streak();
  const newToday = Math.min(all.new, Math.max(0, store.settings.newPerDay - d.newCards));
  const lateWarning = d.reviews < goal && new Date().getHours() >= 18;
  app.innerHTML = `
    <section class="card hero">
      <p class="big">${plural(all.due, 'carte à revoir', 'cartes à revoir')} aujourd’hui</p>
      <p class="muted">${newToday ? `+ ${plural(newToday, 'nouvelle carte disponible', 'nouvelles cartes disponibles')}` : 'Limite de nouvelles cartes atteinte pour aujourd’hui'}</p>
      <div class="goal"><div class="goal-fill" style="width:${pct}%"></div></div>
      <p class="muted">Objectif du jour : ${Math.min(d.reviews, goal)} / ${goal} cartes${st ? ` · ${plural(st, 'jour', 'jours')} d’affilée` : ''}</p>
      ${lateWarning ? `<p class="warn">Il te reste ${goal - d.reviews} cartes pour atteindre ton objectif du jour.</p>` : ''}
    </section>
    <div class="actions">
      <button class="primary" id="go-all" ${all.due + newToday ? '' : 'disabled'}>Révisions du jour, tout le programme</button>
      <button id="go-started" ${startedStats ? '' : 'disabled'}>Mes chapitres commencés${startedStats ? ` <small>(${startedStats.due} à revoir)</small>` : ''}</button>
      <button id="go-choose">Choisir un ou plusieurs chapitres</button>
      ${store.selection.length ? `<button id="go-last">Reprendre ma dernière sélection <small>(${esc(store.selection.slice(0, 3).join(', '))}${store.selection.length > 3 ? '…' : ''})</small></button>` : ''}
    </div>
    <div class="actions secondary">
      <button id="go-progress">Ma progression</button>
      <button id="go-lexicon">Lexique : chercher une définition</button>
      <button id="go-install">Installer l’application et les rappels</button>
    </div>
    <p class="muted small">${deck.cards.length} définitions · version ${esc(deck.version)}</p>`;
  document.getElementById('go-all').onclick = () => startSession(['SV', 'BG', 'ST', NO_CODE], 'Tout le programme');
  document.getElementById('go-started').onclick = () => startSession(started, 'Mes chapitres commencés');
  document.getElementById('go-choose').onclick = () => go('choose');
  const last = document.getElementById('go-last');
  if (last) last.onclick = () => startSession(store.selection, 'Dernière sélection');
  document.getElementById('go-progress').onclick = () => go('progress');
  document.getElementById('go-lexicon').onclick = () => go('lexicon');
  document.getElementById('go-install').onclick = () => go('install');
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

function renderChoose() {
  if (!chooseSel.size && store.selection.length) chooseSel = new Set(store.selection);
  const tree = chapterTree();
  const groups = { SV: 'Sciences de la vie', BG: 'Biogéosciences', ST: 'Sciences de la Terre', NC: 'Autres' };
  let html = '<p class="muted">Coche une partie entière ou des sous-parties. Les nombres indiquent les cartes à revoir aujourd’hui et le total.</p>';
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
        <span class="chap-name"><b>${p.code === NO_CODE ? '' : esc(p.code) + ' '}</b>${esc(chapterTitle[p.code] || '')}</span>
        <span class="count">${s.due ? `<em>${s.due}</em> / ` : ''}${s.total}</span></label>
      ${p.subs.length ? `<button class="link toggle" data-toggle="${p.code}">${open ? 'Masquer' : 'Voir'} les sous-parties (${p.subs.length})</button>` : ''}
      ${bar(s)}
      ${open ? '<div class="subs">' + p.subs.map(code => {
        const sc = statsFor(deck.cards.filter(c => matchesSelection(c, [code])));
        return `<label class="row sub"><input type="checkbox" data-code="${code}" ${checked || chooseSel.has(code) ? 'checked' : ''} ${checked ? 'disabled' : ''}>
          <span class="chap-name"><b>${esc(code)}</b> ${esc(chapterTitle[code] || '')}</span>
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

function startSession(selected, label, ahead = false) {
  session = buildSession(selected, { label, ahead });
  session.current = nextCard();
  go('session', view !== 'session');
}

function ratingButtons() {
  if (store.settings.buttons === 4) {
    return `<div class="grade four">
      <button class="again" data-r="${Rating.Again}">Raté<small>1</small></button>
      <button class="hard" data-r="${Rating.Hard}">Difficile<small>2</small></button>
      <button class="good" data-r="${Rating.Good}">Su<small>3</small></button>
      <button class="easy" data-r="${Rating.Easy}">Facile<small>4</small></button></div>`;
  }
  return `<div class="grade">
    <button class="again" data-r="${Rating.Again}">Raté<small>1</small></button>
    <button class="good" data-r="${Rating.Good}">Su<small>2</small></button></div>`;
}

function renderSession() {
  const s = session;
  if (!s) return go('home', false);
  if (!s.current) {
    const ahead = s.ahead;
    const endDay = endOfStudyDay();
    const notDue = deck.cards.filter(c => {
      const st = stateOf(c.id);
      return st && st.state !== State.New && st.due > endDay && matchesSelection(c, s.selected);
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
    if (a) a.onclick = () => startSession(s.selected, s.label, true);
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
      <div class="codes">${cardCodes(c).map(x => `<span>${esc(x === NO_CODE ? 'sans chapitre' : x)}</span>`).join('')} ${tag}</div>
      <h2 class="term">${esc(c.term)}</h2>
      ${s.revealed ? `<p class="def">${esc(c.def)}</p>` : '<p class="hint muted">Formule la définition dans ta tête (ou à l’écrit), puis retourne la carte.</p>'}
    </article>
    ${s.revealed ? ratingButtons() : '<button class="primary reveal" id="reveal">Voir la définition <small>Espace</small></button>'}
    ${s.undo ? '<button class="link undo" id="undo">Annuler la dernière réponse</button>' : ''}`;
  const r = document.getElementById('reveal');
  if (r) r.onclick = () => { s.revealed = true; render(); };
  app.querySelectorAll('[data-r]').forEach(b => { b.onclick = () => answer(Number(b.dataset.r)); });
  const u = document.getElementById('undo');
  if (u) u.onclick = undoLast;
}

document.addEventListener('keydown', e => {
  if (view !== 'session' || !session || !session.current || e.target.tagName === 'INPUT') return;
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
    if (map[e.key]) { e.preventDefault(); answer(map[e.key]); }
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
  let html = `<button class="primary wide" id="go-bilan">Préparer mon bilan pour le professeur</button>
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
    html += `<section class="card"><h2>Les définitions que tu rates le plus</h2><ol class="hard">${hard.map(x => `<li><b>${esc(x.c.term)}</b> <span class="muted">(${plural(x.n, 'fois', 'fois')})</span></li>`).join('')}</ol></section>`;
  }
  app.innerHTML = html;
  document.getElementById('go-bilan').onclick = () => go('bilan');
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
    <button class="primary wide" id="def-close">Fermer</button></div>`;
  document.body.appendChild(box);
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', e => { if (e.target === box) close(); });
  box.querySelector('#def-close').onclick = close;
  box.querySelector('#def-close').focus();
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
      <input type="search" id="lex-q" placeholder="Tape un terme…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Chercher un terme" aria-controls="lex-sugg" value="${esc(lexQuery)}">
      <ul id="lex-sugg" class="sugg" role="listbox" hidden></ul>
    </div>
    <h2>Sommaire</h2>
    <p class="muted small">Touche une partie pour voir ses sous-parties, puis un titre pour voir ses termes par ordre alphabétique.</p>`;
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
      const x = chap[code] || (chap[code] = { code, total: 0, vues: 0, acquises: 0, a_revoir: 0, reponses_30j: 0, ratees_30j: 0 });
      x.total += 1;
      if (status !== 'new') x.vues += 1;
      if (status === 'mastered') x.acquises += 1;
      if (status === 'due') x.a_revoir += 1;
    }
  }
  for (const r of recent) {
    const c = byId.get(r.id);
    if (!c) continue;
    for (const code of partsOf(c)) {
      chap[code].reponses_30j += 1;
      if (r.g === Rating.Again) chap[code].ratees_30j += 1;
    }
  }
  const all = statsFor(deck.cards);
  const jours = {};
  Object.keys(store.days).filter(k => k >= dayKey(new Date(since(30)))).sort()
    .forEach(k => { jours[k] = store.days[k].reviews; });
  return {
    app: 'flashcards-bcpst-bilan',
    v: 1,
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
      cartes_vues: all.seen,
      cartes_acquises: all.mastered,
      cartes_a_revoir: all.due,
      cartes_total: all.total,
    },
    chapitres: Object.values(chap).filter(x => x.vues > 0)
      .sort((a, b) => (chapterOrder[a.code] ?? 9999) - (chapterOrder[b.code] ?? 9999) || a.code.localeCompare(b.code)),
    plus_ratees: mostFailed(recent).slice(0, 20).map(x => ({ terme: x.c.term, ratees: x.n })),
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
      <p>Ton bilan résume ton travail des 30 derniers jours. Il ne part nulle part tout seul : c’est toi qui l’envoies à ton professeur (par l’ENT ou par mail).</p>
      <label>Ton nom (tel que ton professeur te connaît) <input type="text" id="sname" maxlength="60" autocomplete="name" value="${esc(name)}"></label>
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
    <p class="muted small">Le nom n’est enregistré que sur cet appareil et n’apparaît que dans le bilan que tu envoies.</p>`;
  const input = document.getElementById('sname');
  input.onchange = () => { store.settings.studentName = input.value.trim(); persist(); };
  const current = () => {
    store.settings.studentName = input.value.trim();
    persist();
    if (!store.settings.studentName) { toast('Indique ton nom pour que ton professeur reconnaisse ton bilan.'); input.focus(); return null; }
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
      toast('Bilan copié. Colle-le dans un message à ton professeur.');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'copy-fallback';
      app.appendChild(ta);
      ta.select();
      toast('Sélectionne le texte affiché et copie-le.');
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
      <p class="muted">Ta progression est enregistrée uniquement sur cet appareil. Exporte-la de temps en temps, et avant de changer de téléphone.</p>
      <button id="export">Exporter ma progression</button>
      <label class="file">Restaurer une sauvegarde<input type="file" id="import" accept=".json,application/json"></label>
      <button class="danger" id="reset">Effacer toute ma progression</button>
    </section>
    <button class="link" id="privacy">Données et confidentialité</button>
    <p><a class="link" href="prof.html">Espace enseignant : regrouper les bilans des élèves</a></p>`;
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
    if (!await askConfirm('Effacer toute ta progression sur cet appareil ? Cette action est définitive.', 'Tout effacer')) return;
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
    else if (o.def !== c.def || o.codes.join() !== c.codes.join()) changed += 1;
  }
  const removed = oldCards.filter(c => !newIds.has(c.id)).length;
  return { added, changed, removed };
}

async function applyDeck(newDeck, source) {
  const ch = describeChange(deck.cards, newDeck.cards);
  const msg = `${source}\n\n${newDeck.cards.length} définitions : ${ch.added} nouvelles, ${ch.changed} modifiées, ${ch.removed} retirées.\n\nTa progression sur les définitions conservées est gardée.`;
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
    if (remote.version <= deck.version) return toast('Tu as déjà la dernière version.');
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
    const seen = new Set();
    const cards = [];
    let noCode = 0;
    for (const row of rows) {
      const term = String(row[0] || '').trim();
      const def = String(row[2] || '').trim();
      if (!term || !def) continue;
      if (/^terme$/i.test(term) && /^d[ée]finition$/i.test(def)) continue; // ligne d'en-tête éventuelle
      const codes = String(row[1] || '').split(/[,;]/).map(x => x.trim().toUpperCase()).filter(Boolean);
      if (!codes.length) { noCode += 1; continue; }
      const id = normTerm(term);
      if (seen.has(id)) continue;
      seen.add(id);
      cards.push({ id, term, def, codes });
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
    'DESCRIPTION:Ouvre l\'application Flashcards BCPST et fais tes cartes à revoir.',
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
        : ios ? '<p>Sur iPhone ou iPad : ouvre cette page dans <b>Safari</b>, touche le bouton <b>Partager</b>, puis <b>Sur l’écran d’accueil</b>.</p>'
          : '<p>Sur Android (Chrome) : menu <b>⋮</b> puis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.<br>Sur ordinateur (Chrome ou Edge) : icône d’installation à droite de la barre d’adresse.</p>'}
      <p class="muted small">Une fois installée, l’application fonctionne sans connexion. Sur iPhone, installe-la pour éviter que Safari efface tes données après plusieurs semaines sans visite.</p>
    </section>
    <section class="card form">
      <h2>Rappel quotidien</h2>
      <p>Ajoute un rappel répété chaque jour dans le calendrier de ton téléphone. ${'setAppBadge' in navigator ? 'L’icône de l’application affiche aussi le nombre de cartes à revoir.' : ''}</p>
      <label>Heure du rappel <input type="time" id="rtime" value="${store.settings.reminderTime}"></label>
      <button id="ics">Ajouter le rappel au calendrier</button>
      <p class="muted small">Le fichier téléchargé s’ouvre avec l’application Calendrier. Pour arrêter le rappel, supprime l’événement dans ton calendrier.</p>
    </section>`;
  const i = document.getElementById('install');
  if (i) i.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; render(); };
  document.getElementById('rtime').onchange = e => { store.settings.reminderTime = e.target.value || '18:00'; persist(); };
  document.getElementById('ics').onclick = () => download('rappel-flashcards-bcpst.ics', icsReminder(store.settings.reminderTime), 'text/calendar');
}

function renderPrivacy() {
  app.innerHTML = `<section class="card prose">
    <p><b>Aucune donnée personnelle ne quitte ton appareil sans ton action.</b> L’application ne demande ni adresse e-mail, ni compte. Ton nom n’est demandé que si tu prépares un bilan pour ton professeur ; il reste sur cet appareil et figure seulement dans le bilan que tu choisis d’envoyer.</p>
    <p>Ce qui est enregistré, uniquement dans le stockage de ton navigateur sur cet appareil : l’état de chaque carte (date de prochaine révision, stabilité, difficulté, nombre d’oublis), l’historique de tes réponses, tes réglages et ta dernière sélection de chapitres.</p>
    <p>L’application n’utilise ni cookie, ni outil de mesure d’audience, ni publicité. Le serveur qui héberge l’application ne fait que fournir ses fichiers ; il ne reçoit pas tes réponses.</p>
    <p>Pour tout effacer : Réglages, puis « Effacer toute ma progression », ou supprime l’application. Une sauvegarde exportée est un fichier qui t’appartient : tu choisis où il va.</p>
  </section>`;
}

/* ---------- Démarrage ---------- */

async function main() {
  try {
    await loadDeck();
  } catch (e) {
    app.innerHTML = '<p class="warn">Impossible de charger les définitions. Vérifie ta connexion au premier lancement.</p>';
    return;
  }
  render();
  updateBadge();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && view === 'home') render();
});

main();
