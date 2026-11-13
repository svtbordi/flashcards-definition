// Test des définitions cochées : cases du lexique, bouton de l'accueil, séance, conservation après rechargement.
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
await p.waitForSelector('#go-lexicon');
check('pas de bouton « cochées » au départ', !(await p.$('#go-picked')));
await p.click('#go-lexicon');
await p.click('[data-part="SV-A"]');
await p.click('.subs [data-show]:nth-of-type(2)');
await (await p.$$('input.pick'))[0].click();
await (await p.$$('input.pick'))[2].click();
check('bandeau : 2 cochées', (await p.textContent('.pick-banner')).includes('2 définitions cochées'));
await p.screenshot({ path: `${out}/coche-1-lexique.png` });
// la bulle de définition montre la coche, et permet d'en ajouter une
await p.click('.terms .term >> nth=1');
await p.waitForSelector('#def-pick');
check('bulle : terme non coché', !(await p.isChecked('#def-pick')));
await p.check('#def-pick');
await p.screenshot({ path: `${out}/coche-2-bulle.png` });
await p.click('#def-close');
check('3 cochées après la bulle', (await p.textContent('.pick-banner')).includes('3 définitions cochées'));
// tout cocher puis tout décocher la sous-partie
await p.click('[data-pickall]');
const total = (await p.$$('input.pick')).length;
check(`tout cocher : ${total}`, (await p.$$('input.pick:checked')).length === total);
await p.click('[data-pickall]');
check('tout décocher', (await p.$$('input.pick:checked')).length === 0);
for (const i of [0, 1, 2]) await (await p.$$('input.pick'))[i].click();
// conservation après rechargement
await p.reload();
await p.waitForSelector('#go-picked');
const label = (await p.textContent('#go-picked')).replace(/\s+/g, ' ').trim();
check('accueil : ' + label, /3 définitions/.test(label) && /3 jamais vues/.test(label));
await p.screenshot({ path: `${out}/coche-3-accueil.png` });
// limite de nouvelles cartes du jour déjà atteinte : la séance propose quand même les définitions cochées
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('fc-bcpst-v1'));
  const d = new Date(); if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.days = s.days || {}; s.days[key] = Object.assign({ reviews: 0, newCards: 0 }, s.days[key], { newCards: 99 });
  localStorage.setItem('fc-bcpst-v1', JSON.stringify(s));
});
await p.reload();
await p.click('#go-picked');
if (await p.$('#cards-go')) await p.click('#cards-go');
await p.waitForSelector('.flash');
const terms = [];
for (let i = 0; i < 3; i++) {
  if (await p.$('#step-go')) await p.click('#step-go');
  terms.push((await p.textContent('.flash')).replace(/\s+/g, ' ').slice(0, 50));
  await p.click('#reveal');
  for (let cb; (cb = await p.$('.keys input:not(:checked)'));) await cb.click();
  await p.click('.grade .good');
}
console.log('cartes vues :', terms);
await p.waitForSelector('#home');
check('séance de 3 cartes terminée', (await p.textContent('.hero')).includes('3 réponses'));
await p.click('#home');
// une fois travaillées, elles restent dans les révisions espacées même décochées
await p.click('#go-lexicon');
await p.click('#lex-unpick');
await p.click('#m-ok');
check('tout décoché', !(await p.$('#lex-picked')));
const started = await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fc-bcpst-v1')).cards).length);
check('progression gardée après décochage : ' + started, started >= 3);
const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check('pas de défilement horizontal', !wide);
console.log('erreurs :', errors);
await browser.close();
if (errors.length) process.exit(1);
