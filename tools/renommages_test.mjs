// Test des termes renommés ou supprimés du tableur : la progression, la coche et l'historique d'un terme renommé
// passent sous son nouveau nom ; une carte supprimée ne casse rien. Usage : node tools/renommages_test.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 8791;
const URL = `http://localhost:${PORT}/`;
const deck = JSON.parse(fs.readFileSync('www/data/definitions.json', 'utf8'));
const ids = new Set(deck.cards.map(c => c.id));
let fails = 0;
const check = (ok, msg) => { console.log(ok ? 'OK  ' : 'ÉCHEC', msg); if (!ok) fails += 1; };

const ren = deck.renames || {};
check(ren['grossissement'] === 'grossissement (microscopie notamment)', 'correspondance grossissement dans definitions.json');
check(Object.values(ren).every(n => ids.has(n)) && Object.keys(ren).every(o => !ids.has(o)), 'chaque nouveau nom existe, aucun ancien nom n’existe encore');
check(!ids.has('giec'), 'GIEC n’est plus dans le paquet');

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const now = new Date();
const st = (days, stab) => ({ due: new Date(now.getTime() + days * 864e5).toISOString(), stability: stab, difficulty: 5, elapsed_days: 3, scheduled_days: days, learning_steps: 0, reps: 4, lapses: 0, state: 2, last_review: new Date(now.getTime() - 3 * 864e5).toISOString() });
const before = {
  cards: {
    'grossissement': st(30, 40), // ancien nom : à reporter
    'groupe exterieur (principe)': st(5, 10), // ancien nom, nouveau nom déjà commencé : le nouveau est gardé
    'extragroupe (principe)': st(2, 3),
    'giec': st(4, 8), // supprimé : ne casse rien
  },
  log: [{ id: 'grossissement', t: now.toISOString(), g: 3, s: 'Révisions' }, { id: 'giec', t: now.toISOString(), g: 1, s: 'Révisions' }],
  qcmLog: [{ id: 'grossissement', t: now.toISOString(), ok: 1, pick: 'precipitation' }],
  days: {}, settings: {}, selection: [], picked: ['grossissement', 'giec'], revLog: [], mesChapitres: ['SV-C', 'ST-H'],
};
// stockage écrit avant le premier chargement de l'appli (sinon elle réécrit le sien en quittant la page)
await page.goto(URL + 'manifest.webmanifest');
await page.evaluate(s => { localStorage.clear(); localStorage.setItem('fc-bcpst-v1', JSON.stringify(s)); }, before);
await page.goto(URL);
await page.waitForSelector('#go-all');
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fc-bcpst-v1')));
check(after.cards['grossissement (microscopie notamment)'] && after.cards['grossissement (microscopie notamment)'].stability === 40, 'progression de « grossissement » reportée sous son nouveau nom');
check(!after.cards['grossissement'], 'ancien identifiant retiré');
check(after.cards['extragroupe (principe)'].stability === 3, 'progression déjà commencée sous le nouveau nom conservée');
check(after.picked.includes('grossissement (microscopie notamment)') && !after.picked.includes('grossissement'), 'coche du lexique reportée');
check(after.log[0].id === 'grossissement (microscopie notamment)' && after.qcmLog[0].id === 'grossissement (microscopie notamment)', 'historique reporté');
check(after.qcmLog[0].pick === 'precipitation (cas general)', 'réponse choisie au QCM reportée');
check(!!after.cards['giec'], 'carte supprimée : progression gardée en réserve');
// l'appli fonctionne : révisions, lexique, progrès
await page.click('#go-all');
await page.waitForTimeout(300);
await page.goto(URL);
await page.waitForSelector('#go-all');
await page.click('#btn-lexicon');
await page.waitForTimeout(300);
const sugg = async q => { await page.fill('#lex-q', q); await page.waitForTimeout(250); return page.textContent('#lex-sugg'); };
check((await sugg('grossiss')).includes('microscopie notamment'), 'lexique : nouveau nom trouvé');
check(!(await sugg('rasoir')).includes('Occam'), 'lexique : terme supprimé absent');
await page.goto(URL);
await page.waitForSelector('#go-progress');
await page.click('#go-progress');
await page.waitForTimeout(300);
// deuxième lancement : rien à refaire, rien de cassé
await page.reload();
await page.waitForSelector('#go-all');
const again = await page.evaluate(() => JSON.parse(localStorage.getItem('fc-bcpst-v1')));
check(again.cards['grossissement (microscopie notamment)'].stability === 40, 'second lancement : progression intacte');
check(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
await browser.close();
server.kill();
process.exit(fails ? 1 : 0);
