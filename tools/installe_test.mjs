// Bouton « Installer l'application et les rappels » : disparaît quand l'application est installée et le rappel ajouté.
// Bouton « Lexique » dans l'en-tête, plus de bouton Lexique sur l'accueil.
import { chromium, devices } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const browser = await chromium.launch();
const errors = [];
const check = (label, ok) => { console.log(ok ? 'OK   ' : 'ÉCHEC', label); if (!ok) errors.push(label); };
const label = async p => ((await p.$('#go-install')) ? (await p.textContent('#go-install')).trim() : null);

// navigateur : pas installée
let ctx = await browser.newContext({ ...devices['iPhone 13'] });
let p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
check('en-tête : « Déf. » cliquable', (await p.textContent('#btn-lexicon')).includes('Déf.'));
check('plus de bouton Lexique sur l’accueil', !(await p.$('#go-lexicon')));
await p.screenshot({ path: `${out}/inst-1-entete.png`, clip: { x: 0, y: 0, width: 390, height: 120 } });
check('navigateur : ' + await label(p), (await label(p)) === 'Installer l’application et les rappels');
await p.click('#btn-lexicon');
check('le bouton ouvre le lexique', !!(await p.$('#lex-q')));
await ctx.close();

// application installée (ouverte par son icône)
ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
check('installée, sans rappel : ' + await label(p), (await label(p)) === 'Ajouter le rappel quotidien');
await p.click('#go-install');
await p.click('#ics-done');
await p.click('#btn-back');
await p.waitForSelector('#go-all');
check('installée + rappel déjà présent : bouton caché', (await label(p)) === null);
await p.click('#btn-settings');
await p.click('#install-page');
check('page d’installation accessible depuis les réglages', (await p.textContent('#app')).includes('Rappel déjà ajouté'));
await p.screenshot({ path: `${out}/inst-2-page.png` });
// téléchargement du rappel : compte aussi
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('fc-bcpst-v1')); delete s.ui.reminderAdded; localStorage.setItem('fc-bcpst-v1', JSON.stringify(s)); });
await p.goto(`${base}/`);
await p.click('#go-install');
const dl = p.waitForEvent('download').catch(() => null);
await p.click('#ics');
await dl;
await p.click('#btn-back');
await p.waitForSelector('#go-all');
check('installée + rappel téléchargé : bouton caché', (await label(p)) === null);
console.log('erreurs :', errors);
await browser.close();
if (errors.length) process.exit(1);
