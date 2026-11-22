// Test du mode « Dessiner » des schémas (téléphone émulé + ordinateur) et du suivi enseignant.
// Usage : python tools/build_schemas.py source/schemas www/data/schemas.json && node tools/dessin_test.mjs [dossier www]
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';

const dir = process.argv[2] || 'www';
const PORT = 8792;
const URL = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', dir], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
let fails = 0;
const check = (ok, msg) => { console.log(ok ? 'OK  ' : 'ÉCHEC', msg); if (!ok) fails += 1; };
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('fc-bcpst-v1')));
const errors = [];
const browser = await chromium.launch();

async function newStudent(ctxOpts) {
  const ctx = await browser.newContext({ ...ctxOpts, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(URL);
  await page.click('#wel-add');
  await page.click('[data-toggle="SV-I"]');
  await page.check('input[data-code="SV-I-2"]');
  await page.click('#mine-done');
  await page.waitForSelector('#go-all');
  return page;
}

// trace un trait sur le canevas, en fractions de sa taille
async function stroke(page, pts, touch) {
  const b = await page.locator('#draw').boundingBox();
  const xy = ([x, y]) => [b.x + x * b.width, b.y + y * b.height];
  if (touch) {
    // pointeur tactile simulé via CDP
    const cdp = await page.context().newCDPSession(page);
    const tp = p => { const [x, y] = xy(p); return [{ x, y }]; };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
    for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  await page.mouse.move(...xy(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...xy(p), { steps: 4 });
  await page.mouse.up();
}
const inkPixels = page => page.evaluate(() => {
  const cv = document.getElementById('draw');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1;
  return n;
});

// 1. Téléphone : dessin au doigt
const page = await newStudent(devices['iPhone 13']);
await page.click('#go-schemas');
await page.click('[data-mode="draw"]');
check(await page.$('[data-mode="draw"][aria-checked="true"]') !== null, 'mode « Dessiner » choisi en haut de la liste');
const info = (await page.textContent('[data-sc="capillaire"], [data-sc="neurone"]')).replace(/\s+/g, ' ');
console.log('   bouton :', info);
await page.click('[data-sc="neurone"]');
await page.waitForSelector('#draw');
check(await page.$('#plate, .plate') === null, 'avant la correction, le schéma n’est pas affiché');
await stroke(page, [[0.2, 0.3], [0.4, 0.35], [0.6, 0.5]], true);
const ink1 = await inkPixels(page);
check(ink1 > 50, `trait au doigt dessiné (${ink1} pixels)`);
await page.click('[data-color="#d62828"]');
await page.click('[data-tool="line"]');
await stroke(page, [[0.5, 0.5], [0.8, 0.2]], true);
await page.click('[data-tool="text"]');
const b = await page.locator('#draw').boundingBox();
await page.touchscreen.tap(b.x + b.width * 0.55, b.y + b.height * 0.15);
await page.waitForSelector('.draw-input');
await page.keyboard.type('Noyau');
await page.keyboard.press('Enter');
let r = await page.evaluate(() => drawRun.items.map(i => i.k + (i.s ? ':' + i.s : '') + ':' + i.c));
check(r.length === 3 && r[1] === 'line:#d62828' && r[2] === 'text:Noyau:#d62828', `éléments : ${r.join(', ')}`);
await page.click('[data-tool="eraser"]');
await stroke(page, [[0.2, 0.3], [0.4, 0.35]], true);
const ink2 = await inkPixels(page);
await page.click('#d-undo');
const ink3 = await inkPixels(page);
check(ink2 < ink3, `gomme puis « Annuler » (${ink2} → ${ink3} pixels)`);
await page.screenshot({ path: '/tmp/d1-dessin.png', fullPage: true });
await page.click('#d-correct');
await page.waitForSelector('.plate svg');
const corr = await page.textContent('.plate');
check(/Dendrites/.test(corr) && /Bouton synaptique/.test(corr), 'correction : schéma légendé affiché');
const boxes = await page.$$('.keys input');
check(boxes.length === 7, `${boxes.length} légendes à cocher`);
for (const i of [0, 1, 2, 3, 4]) await boxes[i].check();
await page.screenshot({ path: '/tmp/d2-correction.png', fullPage: true });
await page.click('#d-save');
check((await page.textContent('.card.center .big')).includes('5 / 7'), 'score 5 / 7 affiché');
let st = await saved(page);
check(st.schemaDraw.neurone.length === 1 && st.schemaDraw.neurone[0].ok === 5 && st.schemaDraw.neurone[0].n === 7, 'score enregistré (sans le dessin)');
check(!JSON.stringify(st).includes('Noyau"') && Object.keys(st.schemaCards).length === 0, 'aucun dessin stocké, calendrier « Compléter » intact');
// deuxième essai : 7/7
await page.click('#d-again');
await page.waitForSelector('#draw');
await stroke(page, [[0.1, 0.1], [0.3, 0.3]], true);
await page.click('#d-correct');
for (const c of await page.$$('.keys input')) await c.check();
await page.click('#d-save');
console.log('   après 2 essais :', (await page.textContent('.card.center')).replace(/\s+/g, ' ').trim());
await page.click('#d-list');
const btn = (await page.textContent('[data-sc="neurone"]')).replace(/\s+/g, ' ');
check(/2 essais · dernier 100 % · meilleur 100 %/.test(btn), `liste : « ${btn.trim()} »`);
await page.reload();
await page.click('#go-schemas');
check(await page.$('[data-mode="draw"][aria-checked="true"]') !== null, 'mode « Dessiner » mémorisé après relancement');
// le mode Compléter montre son propre score
await page.click('[data-mode="fill"]');
await page.click('[data-sc="neurone"]');
const ans = await page.evaluate(() => Object.fromEntries(schemaRun.rows.map(x => [x.l.n, x.l.terme])));
for (let k = 1; k <= 7; k++) {
  await page.click(`.sch-row[data-n="${k}"]`);
  await page.click(k === 1 ? `.sheet-opts button:not(:text-is("${ans[1]}"))` : `.sheet-opts button:text-is("${ans[k]}")`);
  if (k === 1) { await page.click('.sch-row[data-n="1"]'); await page.click(`.sheet-opts button:text-is("${ans[1]}")`); }
}
await page.click('#sch-list');
const btnFill = (await page.textContent('[data-sc="neurone"]')).replace(/\s+/g, ' ');
check(/86 % de réponses justes/.test(btnFill), `Compléter : « ${btnFill.trim()} »`);
// abandon d'un dessin : confirmation
await page.click('[data-mode="draw"]');
await page.click('[data-sc="synapse-neuromusculaire"]');
await stroke(page, [[0.1, 0.1], [0.3, 0.3]], true);
await page.click('#btn-back');
check(await page.$('[data-mode]') !== null, 'retour (après confirmation) à la liste');

// 2. Bilan pour l'enseignant
const bilan = await page.evaluate(() => buildBilan('TEST'));
const neur = bilan.schemas.find(x => x.id === 'neurone');
check(neur && neur.completer.reponses === 7 && neur.completer.justes === 6 && neur.dessin.essais === 2 && neur.dessin.dernier === 100 && neur.dessin.meilleur === 100,
  `bilan : ${JSON.stringify(neur)}`);
check(!!bilan.resume.derniere_utilisation, 'bilan : dernière utilisation renseignée');
const prof = await page.context().newPage();
prof.on('pageerror', e => errors.push(e.message));
await prof.goto(URL + 'prof.html');
await prof.waitForTimeout(500);
await prof.evaluate(b => { addBilan(b); render(); }, bilan);
const txt = (await prof.textContent('#results')).replace(/\s+/g, ' ');
check(/Schémas à légender/.test(txt) && /Neurone/.test(txt) && /86 %/.test(txt), 'page enseignant : section « Schémas à légender »');
await prof.screenshot({ path: '/tmp/d4-prof.png', fullPage: true });

// 3. Sauvegarde / restauration
const back = await page.evaluate(() => JSON.stringify({ app: 'flashcards-bcpst', store }));
check(back.includes('"schemaDraw"'), 'la sauvegarde contient les scores de dessin');

// 4. Ordinateur : souris, correction à côté du dessin
const pc = await newStudent({ viewport: { width: 1280, height: 900 } });
await pc.click('#go-schemas');
await pc.click('[data-mode="draw"]');
await pc.click('[data-sc="potentiel-action"]');
await stroke(pc, [[0.1, 0.8], [0.3, 0.8], [0.35, 0.2], [0.45, 0.9], [0.9, 0.8]], false);
check(await inkPixels(pc) > 100, 'dessin à la souris');
await pc.click('#d-correct');
const [d1, d2] = await pc.$$eval('.draw-grid.two > div', els => els.map(e => e.getBoundingClientRect().left));
check(d2 > d1 + 100, 'grand écran : correction à côté du dessin');
const nPa = await pc.$$eval('.keys input', x => x.length);
check(nPa === 6, `potentiel d’action : ${nPa} légendes à cocher (le titre donne « potentiel d’action »)`);
await pc.screenshot({ path: '/tmp/d3-ordinateur.png', fullPage: true });

check(!errors.length, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`);
await browser.close();
server.kill();
console.log(fails ? `${fails} échec(s)` : 'tout est bon');
process.exit(fails ? 1 : 0);
