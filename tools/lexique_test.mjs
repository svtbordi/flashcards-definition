// Test du lexique : recherche avec complétion et sommaire par partie.
import { chromium, devices } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.goto(`${base}/`);
await p.waitForSelector('#go-lexicon');
await p.click('#btn-lexicon');
await p.waitForSelector('#lex-q');
// saisie sans accent : la complétion doit proposer les termes accentués
await p.fill('#lex-q', 'meio');
const sugg = await p.$$eval('#lex-sugg li', lis => lis.map(l => l.textContent));
console.log('suggestions « meio » :', sugg);
await p.screenshot({ path: `${out}/lex-1-suggestions.png` });
await p.keyboard.press('Enter');
await p.waitForSelector('.def-box');
console.log('bulle :', (await p.textContent('.def-box')).replace(/\s+/g, ' ').slice(0, 160));
await p.screenshot({ path: `${out}/lex-2-bulle.png` });
await p.click('#def-close');
await p.fill('#lex-q', 'zzzz');
console.log('aucun :', await p.textContent('#lex-sugg'));
// sommaire : ouvrir SV-A, puis une sous-partie
await p.fill('#lex-q', '');
await p.click('[data-part="SV-A"]');
const sub = await p.$('.subs [data-show]:nth-of-type(2)');
await sub.click();
const terms = await p.$$eval('.terms .term', bs => bs.map(b => b.textContent));
const sorted = [...terms].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
console.log('termes', terms.length, 'triés :', JSON.stringify(terms) === JSON.stringify(sorted), terms.slice(0, 5));
await p.screenshot({ path: `${out}/lex-3-sommaire.png` });
await p.click('.terms .term');
await p.waitForSelector('.def-box');
await p.mouse.click(5, 5); // clic hors de la bulle : fermeture
console.log('bulle fermée :', !(await p.$('.def-box')));
// pas de bouton lexique pendant une séance
await p.click('#btn-back');
await p.click('#go-all');
await p.waitForSelector('.flash');
console.log('loupe cachée en séance :', await p.isHidden('#btn-lexicon'));
const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
console.log('défilement horizontal :', wide, 'erreurs :', errors);
await browser.close();
if (errors.length) process.exit(1);
