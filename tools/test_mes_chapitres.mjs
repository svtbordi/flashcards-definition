// Test de « Mes chapitres » : premier lancement, et migration sans perte depuis la version où l'enseignant
// cochait les chapitres. Usage : node tools/test_mes_chapitres.mjs <dossier www ancienne version> <dossier www nouvelle>
// Les deux versions sont servies tour à tour à la même adresse (même origine, donc même stockage).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [oldDir, newDir] = process.argv.slice(2);
const PORT = 8790;
const URL = `http://localhost:${PORT}/`;
let server = null;
const serve = async dir => {
  if (server) { server.kill(); await new Promise(r => setTimeout(r, 400)); }
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', dir], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
};
let fails = 0;
const check = (ok, msg) => { console.log(ok ? 'OK  ' : 'ÉCHEC', msg); if (!ok) fails += 1; };
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

const browser = await chromium.launch();
// pas de service worker : sinon l'ancienne version resterait en cache (la mise à jour réelle est testée à part)
const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
await ctx.route('**/*', r => r.continue()); // intercepter désactive le cache HTTP : la nouvelle version est bien chargée
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

// 1. Ancienne version : l'élève travaille ses révisions du jour (chapitres de l'enseignant)
await serve(oldDir);
await page.goto(URL);
await page.waitForSelector('#go-all');
const heroOld = await text(page, '.hero');
await page.click('#go-all');
for (let i = 0; i < 12; i++) {
  if (await page.$('#step-go')) await page.click('#step-go');
  if (await page.$('#reveal')) await page.click('#reveal'); else break;
  if (i % 3) for (let cb; (cb = await page.$('.keys input:not(:checked)'));) await cb.click();
  const btn = await page.$(i % 3 === 0 ? '.grade .again' : '.grade .good');
  if (!btn) break;
  await btn.click();
}
await page.goto(URL);
await page.waitForSelector('#go-all');
const before = await page.evaluate(() => localStorage.getItem('fc-bcpst-v1'));
const heroBefore = await text(page, '.hero');
const allBefore = await text(page, '#go-all');
// sauvegarde faite avec l'ancienne version
await page.click('#btn-settings');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const backupPath = '/tmp/sauvegarde-ancienne.json';
await dl.saveAs(backupPath);
const b = JSON.parse(before);
console.log('ancienne version :', Object.keys(b.cards).length, 'cartes,', b.log.length, 'réponses');

// 2. Nouvelle version, même navigateur : rien ne doit être perdu
await serve(newDir);
await page.goto(URL);
await page.waitForSelector('#go-all');
const after = JSON.parse(await page.evaluate(() => localStorage.getItem('fc-bcpst-v1')));
const ouverts = JSON.parse(fs.readFileSync(`${newDir}/data/ouverts.json`, 'utf8'));
check(JSON.stringify(after.cards) === JSON.stringify(b.cards), 'toutes les cartes et leur calendrier sont intacts');
check(JSON.stringify(after.log) === JSON.stringify(b.log), 'journal des réponses intact');
check(JSON.stringify(after.days) === JSON.stringify(b.days), 'jours de travail intacts');
check(JSON.stringify(after.mesChapitres) === JSON.stringify([...ouverts.chapitres, '@methodes']), 'Mes chapitres = chapitres proposés par l’enseignant + méthodes');
// même ensemble de cartes en révisions espacées : biologie ∪ géologie = ancien périmètre
const same = await page.evaluate(() => {
  const ids = d => deck.cards.filter(c => inDisc(c, d) && inScope(c, openChapters(), true)).map(c => c.id);
  const union = new Set([...ids('bio'), ...ids('geol')]);
  const legacy = deck.cards.filter(c => inScope(c, legacyChapters(), true)).map(c => c.id);
  return union.size === legacy.length && legacy.every(id => union.has(id));
});
check(same, 'révisions espacées : biologie + géologie = exactement les cartes d’avant');
const heroAfter = await text(page, '.hero');
console.log('   accueil Bio :', heroAfter.slice(0, 70));
check(await page.$('.disc button.on[data-disc="bio"]') !== null, 'bascule Bio / Géol affichée, Bio par défaut');
await page.click('.disc button[data-disc="geol"]');
console.log('   accueil Géol :', (await text(page, '.hero')).slice(0, 70), '| bascule :', await text(page, '.disc'));
const afterToggle = JSON.parse(await page.evaluate(() => localStorage.getItem('fc-bcpst-v1')));
check(JSON.stringify(afterToggle.cards) === JSON.stringify(b.cards) && afterToggle.settings.discipline === 'geol', 'basculer en Géol ne change aucune carte et est mémorisé');
await page.reload(); await page.waitForSelector('#go-all');
check(await page.$('.disc button.on[data-disc="geol"]') !== null, 'Géol retrouvé après relancement');
await page.click('.disc button[data-disc="bio"]');
check(await page.$('#ban-chn') !== null, 'bandeau « Nouveau : vous choisissez vos chapitres » affiché');
console.log('   bouton :', await text(page, '#go-all'), '| avant :', allBefore);
await page.screenshot({ path: '/tmp/m1-migration.png' });
await page.click('#chn-ok');
check(await page.$('#ban-chn') === null, 'bandeau masqué après « J’ai compris »');
await page.reload();
await page.waitForSelector('#go-all');
check(await page.$('#ban-chn') === null, 'bandeau toujours masqué au relancement');

// ajout d'un chapitre par l'élève
await page.click('#go-mine');
await page.waitForSelector('#mine-done');
await page.screenshot({ path: '/tmp/m2-mes-chapitres.png' });
await page.check('input[data-code="SV-B"]');
const withB = JSON.parse(await page.evaluate(() => localStorage.getItem('fc-bcpst-v1'))).mesChapitres;
check(withB.includes('SV-B'), 'SV-B ajouté et enregistré');
await page.uncheck('input[data-code="SV-G"]');
await page.click('#mine-done');
const st2 = JSON.parse(await page.evaluate(() => localStorage.getItem('fc-bcpst-v1')));
check(Object.keys(st2.cards).length === Object.keys(b.cards).length, 'retirer SV-G ne supprime aucune carte');

// 3. Restauration d'une ancienne sauvegarde dans un navigateur neuf avec la nouvelle version
const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
const p2 = await ctx2.newPage();
p2.on('pageerror', e => errors.push(e.message));
await p2.goto(URL);
await p2.waitForSelector('#wel-add');
check(true, 'nouvel élève : carte de bienvenue « Ajouter des chapitres » affichée');
await p2.screenshot({ path: '/tmp/m3-bienvenue.png', fullPage: true });
check(await p2.$eval('#go-all', e => e.disabled), 'révisions du jour désactivées tant qu’aucun chapitre n’est choisi');
await p2.click('#btn-settings');
await p2.setInputFiles('#import', backupPath);
await p2.waitForSelector('#m-ok');
await p2.click('#m-ok');
await p2.waitForTimeout(300);
const r = JSON.parse(await p2.evaluate(() => localStorage.getItem('fc-bcpst-v1')));
check(JSON.stringify(r.cards) === JSON.stringify(b.cards), 'ancienne sauvegarde restaurée : cartes intactes');
check(JSON.stringify(r.mesChapitres) === JSON.stringify([...ouverts.chapitres, '@methodes']), 'ancienne sauvegarde : Mes chapitres recréés');

// 4. Nouvel élève : premier parcours
const ctx3 = await browser.newContext({ serviceWorkers: 'block' });
const p3 = await ctx3.newPage();
p3.on('pageerror', e => errors.push(e.message));
await p3.goto(URL);
await p3.click('#wel-add');
await p3.click('[data-toggle="SV-G"]');
await p3.check('input[data-code="SV-G-1"]');
await p3.click('#mine-done');
await p3.waitForSelector('#go-all');
check(await p3.$('#wel-add') === null, 'après choix : plus de carte de bienvenue');
const hero3 = await text(p3, '.hero');
check(/nouvelles cartes disponibles/.test(hero3), `nouvelles cartes proposées : « ${hero3.slice(0, 70)} »`);
await p3.screenshot({ path: '/tmp/m4-apres-choix.png' });
await p3.click('#go-all');
await p3.waitForSelector('.flash');
const term = await text(p3, '.flash');
console.log('   première carte :', term.slice(0, 60));
// entraînement libre puis « Ajouter aussi à mes chapitres »
await p3.click('#btn-back');
await p3.click('.disc button[data-disc="geol"]');
check(await p3.$('#wel-add') !== null, 'Géol sans chapitre de géologie : carte « Ajoutez des chapitres de géologie »');
check(await p3.$('input[data-code="SV-G"]') === null, 'Géol : pas de chapitres de biologie affichés');
await p3.screenshot({ path: '/tmp/m5-geol-vide.png' });
await p3.click('#go-choose');
check(await p3.$('input[data-code="SV-G"]') === null && await p3.$('input[data-code="BG-A"]') !== null, 'entraînement libre en Géol : ST et BG seulement');
await p3.check('input[data-code="ST-A"]');
await p3.click('#add-mine');
const m3 = JSON.parse(await p3.evaluate(() => localStorage.getItem('fc-bcpst-v1'))).mesChapitres;
check(m3.includes('ST-A') && m3.includes('SV-G-1'), 'entraînement libre : « Ajouter aussi à mes chapitres » fonctionne');

check(!errors.length, 'aucune erreur JavaScript ' + JSON.stringify(errors));
await browser.close();
server.kill();
console.log(fails ? `${fails} échec(s)` : 'Tous les tests passent');
process.exit(fails ? 1 : 0);
