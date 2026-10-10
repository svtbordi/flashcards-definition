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
  // Premier mot de la définition (« Roche », « Protéine », « Division »…) : la catégorie du terme.
  const genusOf = def => (normMap(def).s.match(/[a-z]{3,}/) || [''])[0];
  const partOf = code => code.split('-').slice(0, 2).join('-');

  // Trois leurres pris en priorité dans la même sous-partie, puis la même partie, puis le même domaine
  // (SV, BG, ST). Sont exclus les homonymes et les termes cités dans la définition affichée.
  function pickDistractors(card, cards, shownDef, n = 3, rnd = Math.random) {
    const codes = card.codes;
    const parts = new Set(codes.map(partOf));
    const groups = new Set(codes.map(c => c.slice(0, 2)));
    const tier = c => (c.codes.some(x => codes.includes(x)) ? 0
      : c.codes.some(x => parts.has(partOf(x))) ? 1
        : c.codes.some(x => groups.has(x.slice(0, 2))) ? 2 : 3);
    const base = baseOf(card.term);
    const genus = genusOf(card.def);
    const nWords = base.split(/\s+/).length;
    const seen = new Set([base]);
    const pool = [];
    for (const c of cards) {
      if (c.id === card.id || c.def === card.def) continue;
      const b = baseOf(c.term);
      if (seen.has(b)) continue;
      pool.push({ c, b, t: tier(c) });
    }
    pool.sort((x, y) => x.t - y.t || rnd() - 0.5);
    const out = [];
    for (let t = 0; t <= 3 && out.length < n; t++) {
      // dans un même niveau : même catégorie et longueur proche d'abord, avec une part de hasard
      const level = pool.filter(x => x.t === t)
        .map(x => ({ ...x, k: Math.abs(x.b.split(/\s+/).length - nWords) + Math.abs(x.b.length - base.length) / Math.max(8, base.length)
          - (genusOf(x.c.def) === genus ? 1.5 : 0) + rnd() }))
        .sort((x, y) => x.k - y.k);
      for (const x of level) {
        if (out.length >= n) break;
        if (seen.has(x.b) || mentions(shownDef, x.c.term)) continue;
        seen.add(x.b);
        out.push(x.c);
      }
    }
    return out;
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

  const api = { normMap, variants, maskTerm, mentions, pickDistractors, makeQuestion, shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCM = api;
})(typeof window !== 'undefined' ? window : globalThis);
