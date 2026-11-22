// Test du mode « Schémas à légender » sur téléphone (iPhone 13 émulé).
// Usage : python tools/build_schemas.py source/schemas www/data/schemas.json && node tools/schemas_test.mjs [dossier www]
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';

const dir = process.argv[2] || 'www';
const PORT = 8791;
const URL = `http://localhost:${PORT}/`;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', dir], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
let fails = 0;
const check = (ok, msg) => { console.log(ok ? 'OK  ' : 'ÉCHEC', msg); if (!ok) fails += 1; };
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('fc-bcpst-v1')));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

// 1. Nouvel élève : choisit SV-I-2 seulement
await page.goto(URL);
await page.click('#wel-add');
await page.click('[data-toggle="SV-I"]');
await page.check('input[data-code="SV-I-2"]');
await page.click('#mine-done');
await page.waitForSelector('#go-all');
// quelques définitions travaillées, pour vérifier qu'elles ne sont pas touchées
await page.click('#go-all');
for (let i = 0; i < 4; i++) {
  if (await page.$('#step-go')) await page.click('#step-go');
  if (await page.$('#reveal')) await page.click('#reveal'); else break;
  for (let cb; (cb = await page.$('.keys input:not(:checked)'));) await cb.click();
  const btn = await page.$('.grade .good');
  if (!btn) break;
  await btn.click();
}
await page.goto(URL);
await page.waitForSelector('#go-all');
const before = await saved(page);
check(Object.keys(before.cards).length > 0, `définitions travaillées : ${Object.keys(before.cards).length} cartes`);

// 2. Bascule Bio / Géol
check(await page.$('#go-schemas') !== null, `Bio : bouton présent (« ${await text(page, '#go-schemas')} »)`);
await page.click('.disc button[data-disc="geol"]');
check(await page.$('#go-schemas') === null, 'Géol : pas de bouton (aucun schéma de géologie)');
await page.click('.disc button[data-disc="bio"]');

// 3. Liste : Mes chapitres puis Tous
await page.click('#go-schemas');
await page.waitForSelector('[data-scope]');
const mine = await page.$$eval('[data-sc]', bs => bs.map(b => b.dataset.sc));
check(mine.length === 3 && mine.every(id => ['neurone', 'potentiel-action', 'synapse-neuromusculaire'].includes(id)), `Mes chapitres : ${mine.join(', ')}`);
await page.click('[data-scope="all"]');
const all = await page.$$eval('[data-sc]', bs => bs.map(b => b.dataset.sc));
check(all.length === 8, `Tous les chapitres : ${all.length} schémas`);
await page.screenshot({ path: '/tmp/s1-liste.png', fullPage: true });
await page.click('[data-scope="mine"]');

// 4. Schéma du neurone : aucune réponse cachée dans la page
await page.click('[data-sc="neurone"]');
await page.waitForSelector('#plate svg');
const html = await page.innerHTML('#plate');
check(!/data-terme|<title>/.test(html), 'le SVG publié ne contient pas les réponses (data-terme, title)');
const n = await page.$$eval('#plate g.legende', gs => gs.length);
check(n === 7, `${n} numéros sur le schéma`);
await page.screenshot({ path: '/tmp/s2-schema.png', fullPage: true });

const answers = await page.evaluate(() => Object.fromEntries(schemaRun.rows.map(r => [r.l.n, r.l.terme])));
// numéro 1 : d'abord une mauvaise réponse en touchant le numéro sur le schéma
await page.locator('#plate g.legende[data-n="1"] circle.hit').tap();
await page.waitForSelector('.sheet');
const opts = await page.$$eval('.sheet-opts button', bs => bs.map(b => b.textContent));
check(opts.length === 6 && opts.includes(answers[1]), `menu du n° 1 : ${opts.length} propositions dont la bonne`);
await page.screenshot({ path: '/tmp/s3-menu.png' });
await page.click(`.sheet-opts button:not(:text-is("${answers[1]}"))`);
check(await page.$('.sch-row.ko[data-n="1"]') !== null, 'mauvaise réponse marquée en rouge');
// puis la bonne, via la ligne de la liste
await page.click('.sch-row[data-n="1"]');
await page.click(`.sheet-opts button:text-is("${answers[1]}")`);
for (let k = 2; k <= 7; k++) {
  await page.locator(`#plate g.legende[data-n="${k}"] circle.hit`).tap();
  await page.click(`.sheet-opts button:text-is("${answers[k]}")`);
}
const score = await text(page, '.card.center .big');
check(score === '6 / 7 du premier coup', `score final : « ${score} »`);
await page.screenshot({ path: '/tmp/s4-fini.png', fullPage: true });

const after = await saved(page);
check(Object.keys(after.schemaCards).length === 7, `7 légendes enregistrées (${Object.keys(after.schemaCards).length})`);
check(after.schemaLog.length === 7, `une seule réponse notée par légende (${after.schemaLog.length})`);
check(JSON.stringify(after.cards) === JSON.stringify(before.cards) && JSON.stringify(after.log) === JSON.stringify(before.log), 'définitions : cartes et journal intacts');

// 5. Retour au schéma : seule la légende ratée est redemandée
await page.click('#sch-list');
await page.click('[data-sc="neurone"]');
await page.waitForSelector('#plate svg');
const todo = await page.$$eval('.sch-row.todo', ls => ls.map(l => l.dataset.n));
check(todo.length === 1 && todo[0] === '1', `légendes redemandées : ${todo.join(', ')}`);
await page.click('#sch-list');

// 6. Sauvegarde puis restauration dans un navigateur neuf
await page.goto(URL);
await page.waitForSelector('#go-all');
await page.click('#btn-settings');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const backupPath = '/tmp/sauvegarde-schemas.json';
await dl.saveAs(backupPath);
const ctx2 = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errors.push(e.message));
await p2.goto(URL);
await p2.waitForSelector('#wel-add');
await p2.click('#btn-settings');
await p2.setInputFiles('#import', backupPath);
await p2.waitForSelector('#m-ok');
await p2.click('#m-ok');
await p2.waitForTimeout(300);
const r = await saved(p2);
check(JSON.stringify(r.schemaCards) === JSON.stringify(after.schemaCards), 'sauvegarde restaurée : progression des schémas intacte');
check(JSON.stringify(r.cards) === JSON.stringify(after.cards), 'sauvegarde restaurée : définitions intactes');

// 7. Ancien stockage sans schémas (élève qui met à jour) : l'appli démarre et le mode fonctionne
const ctx3 = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const p3 = await ctx3.newPage();
p3.on('pageerror', e => errors.push(e.message));
const legacy = { ...before }; delete legacy.schemaCards; delete legacy.schemaLog;
await p3.addInitScript(s => { if (!localStorage.getItem('fc-bcpst-v1')) localStorage.setItem('fc-bcpst-v1', s); }, JSON.stringify(legacy));
await p3.goto(URL);
await p3.waitForSelector('#go-schemas');
await p3.click('#go-schemas');
await p3.click('[data-sc="neurone"]');
await p3.locator('#plate g.legende[data-n="2"] circle.hit').tap();
await p3.click('.sheet-opts button >> nth=0');
const l3 = await saved(p3);
check(Object.keys(l3.schemaCards).length === 1 && JSON.stringify(l3.cards) === JSON.stringify(before.cards), 'stockage d’avant les schémas : réponse enregistrée, définitions intactes');

check(!errors.length, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`);
await browser.close();
server.kill();
console.log(fails ? `${fails} échec(s)` : 'tout est bon');
process.exit(fails ? 1 : 0);
