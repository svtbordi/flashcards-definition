// Test de l'index alphabétique du lexique : lettres, termes triés, cases à cocher, bulle.
import { chromium, devices } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
const check = (label, ok) => { console.log(ok ? 'OK   ' : 'ÉCHEC', label); if (!ok) errors.push(label); };
await p.goto(`${base}/`);
await p.click('#go-lexicon');
await p.click('[data-mode="az"]');
const disabled = await p.$$eval('.letters button:disabled', bs => bs.map(b => b.textContent));
console.log('lettres sans terme :', disabled);
check('Y sans terme, désactivé', disabled.includes('Y'));
await p.click('[data-letter="M"]');
const terms = await p.$$eval('.terms .term', bs => bs.map(b => b.childNodes[0].textContent.trim()));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
check(`M : ${terms.length} termes, tous en M`, terms.length > 100 && terms.every(t => norm(t).startsWith('m')));
const sorted = [...terms].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
check('triés', JSON.stringify(terms) === JSON.stringify(sorted));
check('chapitre affiché à côté du terme', /[A-Z]{2}-[A-Z]/.test(await p.textContent('.terms .term small')));
await p.screenshot({ path: `${out}/az-1-lettre.png` });
// accents : « écologie » est rangé à E
await p.click('[data-letter="E"]');
const eTerms = await p.$$eval('.terms .term', bs => bs.map(b => b.childNodes[0].textContent.trim()));
check('termes accentués rangés sans accent (É → E)', eTerms.some(t => t.startsWith('é') || t.startsWith('É')));
// cocher deux termes, puis la bulle
await (await p.$$('input.pick'))[0].click();
await (await p.$$('input.pick'))[1].click();
check('bandeau : 2 cochées', (await p.textContent('.pick-banner')).includes('2 définitions cochées'));
check('reste sur la lettre E après coche', (await p.getAttribute('[data-letter="E"]', 'aria-pressed')) === 'true');
await p.click('.terms .term >> nth=2');
await p.waitForSelector('#def-pick');
await p.check('#def-pick');
await p.click('#def-close');
check('3 cochées après la bulle', (await p.textContent('.pick-banner')).includes('3 définitions cochées'));
// lettre « # » : lettres grecques
await p.click('[data-letter="#"]');
const other = await p.$$eval('.terms .term', bs => bs.map(b => b.childNodes[0].textContent.trim()));
console.log('autres :', other);
check('« # » non vide', other.length > 0);
// retour au sommaire par chapitre
await p.click('[data-mode="chap"]');
check('sommaire par chapitre', !!(await p.$('[data-part="SV-A"]')) && !(await p.$('.letters')));
await p.click('[data-mode="az"]');
check('lettre gardée en revenant', (await p.getAttribute('[data-letter="#"]', 'aria-pressed')) === 'true');
await p.click('#btn-back');
await p.waitForSelector('#go-picked');
check('accueil : 3 cochées', (await p.textContent('#go-picked')).includes('3 définitions'));
const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check('pas de défilement horizontal', !wide);
console.log('erreurs :', errors);
await browser.close();
if (errors.length) process.exit(1);
