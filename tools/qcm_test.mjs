// Test du QCM d'échauffement et du signalement : fonctions sur toute la base, puis un parcours complet.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';

const require = createRequire(import.meta.url);
const Q = require('../www/qcm.js');
const cards = JSON.parse(readFileSync(new URL('../www/data/definitions.json', import.meta.url))).cards;
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// masquage
const m = Q.maskTerm('Les acides gras saturés et l’acide gras libre.', 'acide gras');
check(m.text === 'Les ___ saturés et l’___ libre.', 'pluriel et élision : ' + m.text);
check(Q.maskTerm('Molécule d’ADN double brin.', 'acide désoxyribonucléique (ADN)').text === 'Molécule d’___ double brin.', 'sigle entre parenthèses');
check(Q.maskTerm('Réaction de méiose.', 'Méiose').text === 'Réaction de ___.', 'majuscules et accents');
check(Q.maskTerm('La mitochondrie.', 'mitose').masked === 0, 'pas de masquage dans un autre mot');
let masked = 0;
let leaks = 0;
for (const c of cards) {
  const r = Q.maskTerm(c.def, c.term);
  masked += r.masked > 0;
  if (Q.mentions(r.text, c.term)) leaks += 1;
}
check(leaks === 0, `${leaks} définitions contiennent encore leur terme après masquage`);

// leurres
let incomplete = 0, crossCode = 0, dup = 0;
for (const c of cards) {
  const q = Q.makeQuestion(c, cards);
  if (q.options.length < 4) incomplete += 1;
  if (new Set(q.options.map(o => o.term)).size !== q.options.length) dup += 1;
  if (!q.options.every(o => o.codes.some(x => c.codes.some(y => x.slice(0, 2) === y.slice(0, 2))))) crossCode += 1;
  check(q.options.filter(o => o.id === c.id).length === 1, 'bonne réponse absente : ' + c.term);
}
check(incomplete === 0 && dup === 0, `${incomplete} questions incomplètes, ${dup} avec doublon`);
console.log(`${cards.length} définitions, ${masked} avec terme masqué, ${crossCode} questions avec un leurre hors du domaine (SV, BG, ST)`);

// parcours dans un navigateur de téléphone
const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = [];
const reports = [];
p.on('pageerror', e => errors.push(e.message));
await p.route('**/config.json', r => r.fulfill({ contentType: 'application/json', body: '{"signalement":"https://script.google.com/macros/s/test/exec"}' }));
await p.route('https://script.google.com/**', r => { reports.push(JSON.parse(r.request().postData())); r.fulfill({ body: 'ok' }); });
await p.goto(`${base}/`);
await p.waitForSelector('#go-choose');
// « tout le programme » : pas d'échauffement
await p.click('#go-all');
await p.waitForSelector('.flash');
check(!(await p.$('#qcm-go')), 'échauffement proposé sur tout le programme');
await p.click('#btn-back');
await p.click('#go-choose');
await p.check('input[data-code="SV-D"]');
await p.click('#start');
await p.waitForSelector('#qcm-go');
console.log('accueil de séance :', (await p.textContent('.hero')).replace(/\s+/g, ' ').trim());
check(await p.getAttribute('#qcm-go', 'class') === 'primary', 'QCM non conseillé la première fois');
await p.screenshot({ path: `${out}/qcm-1-choix.png` });
await p.click('#qcm-go');
for (let i = 0; i < 10; i++) {
  await p.waitForSelector('.opt:not([disabled])');
  if (i === 0) await p.screenshot({ path: `${out}/qcm-2-question.png` });
  await p.keyboard.press(String(1 + (i % 4)));
  await p.waitForSelector('#qcm-next');
  if (i === 0) await p.screenshot({ path: `${out}/qcm-3-correction.png` });
  if (i === 1) {
    await p.click('.report-btn');
    await p.check('input[value=autre]');
    check(await p.isDisabled('#rep-send'), '« Autre » sans précision accepté');
    await p.fill('#rep-text', 'Deux réponses possibles ?');
    await p.screenshot({ path: `${out}/qcm-4-signalement.png` });
    await p.click('#rep-send');
    await p.waitForSelector('#toast:not([hidden])');
    console.log('toast :', await p.textContent('#toast'));
  }
  await p.keyboard.press('Enter');
}
await p.waitForSelector('#to-cards');
console.log('score :', (await p.textContent('.hero')).replace(/\s+/g, ' ').trim());
await p.screenshot({ path: `${out}/qcm-5-score.png` });
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('fc-bcpst-v1')));
const failed = st.qcmLog.filter(x => !x.ok).map(x => x.id);
check(st.qcmLog.length === 10, 'journal QCM : ' + st.qcmLog.length);
check(failed.every(id => st.cards[id] && st.cards[id].state === 1), 'définition ratée au QCM pas en apprentissage');
check(st.qcmLog.filter(x => x.ok).every(x => !st.cards[x.id]), 'bonne réponse au QCM comptée dans le calendrier');
check(Object.values(st.days)[0].reviews === 0, 'le QCM compte dans l’objectif du jour');
await p.click('#to-cards');
await p.waitForSelector('.flash');
const first = await p.textContent('.term');
check(!failed.includes(first.trim().toLowerCase()), 'définition ratée reproposée immédiatement');
await p.click('#reveal');
await p.click('.flash .report-btn');
await p.check('input[value=coquille]');
await p.click('#rep-send');
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/qcm-6-flashcard.png` });
// lexique
await p.click('#btn-back');
await p.click('#btn-lexicon');
await p.fill('#lex-q', 'mitose');
await p.keyboard.press('Enter');
await p.waitForSelector('.def-box .report-btn');
await p.screenshot({ path: `${out}/qcm-7-lexique.png` });
console.log('signalements reçus :', reports.map(r => `${r.contexte} / ${r.type} / ${r.terme}${r.precision ? ' / ' + r.precision : ''}`));
check(reports.length === 2 && reports[0].propositions.length === 4, 'signalements : ' + reports.length);
const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check(!wide, 'défilement horizontal');
await browser.close();
if (errors.length) fail.push(...errors);
console.log(fail.length ? 'ÉCHECS :\n- ' + fail.join('\n- ') : 'tout est bon');
if (fail.length) process.exit(1);
