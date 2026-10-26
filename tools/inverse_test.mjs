// Test des cartes « définition → terme » en entraînement libre : saisie, correction, hors calendrier, mode mélangé.
import { chromium } from 'playwright';
import { createRequire } from 'module';

const base = process.env.BASE_URL || 'http://localhost:8765';
const Q = createRequire(import.meta.url)('../www/qcm.js');
const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

const cards = [
  { id: 'pendage', term: 'pendage', codes: ['SV-A-1'], def: 'Angle que forme une strate par rapport à l’horizontale ; le pendage se mesure dans le sens de la pente.' },
  { id: 'adn', term: 'acide désoxyribonucléique (ADN)', codes: ['SV-A-1'], def: 'Polymère de nucléotides porteur de l’information génétique.' },
  { id: 'autotrophe', term: 'autotrophe', codes: ['SV-A-1'], def: 'Organisme capable de produire sa matière organique à partir de matière minérale.' },
];
const termOf = shown => cards.find(c => Q.maskTerm(c.def, c.term).text === shown);

const browser = await chromium.launch();
async function open(direction) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.route('**/data/definitions.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 't', cards }) }));
  await p.addInitScript(d => {
    if (!localStorage.getItem('fc-bcpst-v1')) localStorage.setItem('fc-bcpst-v1', JSON.stringify({ selection: ['SV-A'], settings: { direction: d } }));
  }, direction);
  await p.goto(`${base}/`);
  await p.waitForSelector('#go-last');
  return p;
}
const saved = p => p.evaluate(() => JSON.parse(localStorage.getItem('fc-bcpst-v1')));

// définition → terme
let p = await open('dt');
check(await p.$eval('#dir', s => s.value) === 'dt', 'réglage du sens non repris');
await p.click('#go-last');
check(!(await p.$('#cards-go')), 'échauffement QCM proposé en définition → terme');
const seen = [];
for (let i = 0; i < 6 && await p.$('.tag.rev'); i++) {
  const shown = (await p.textContent('.def')).trim();
  const c = termOf(shown);
  check(c, 'définition affichée inconnue : ' + shown);
  check(!/pendage/i.test(shown), 'terme visible dans la définition');
  seen.push(c.id);
  if (c.id === 'pendage') {
    if (seen.filter(x => x === 'pendage').length === 1) {
      await p.fill('#rev-input', 'inclinaison');
      await p.press('#rev-input', 'Enter');
      check(await p.$('.grade .again'), 'pas de choix Su/Raté après une réponse différente');
      await p.click('.grade .again');
    } else {
      await p.fill('#rev-input', 'Pendages');
      await p.press('#rev-input', 'Enter');
      check(await p.$('#rev-next'), 'réponse juste (pluriel, majuscule) non reconnue');
      await p.keyboard.press('Enter');
    }
  } else if (c.id === 'adn') {
    await p.fill('#rev-input', 'ADN');
    await p.click('#rev-form button');
    check(await p.$('#rev-next'), 'sigle non reconnu');
    await p.click('#rev-next');
  } else {
    await p.click('#rev-form button'); // sans réponse tapée
    check((await p.textContent('h2.term')).trim() === c.term, 'terme non affiché au verso');
    await p.keyboard.press('2');
  }
}
console.log('cartes vues :', seen.join(', '));
check(seen.length === 4 && seen.filter(x => x === 'pendage').length === 2, 'la carte ratée ne revient pas une seule fois');
check((await p.textContent('.hero .big')).includes('Séance terminée'), 'fin de séance absente');
check(!(await p.$('#ahead')), 'réviser en avance proposé en définition → terme');
let st = await saved(p);
check(Object.keys(st.cards || {}).length === 0, 'les cartes inversées ont modifié le calendrier');
check(st.revLog.length === 4 && st.revLog.filter(x => !x.ok).length === 1, 'journal des cartes inversées incorrect');
check(!p.errors.length, 'erreurs JS : ' + p.errors.join(' | '));

// annuler une réponse inversée
p = await open('dt');
await p.click('#go-last');
await p.click('#rev-form button');
await p.click('.grade .again');
await p.click('#undo');
check(await p.$('.grade .again') && (await saved(p)).revLog.length === 0, 'annulation de la réponse inversée');
check(!p.errors.length, 'erreurs JS : ' + p.errors.join(' | '));

// les deux, mélangés : cartes dans les deux sens, seules les cartes directes entrent dans le calendrier
p = await open('mix');
await p.click('#go-last');
if (await p.$('#cards-go')) await p.click('#cards-go');
let fwd = 0, rev = 0;
for (let i = 0; i < 20 && await p.$('.flash'); i++) {
  if (await p.$('.tag.rev')) { rev++; await p.click('#rev-form button'); await p.click('.grade .good'); }
  else { fwd++; await p.click('#reveal'); await p.click('.grade .good'); }
}
console.log('mélangé :', fwd, 'directes,', rev, 'inversées');
check(fwd === 3 && rev === 3, 'répartition du mode mélangé');
st = await saved(p);
check(Object.keys(st.cards).length === 3 && st.revLog.length === 3, 'calendrier ou journal en mode mélangé');
check(!p.errors.length, 'erreurs JS : ' + p.errors.join(' | '));

// changement du réglage depuis l'accueil
p = await open('td');
await p.selectOption('#dir', 'mix');
check((await saved(p)).settings.direction === 'mix', 'réglage non enregistré');

await browser.close();
if (fail.length) { console.log('ÉCHECS :\n- ' + fail.join('\n- ')); process.exit(1); }
console.log('OK');
