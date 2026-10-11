// Test des révisions limitées aux chapitres vus en cours, des mots-clés à cocher et de la page enseignant.
import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const defs = JSON.parse(readFileSync(new URL('../www/data/definitions.json', import.meta.url)));
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// mots-clés fictifs : les deux premiers mots longs de chaque définition
for (const c of defs.cards) c.keys = (c.def.match(/[a-zà-ÿ]{7,}/gi) || []).slice(0, 2);
const OPEN = ['SV-D-2-1', 'ST-A'];
const inOpen = c => c.codes.some(k => OPEN.some(o => k === o || k.startsWith(o + '-')));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' }); // sinon le cache hors connexion contourne les réponses simulées
const errors = [];
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.route('**/data/definitions.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(defs) }));
await p.route('**/data/ouverts.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'x', chapitres: OPEN }) }));

// entraînement libre sur un chapitre non ouvert (SV-G-1), une carte réussie
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
console.log('accueil :', (await p.textContent('#go-all')).replace(/\s+/g, ' ').trim());
await p.screenshot({ path: `${out}/rev-1-accueil.png`, fullPage: true });
await p.click('#go-choose');
await p.screenshot({ path: `${out}/rev-2-choix.png` });
await p.click('[data-toggle="SV-G"]');
await p.check('input[data-code="SV-G-1"]');
await p.click('#start');
await p.click('#cards-go');
await p.click('#reveal');
check(await p.isDisabled('.grade .good'), '« Su » actif avant de cocher les mots-clés');
await p.keyboard.press('2');
check(await p.$('.flash.revealed') !== null, 'raccourci « Su » accepté sans les mots-clés');
await p.screenshot({ path: `${out}/rev-3-motscles.png` });
const nKeys = (await p.$$('.keys input')).length;
for (let i = 0; i < nKeys; i++) await p.check(`[data-key="${i}"]`);
check(!(await p.isDisabled('.grade .good')), '« Su » toujours inactif après avoir tout coché');
await p.screenshot({ path: `${out}/rev-4-motscles-coches.png` });
const freeTerm = (await p.textContent('h2.term')).trim();
await p.click('.grade .good');
await p.click('#btn-back');
await p.click('#btn-back');

// révisions espacées : nouvelles cartes seulement dans les chapitres ouverts
await p.waitForSelector('#go-all');
await p.click('#go-all');
await p.waitForSelector('.flash');
check(!(await p.$('#qcm-go')), 'échauffement proposé en révisions espacées');
const seen = [];
for (let i = 0; i < 25; i++) {
  if (!(await p.$('.flash'))) break;
  seen.push((await p.textContent('h2.term')).trim());
  await p.click('#reveal');
  await p.click('.grade .again');
}
const byTerm = new Map(defs.cards.map(c => [c.term, c]));
const outside = seen.filter(t => !inOpen(byTerm.get(t)));
check(outside.length === 0, 'cartes hors chapitres ouverts : ' + outside.join(', '));
console.log(`révisions : ${seen.length} cartes vues, toutes dans ${OPEN.join(', ')}`);

// la carte commencée en entraînement libre revient dans les révisions quand elle est due
await p.evaluate(term => {
  const s = JSON.parse(localStorage.getItem('fc-bcpst-v1'));
  for (const id in s.cards) s.cards[id].due = new Date(Date.now() + 864e5 * 30).toISOString();
  const c = Object.keys(s.cards).find(id => id === term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (c) s.cards[c].due = new Date(Date.now() - 1000).toISOString();
  s.days = {};
  localStorage.setItem('fc-bcpst-v1', JSON.stringify(s));
}, freeTerm);
await p.goto(`${base}/`);
await p.click('#go-all');
await p.waitForSelector('.flash');
check((await p.textContent('h2.term')).trim() === freeTerm, `carte d'entraînement libre (${freeTerm}) absente des révisions`);

// page enseignant : cocher, publier vers GitHub (simulé)
const t = await ctx.newPage();
t.on('pageerror', e => errors.push(e.message));
let put = null;
await t.route('**/data/ouverts.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'x', chapitres: OPEN }) }));
await t.route('https://api.github.com/**', r => {
  if (r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: '{"sha":"abc"}' });
  put = JSON.parse(r.request().postData());
  return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
await t.goto(`${base}/chapitres.html`);
await t.waitForSelector('[data-code="SV-D"]');
check(await t.isChecked('[data-code="SV-D-2-1"]'), 'chapitre publié non coché au chargement');
await t.check('[data-code="SV-F"]');
console.log('résumé :', (await t.textContent('#summary')).replace(/\s+/g, ' ').trim());
await t.screenshot({ path: `${out}/rev-5-enseignant.png` });
await t.click('#publish');
check(await t.evaluate(() => document.getElementById('token-box').open), 'pas de demande de clé');
await t.fill('#token', 'github_pat_test');
await t.click('#token-save');
await t.click('#publish');
await t.waitForSelector('#toast:not([hidden])');
console.log('toast :', await t.textContent('#toast'));
const sent = put && JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
check(put && put.sha === 'abc' && put.branch === 'main', 'requête GitHub incorrecte');
check(sent && JSON.stringify(sent.chapitres) === JSON.stringify(['SV-D-2-1', 'SV-F', 'ST-A']), 'liste publiée : ' + JSON.stringify(sent && sent.chapitres));
const wide = await t.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check(!wide, 'défilement horizontal sur la page enseignant');
await browser.close();
fail.push(...errors);
console.log(fail.length ? 'ÉCHECS :\n- ' + fail.join('\n- ') : 'tout est bon');
if (fail.length) process.exit(1);
