'use strict';
/* QCM d'échauffement : masquage du terme dans sa définition et choix des leurres.
   Fonctions pures, utilisables dans le navigateur (window.QCM) et sous Node (tests). */
(function (root) {
  const MARKS = /[̀-ͯ]/g;

  function normChar(ch) {
    return ch.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/’/g, "'").replace(/ /g, ' ')
      .normalize('NFD').replace(MARKS, '');
  }

  // Texte normalisé (minuscules, sans accents) et position d'origine de chaque caractère.
  function normMap(text) {
    let s = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      for (const ch of normChar(text[i])) { s += ch; map.push(i); }
    }
    map.push(text.length);
    return { s, map };
  }

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Formes du terme à masquer : le terme sans sa parenthèse, et le contenu de la parenthèse
  // quand c'est un sigle (ADN) ou une variante du terme (acide aminé (acide α-aminé)).
  function variants(term) {
    const base = term.replace(/\s*\([^)]*\)/g, ' ').trim();
    const out = [base];
    const first = normMap(base).s.split(/[\s'-]+/)[0];
    for (const m of term.matchAll(/\(([^)]+)\)/g)) {
      const inner = m[1].trim();
      const sigle = /^[A-Z0-9][A-Za-z0-9₀-₉⁺⁻,-]{0,11}$/.test(inner) && (inner.match(/[A-Z]/g) || []).length >= 2;
      if (sigle || (normMap(inner).s.split(/[\s'-]+/)[0] === first && inner.length > 3)) out.push(inner);
    }
    return out.filter(v => normMap(v).s.replace(/[^a-z0-9]/g, '').length >= 2);
  }

  // Expression régulière d'une forme, sur le texte normalisé : pluriel en s/x accepté sur chaque mot.
  function formRe(form) {
    const words = normMap(form).s.split(/[\s-]+/).filter(Boolean);
    const body = words.map(w => escRe(w) + (/[a-z]$/.test(w) ? '(?:s|x)?' : '')).join('[\\s-]+');
    return new RegExp(`(^|[^a-z0-9])(${body})(?=[^a-z0-9]|$)`, 'g');
  }

  // Remplace dans la définition toutes les occurrences du terme par « ___ ».
  function maskTerm(def, term) {
    const { s, map } = normMap(def);
    const spans = [];
    for (const v of variants(term)) {
      for (const m of s.matchAll(formRe(v))) {
        const a = m.index + m[1].length;
        spans.push([map[a], map[a + m[2].length]]);
      }
    }
    if (!spans.length) return { text: def, masked: 0 };
    spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
    let text = '';
    let pos = 0;
    let masked = 0;
    for (const [a, b] of spans) {
      if (a < pos) continue; // chevauchement avec une forme déjà masquée
      text += def.slice(pos, a) + '___';
      pos = b;
      masked += 1;
    }
    return { text: text + def.slice(pos), masked };
  }

  function mentions(text, term) {
    const { s } = normMap(text);
    return variants(term).some(v => formRe(v).test(s));
  }

  const baseOf = term => normMap(term.replace(/\s*\([^)]*\)/g, ' ').trim()).s;
  const partOf = code => code.split('-').slice(0, 2).join('-');

  /* ---------- Proximité entre deux termes ----------
     Sens : mots communs aux définitions (pondérés par leur rareté dans la base, TF-IDF).
     Forme : morceaux de trois lettres communs aux termes (anémo-gamie, entomo-gamie, anémo-chorie). */

  const STOP = new Set(('dans avec pour sans sous entre chez leur leurs cette ces celle celui ceux elle elles '
    + 'sont etre fait font plus moins tres ainsi aussi donc dont mais selon lors certains certaines '
    + 'notamment exemple generalement souvent permet permettant partir lieu ensemble type forme').split(' '));

  const stem = w => w.slice(0, 6); // racine grossière : pollinisation et polliniser se rejoignent
  const words = text => (normMap(text).s.match(/[a-z]{4,}/g) || []).filter(w => !STOP.has(w)).map(stem);

  function trigrams(term) {
    const t = ` ${baseOf(term).replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const out = new Set();
    for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
    return out;
  }

  const indexes = new WeakMap();
  function indexOf(cards) {
    let ix = indexes.get(cards);
    if (ix) return ix;
    const df = new Map();
    const toks = cards.map(c => {
      const ws = words(c.def + ' ' + c.term.replace(/[()]/g, ' '));
      new Set(ws).forEach(w => df.set(w, (df.get(w) || 0) + 1));
      return ws;
    });
    const n = cards.length;
    ix = new Map();
    cards.forEach((c, i) => {
      const vec = new Map();
      toks[i].forEach(w => vec.set(w, (vec.get(w) || 0) + Math.log(n / df.get(w))));
      let norm = 0;
      vec.forEach(v => { norm += v * v; });
      ix.set(c.id, { vec, norm: Math.sqrt(norm) || 1, tri: trigrams(c.term) });
    });
    indexes.set(cards, ix);
    return ix;
  }

  function cosine(a, b) {
    let dot = 0;
    const [small, big] = a.vec.size < b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
    small.forEach((v, w) => { if (big.has(w)) dot += v * big.get(w); });
    return dot / (a.norm * b.norm);
  }

  function jaccard(a, b) {
    let inter = 0;
    a.forEach(x => { if (b.has(x)) inter += 1; });
    return inter / ((a.size + b.size - inter) || 1);
  }

  // Trois leurres parmi les termes les plus proches par le sens et par la forme, de préférence dans le même
  // chapitre. Sont exclus les homonymes et cas particuliers, les termes cités dans la définition affichée et
  // les définitions presque identiques (probables synonymes : la question aurait deux bonnes réponses).
  function pickDistractors(card, cards, shownDef, n = 3, rnd = Math.random) {
    const ok = candidates(card, cards, shownDef, n + 2);
    // le plus proche est toujours proposé ; les autres sont tirés parmi les suivants, pour varier d'une fois à l'autre
    return ok.length <= n ? ok : [ok[0], ...shuffle(ok.slice(1), rnd).slice(0, n - 1)];
  }

  // Les termes les plus proches, du plus au moins proche.
  function candidates(card, cards, shownDef, max) {
    const ix = indexOf(cards);
    const me = ix.get(card.id) || { vec: new Map(), norm: 1, tri: trigrams(card.term) };
    const codes = card.codes;
    const parts = new Set(codes.map(partOf));
    const groups = new Set(codes.map(c => c.slice(0, 2)));
    const base = baseOf(card.term);
    const scored = [];
    for (const c of cards) {
      if (c.id === card.id || c.def === card.def) continue;
      // un terme qui contient l'autre (synapse / synapse chimique, zoochorie / endozoochorie) en est souvent
      // un cas particulier : la question risquerait d'avoir deux réponses défendables
      const cb = baseOf(c.term);
      if (cb.includes(base) || base.includes(cb)) continue;
      if (!c.codes.some(x => groups.has(x.slice(0, 2)))) continue; // même domaine : SV, BG ou ST
      const o = ix.get(c.id);
      const sense = cosine(me, o);
      if (sense > 0.9) continue;
      const near = c.codes.some(x => codes.includes(x)) ? 0.15 : c.codes.some(x => parts.has(partOf(x))) ? 0.07 : 0;
      scored.push({ c, b: cb, k: sense + 0.6 * jaccard(me.tri, o.tri) + near });
    }
    scored.sort((x, y) => y.k - x.k);
    const ok = [];
    const seen = new Set([base]);
    for (const x of scored) {
      if (ok.length >= max) break;
      if (seen.has(x.b) || mentions(shownDef, x.c.term)) continue;
      seen.add(x.b);
      ok.push(x.c);
    }
    return ok;
  }

  function shuffle(arr, rnd = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Une question : la définition (terme masqué) et quatre termes dans le désordre.
  function makeQuestion(card, cards, rnd = Math.random) {
    const shown = maskTerm(card.def, card.term).text;
    const options = shuffle([card, ...pickDistractors(card, cards, shown, 3, rnd)], rnd);
    return { card, def: shown, options };
  }

  const api = { normMap, variants, maskTerm, mentions, candidates, pickDistractors, makeQuestion, shuffle, indexOf, cosine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCM = api;
})(typeof window !== 'undefined' ? window : globalThis);
