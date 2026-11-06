// Test des paliers de 10 cartes, du retard étalé, de l'objectif ajusté, du rappel à 20 h et des bandeaux de l'accueil.
import { readFileSync } from 'fs';
import { chromium, devices } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const defs = JSON.parse(readFileSync(new URL('../www/data/definitions.json', import.meta.url)));
for (const c of defs.cards) c.keys = []; // pas d'éléments-clés à cocher : « Su » toujours actif
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const KEY = 'fc-bcpst-v1';

const browser = await chromium.launch();
const errors = [];
async function newPage(device) {
  const ctx = await browser.newContext({ ...devices[device], serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.route('**/data/definitions.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(defs) }));
  await p.route('**/data/ouverts.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'x', chapitres: null }) }));
  return p;
}
const text = async (p, sel) => (await p.textContent(sel)).replace(/\s+/g, ' ').trim();
const setStore = (p, s) => p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, s]);
const getStore = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);

// ---------- ordinateur : paliers et messages ----------
const p = await newPage('Desktop Chrome');
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
const st0 = await getStore(p);
check(!st0 || !st0.settings || st0.settings.reminderTime !== '18:00', 'rappel encore à 18 h par défaut');
check(!await p.$('#ban-inst'), 'bandeau d’installation sur ordinateur');
const hero0 = await text(p, '.hero');
console.log('accueil :', hero0);
check(hero0.includes('Objectif du jour : 0 / 20') && hero0.includes('2 paliers de 10'), 'objectif non ajusté aux 20 nouvelles cartes : ' + hero0);

await p.click('#go-all');
await p.waitForSelector('.flash');
// premier palier : 8 « Su », 2 « Raté » → message positif
for (let i = 0; i < 10; i++) {
  await p.click('#reveal');
  await p.click(i < 2 ? '.grade .again' : '.grade .good');
}
await p.waitForSelector('#step-go');
const step1 = await text(p, '.step');
console.log('palier 1 :', step1);
check(step1.includes('Palier 1 terminé') && step1.includes('8 sur 10 justes'), 'bilan du palier 1 faux : ' + step1);
check(await p.$('.step.good') !== null, 'palier à 80 % sans message positif');
check(step1.includes('2 cartes ratées qui reviennent'), 'cartes ratées qui reviennent non signalées');
await p.screenshot({ path: `${out}/pal-1-positif.png` });
await p.keyboard.press('Enter');
await p.waitForSelector('.flash');
// annuler la dernière réponse du palier après la pause, puis la redonner : pas de nouvelle pause
await p.click('#undo');
check(await p.$('.flash.revealed') !== null, 'annulation après la pause impossible');
await p.click('.grade .again');
check(!await p.$('#step-go'), 'pause répétée après une annulation');
// deuxième palier : 7 « Raté » → coup de pouce, débutant
for (let i = 0; i < 10; i++) {
  if (await p.$('#step-go')) break;
  await p.click('#reveal');
  await p.click(i < 6 ? '.grade .again' : '.grade .good');
}
await p.waitForSelector('#step-go');
const step2 = await text(p, '.step');
console.log('palier 2 :', step2);
check(step2.includes('4 sur 10 justes') && await p.$('.step.boost') !== null, 'palier à 40 % sans coup de pouce : ' + step2);
check(/normal au début|premiers jours/.test(step2), 'coup de pouce de début absent : ' + step2);
await p.screenshot({ path: `${out}/pal-2-coup-de-pouce.png` });
// m'arrêter là
await p.click('#step-stop');
await p.waitForSelector('#go-all');
check((await text(p, '.hero')).includes('Objectif du jour : 20 / '), 'réponses du jour non comptées après l’arrêt');

// ---------- bilan des progrès et nouvelles définitions en plus ----------
const g = await text(p, '.gains');
console.log('progrès :', g);
check(/Depuis hier : 1[0-9] nouvelles définitions apprises/.test(g), 'bilan « depuis hier » absent ou faux : ' + g);
await p.click('#go-progress');
check(await p.$('.gains') !== null, 'bilan absent de « Ma progression »');
await p.click('#btn-back');
await p.waitForSelector('#go-all');
// limite du jour atteinte : on fait les nouvelles cartes restantes, puis le bouton « Découvrir » apparaît
const sd = await getStore(p);
sd.settings.newPerDay = 0;
for (const id in sd.cards) sd.cards[id].due = new Date(Date.now() + 30 * 864e5).toISOString();
await setStore(p, sd);
await p.goto(`${base}/`);
await p.waitForSelector('#go-discover');
await p.screenshot({ path: `${out}/pal-6-decouvrir.png`, fullPage: true });
await p.click('#go-discover');
if (await p.$('#cards-go')) await p.click('#cards-go');
await p.waitForSelector('.flash');
const nd = await p.evaluate(() => session.queue.length + 1);
const isNew = await p.$('.tag.new') !== null;
check(nd === 10 && isNew, `découverte : ${nd} cartes, nouvelle : ${isNew}`);

// définition ratée avant-hier puis retrouvée aujourd'hui : comptée comme retrouvée, pas comme nouvelle
const rec = await p.evaluate(() => {
  const ago = d => new Date(Date.now() - d * 864e5).toISOString();
  const saved = store.log;
  store.log = [{ id: 'a', t: ago(10), g: 3 }, { id: 'a', t: ago(2), g: 1 }, { id: 'a', t: ago(0), g: 3 }, { id: 'b', t: ago(0), g: 1 }];
  const r = gains(daysAgoKey(1));
  store.log = saved;
  return r;
});
check(rec.recovered === 1 && rec.learned === 0, 'définitions retrouvées mal comptées : ' + JSON.stringify(rec));

// ---------- retard étalé ----------
const s = await getStore(p);
const realIds = await p.evaluate(() => deck.cards.slice(0, 100).map(c => c.id));
const past = new Date(Date.now() - 5 * 864e5).toISOString();
s.cards = {};
for (const id of realIds) s.cards[id] = { due: past, stability: 3, difficulty: 5, elapsed_days: 0, scheduled_days: 3, reps: 2, lapses: 0, state: 2, last_review: past, learning_steps: 0 };
s.days = {};
s.settings.dailyGoal = 30;
await setStore(p, s);
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
const hero1 = await text(p, '.hero');
console.log('retard :', hero1);
check(hero1.startsWith('60 cartes à revoir'), 'retard non plafonné à 60 : ' + hero1);
check(hero1.includes('40 cartes reportées') && hero1.includes('Pas de nouvelles cartes'), 'retard reporté ou nouvelles cartes : ' + hero1);
check(hero1.includes('Objectif du jour : 0 / 30'), 'objectif faux en cas de retard : ' + hero1);
await p.screenshot({ path: `${out}/pal-3-retard.png` });
await p.click('#go-all');
const n = await p.evaluate(() => session.queue.length + 1);
check(n === 60, `séance de ${n} cartes au lieu de 60`);

// ---------- objectif ajusté et avertissement à l'heure du rappel ----------
const s2 = await getStore(p);
for (const id in s2.cards) s2.cards[id].due = new Date(Date.now() + 30 * 864e5).toISOString();
const few = Object.keys(s2.cards).slice(0, 5);
for (const id of few) s2.cards[id].due = past;
s2.days = {};
s2.settings.newPerDay = 0;
s2.settings.reminderTime = '00:00';
await setStore(p, s2);
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
const hero2 = await text(p, '.hero');
console.log('jour léger :', hero2);
check(hero2.includes('Objectif du jour : 0 / 5'), 'objectif non ramené aux 5 cartes du jour : ' + hero2);
check(hero2.includes('Il vous reste 5 cartes'), 'avertissement absent après l’heure du rappel : ' + hero2);

// ---------- migration du rappel 18 h → 20 h ----------
const s3 = await getStore(p);
s3.settings.reminderTime = '18:00';
delete s3.settings.reminderChosen;
await setStore(p, s3);
await p.goto(`${base}/`);
await p.click('#go-install');
check(await p.inputValue('#rtime') === '20:00', 'ancien rappel à 18 h non passé à 20 h');
await p.fill('#rtime', '18:00');
await p.dispatchEvent('#rtime', 'change');
await p.goto(`${base}/`);
await p.click('#go-install');
check(await p.inputValue('#rtime') === '18:00', 'heure choisie par l’élève écrasée');

// ---------- iPhone : bandeaux ----------
const ph = await newPage('iPhone 13');
await ph.goto(`${base}/`);
await ph.waitForSelector('#go-all');
check(await ph.$('#ban-inst') !== null, 'bandeau d’installation absent sur iPhone au premier jour');
await ph.screenshot({ path: `${out}/pal-4-installer.png` });
await ph.click('#ban-inst-later');
check(!await ph.$('#ban-inst'), 'bandeau d’installation non masqué après « Plus tard »');
// une semaine d'activité sans sauvegarde
const s4 = await getStore(ph);
s4.log = [{ id: 'x', t: new Date(Date.now() - 8 * 864e5).toISOString(), g: 3, s: '' }];
await setStore(ph, s4);
await ph.goto(`${base}/`);
await ph.waitForSelector('#go-all');
check(await ph.$('#ban-back') !== null, 'rappel de sauvegarde absent après 8 jours');
await ph.screenshot({ path: `${out}/pal-5-sauvegarde.png` });
const [dl] = await Promise.all([ph.waitForEvent('download', { timeout: 5000 }).catch(() => null), ph.click('#ban-save')]);
const s5 = await getStore(ph);
check(!!s5.ui.lastBackup, 'date de sauvegarde non enregistrée');
console.log('téléchargement :', dl ? dl.suggestedFilename() : 'partage (iOS)');
await ph.goto(`${base}/`);
check(!await ph.$('#ban-back'), 'rappel de sauvegarde encore là juste après la sauvegarde');

await browser.close();
console.log('erreurs :', errors);
if (errors.length) fail.push('erreurs de page');
if (fail.length) { console.log('ÉCHECS :\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('tout est bon');
