// Réponse écrite facultative : zone d'écriture, éléments-clés précochés, réglage mémorisé, rien de bloqué sans écrire.
import { chromium, devices } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
const check = (label, ok) => { console.log(ok ? 'OK   ' : 'ÉCHEC', label); if (!ok) errors.push(label); };
const current = () => p.evaluate(() => { const c = session.current; return { id: c.id, term: c.term, keys: c.keys || [] }; });
const start = async () => {
  await p.click('#go-all');
  if (await p.$('#cards-go')) await p.click('#cards-go');
  await p.waitForSelector('.flash');
};

await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
await start();
check('par défaut : pas de zone d’écriture', !(await p.$('#typed')) && !!(await p.$('#write-on')));
await p.click('#write-on');
check('zone d’écriture affichée', !!(await p.$('#typed')));
// passer aux cartes qui ont des éléments-clés
let c = await current();
for (let i = 0; i < 30 && c.keys.length < 2; i++) {
  await p.click('#reveal');
  for (let cb; (cb = await p.$('.keys input:not(:checked)'));) await cb.click();
  await p.click('.grade .good');
  if (await p.$('#step-go')) await p.click('#step-go');
  c = await current();
}
console.log('carte :', c.term, c.keys);
// on écrit le premier élément-clé seulement, avec des espaces (la barre d'espace ne doit pas retourner la carte)
await p.fill('#typed', '');
await p.type('#typed', `une idée avec ${c.keys[0]} dedans`);
check('espace dans la zone : carte non retournée', !(await p.$('.def')));
await p.screenshot({ path: `${out}/ecrire-1-recto.png` });
await p.click('#reveal');
check('réponse écrite affichée', (await p.textContent('.typed-answer')).includes('une idée avec'));
const ticks = await p.$$eval('.keys input', bs => bs.map(b => b.checked));
console.log('éléments-clés précochés :', ticks);
check('premier élément-clé précoché, pas les autres', ticks[0] && ticks.slice(1).every(x => !x));
check('« Su » encore bloqué tant que tout n’est pas coché', await p.isDisabled('.grade .good'));
await p.screenshot({ path: `${out}/ecrire-2-verso.png` });
// raté : la carte reviendra, sans le texte précédent
await p.click('.grade .again');
if (await p.$('#step-go')) await p.click('#step-go');
check('carte suivante : zone vide', (await p.inputValue('#typed')) === '');
// réglage mémorisé
await p.reload();
await p.waitForSelector('#go-all');
await start();
check('réglage gardé après rechargement', !!(await p.$('#typed')));
await p.click('#write-off');
check('« Ne plus écrire » : zone retirée', !(await p.$('#typed')));
const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check('pas de défilement horizontal', !wide);
console.log('erreurs :', errors);
await browser.close();
if (errors.length) process.exit(1);
