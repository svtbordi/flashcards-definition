// Test du suivi par l'enseignant : envoi automatique du bilan sous un code, sans le nom, puis lecture dans la page enseignant.
import { chromium, devices } from 'playwright';
import fs from 'fs';
import vm from 'vm';
import { createRequire } from 'module';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const SCRIPT = 'https://script.google.com/macros/s/test/exec';
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

/* ---------- Script du tableur, avec un faux Google Sheets ---------- */
function fakeSheets() {
  const sheets = {};
  const sheet = name => {
    const rows = [];
    const s = {
      rows,
      appendRow: r => rows.push(r.slice()),
      setFrozenRows() {}, getLastRow: () => rows.length, getLastColumn: () => Math.max(0, ...rows.map(r => r.length)),
      getRange(a, c, nr, nc) {
        if (typeof a === 'string') return { getValues: () => rows.map(r => [r[0]]) };
        return {
          setFontWeight() {}, insertCheckboxes() {},
          getValues: () => rows.slice(a - 1, a - 1 + nr).map(r => r.slice(c - 1, c - 1 + nc)),
          setValues: v => { rows[a - 1] = v[0].slice(); },
        };
      },
    };
    return s;
  };
  const props = {};
  return {
    sheets,
    ctx: {
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)), getUrl: () => '' }) },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; } }) },
      Utilities: { formatDate: () => '2026-10-18', sleep() {} },
      ContentService: { createTextOutput: t => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      Session: {}, MailApp: {},
      newSheet: sheet,
    },
  };
}
const gs = fs.readFileSync(new URL('./signalement.gs', import.meta.url), 'utf8').replace("const CLE_ENSEIGNANT = '';", "const CLE_ENSEIGNANT = 'phrase de test';");
const fk = fakeSheets();
vm.createContext(fk.ctx);
vm.runInContext(gs + '\nthis.doPost = doPost; this.doGet = doGet;', fk.ctx);
const post = o => fk.ctx.doPost({ postData: { contents: JSON.stringify(o) } }).t;
const bil = n => ({ app: 'flashcards-bcpst-bilan', nom: 'Alice', genere: new Date().toISOString(), resume: { reponses_7j: n, reponses_30j: n, ratees_30j: 1, reponses_total: n, ratees_total: 1, derniere_utilisation: new Date().toISOString() }, plus_ratees_total: [{ terme: '=cmd', ratees: 2 }] });
check(post({ nature: 'suivi', code: 'K7QM4P', bilan: bil(5) }) === 'ok', 'script : premier envoi refusé');
check(post({ nature: 'suivi', code: 'k7qm4p', bilan: bil(9) }) === 'ok', 'script : deuxième envoi refusé');
const suivi = fk.sheets.Suivi.rows;
check(suivi.length === 2 && suivi[1][0] === 'K7QM4P' && suivi[1][3] === 9 && suivi[1][5] === 11, 'script : une ligne par code, mise à jour : ' + JSON.stringify(suivi.map(r => r.slice(0, 3))));
check(suivi[1][10].startsWith("'="), 'script : formule non neutralisée');
check(JSON.parse(suivi[1][11]).nom === 'K7QM4P', 'script : un nom est resté dans le bilan');
check(post({ nature: 'suivi', code: 'x', bilan: bil(1) }) === 'refusé', 'script : code invalide accepté');
fk.sheets.Codes = fk.ctx.newSheet('Codes');
fk.sheets.Codes.rows.push(['K7QM4P']);
check(post({ nature: 'suivi', code: 'ZZZZ99', bilan: bil(1) }) === 'code inconnu', 'script : code absent de l’onglet Codes accepté');
check(post({ nature: 'suivi', code: 'K7QM4P', bilan: bil(3) }) === 'ok', 'script : code de l’onglet Codes refusé');
const read = cle => JSON.parse(fk.ctx.doGet({ parameter: { cle } }).t);
check(read('mauvaise').erreur, 'script : lecture avec une mauvaise clé');
check(read('phrase de test').bilans.length === 1, 'script : lecture avec la bonne clé');
check(!fk.sheets.Signalements, 'script : un bilan de suivi est arrivé dans Signalements');

/* ---------- Application de l'élève ---------- */
const browser = await chromium.launch();
const errors = [];
const posts = [];
// sans service worker : il lirait le vrai config.json, que page.route n'intercepte pas
const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.route('**/config.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ signalement: SCRIPT, suivi: true }) }));
await p.route('https://script.google.com/**', r => {
  if (r.request().method() === 'POST') posts.push(JSON.parse(r.request().postData()));
  r.fulfill({ body: 'ok' });
});
await p.goto(`${base}/`);
await p.waitForSelector('#go-all');
// un nom saisi pour le bilan manuel ne doit jamais partir avec le suivi
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('fc-bcpst-v1') || '{}');
  s.settings = Object.assign(s.settings || {}, { studentName: 'Alice Martin' });
  localStorage.setItem('fc-bcpst-v1', JSON.stringify(s));
});
await p.reload();
await p.click('#go-progress');
await p.fill('#suivi-code', 'k7 qm4p');
await p.click('#suivi-start');
await p.waitForFunction(() => document.querySelector('#suivi h2')?.textContent.includes('activé'));
await p.waitForTimeout(300);
check(posts.length === 1 && posts[0].nature === 'suivi' && posts[0].code === 'K7QM4P' && posts[0].bilan.nom === 'K7QM4P', 'élève : premier envoi ' + JSON.stringify(posts.map(x => [x.nature, x.code])));
await p.screenshot({ path: `${out}/suivi-eleve.png` });
// séance de 6 réponses, puis retour à l'accueil : envoi seulement si 10 minutes ont passé
await p.click('#btn-back');
await p.click('#go-all');
for (let i = 0; i < 6 && await p.$('#reveal'); i++) {
  await p.click('#reveal');
  await p.click('.grade .again');
}
await p.click('#btn-back');
await p.waitForTimeout(300);
check(posts.length === 1, 'élève : envoi trop rapproché ' + posts.length);
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('fc-bcpst-v1'));
  s.suivi.t = new Date(Date.now() - 11 * 60e3).toISOString();
  localStorage.setItem('fc-bcpst-v1', JSON.stringify(s));
});
await p.reload();
await p.waitForSelector('#go-all');
await p.waitForTimeout(500);
check(posts.length === 2 && posts[1].bilan.resume.reponses_7j === 6, 'élève : bilan après la séance ' + (posts[1] && posts[1].bilan.resume.reponses_7j));
await p.reload();
await p.waitForTimeout(300);
check(posts.length === 2, 'élève : renvoi sans nouvelle réponse');
check(!JSON.stringify(posts).includes('Alice'), 'élève : le nom est parti avec le suivi');
// arrêt du suivi
await p.click('#go-progress');
p.once('dialog', d => d.accept());
await p.click('#suivi-stop');
await p.waitForSelector('#suivi-code');
// code invalide
await p.fill('#suivi-code', 'a!');
await p.click('#suivi-start');
await p.waitForSelector('#toast:not([hidden])');
check((await p.textContent('#toast')).includes('non valide'), 'élève : code invalide accepté');
// sans « suivi »: true dans config.json, rien n'apparaît
const p2 = await ctx.newPage();
await p2.route('**/config.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ signalement: SCRIPT }) }));
await p2.goto(`${base}/`);
await p2.waitForSelector('#go-all');
await p2.click('#go-progress');
check(!(await p2.$('#suivi')), 'élève : suivi proposé alors qu’il n’est pas activé');

/* ---------- Page enseignant ---------- */
const t = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
const q = await t.newPage();
q.on('pageerror', e => errors.push(e.message));
await q.route('**/config.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ signalement: SCRIPT }) }));
const gets = [];
await q.route('https://script.google.com/**', r => {
  const u = new URL(r.request().url());
  gets.push(u.search);
  const ok = u.searchParams.get('cle') === 'phrase de test';
  r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(ok ? { bilans: [posts[1].bilan] } : { erreur: 'Clé incorrecte.' }) });
});
await q.goto(`${base}/prof.html`);
await q.fill('#cle', 'fausse');
await q.click('#load-suivi');
await q.waitForSelector('#toast:not([hidden])');
check((await q.textContent('#toast')).includes('incorrecte'), 'enseignant : mauvaise clé non signalée');
await q.fill('#cle', 'phrase de test');
await q.click('#load-suivi');
await q.waitForSelector('#results table');
check((await q.textContent('#results')).includes('K7QM4P'), 'enseignant : bilan du code absent');
const csv = `${out}/correspondance.csv`;
fs.writeFileSync(csv, 'Code,Nom\nK7QM4P,Alice Martin\n');
await q.setInputFiles('#names', csv);
await q.waitForFunction(() => document.getElementById('results').textContent.includes('Alice Martin'));
check(!(await q.textContent('#results')).includes('K7QM4P'), 'enseignant : le code reste affiché à la place du nom');
// statistiques demandées : par élève (dernière utilisation, jours sans utilisation, Su et Raté depuis le début), par thème, classe
const head = await q.$$eval('#results section:first-of-type th', ths => ths.map(t => t.textContent));
check(['Dernière utilisation', 'Jours sans utilisation', 'Su (%)', 'Raté (%)'].every(h => head.includes(h)), 'enseignant : colonnes élève ' + head);
const cells = await q.$$eval('#results section:first-of-type tbody td', tds => tds.map(t => t.textContent));
check(cells[2] === '0' && cells[5] === '0 %' && cells[6] === '100 %', 'enseignant : valeurs élève ' + cells);
await q.click('details.student summary');
const themes = await q.$$eval('details.student tbody tr', trs => trs.map(t => t.cells[0].textContent));
check(themes.length >= 1 && themes.every(t => /^(SV|BG|ST)-[A-K]$/.test(t)), 'enseignant : thèmes de l’élève ' + themes);
const titles = await q.$$eval('#results h2', h => h.map(x => x.textContent));
check(titles.some(t => t.includes('classe, par thème')) && titles.some(t => t.includes('plus ratées')), 'enseignant : sections classe ' + titles);
const [xdl] = await Promise.all([q.waitForEvent('download'), q.click('#export')]);
const xpath = `${out}/${xdl.suggestedFilename()}`;
await xdl.saveAs(xpath);
const XL = createRequire(import.meta.url)('../www/vendor/xlsx.full.min.js');
const sheetsOut = XL.read(fs.readFileSync(xpath)).SheetNames;
check(['Élèves', 'Élèves par thème', 'Classe par thème', 'Les plus ratées'].every(n => sheetsOut.includes(n)), 'enseignant : onglets exportés ' + sheetsOut);
check(gets.every(s => !s.includes('Alice')), 'enseignant : le nom est parti en ligne');
await q.screenshot({ path: `${out}/suivi-enseignant.png`, fullPage: true });
// export .csv de l'onglet « Suivi » (guillemets doublés) déposé à la place de la lecture en ligne
const q2 = await t.newPage();
await q2.goto(`${base}/prof.html`);
const row = ['K7QM4P', '18/10/2026', 6, JSON.stringify(posts[1].bilan)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
fs.writeFileSync(`${out}/Suivi.csv`, 'Code,Dernier envoi,Réponses 7 j,Bilan\n' + row + '\n');
await q2.setInputFiles('#files', `${out}/Suivi.csv`);
await q2.waitForSelector('#results table');
check((await q2.textContent('#results')).includes('K7QM4P'), 'enseignant : export .csv non lu');
// codes de suivi
await q2.click('#suivi summary');
await q2.fill('#ncodes', '30');
const [dl] = await Promise.all([q2.waitForEvent('download'), q2.click('#make-codes')]);
const xl = `${out}/${dl.suggestedFilename()}`;
await dl.saveAs(xl);
const X = createRequire(import.meta.url)('../www/vendor/xlsx.full.min.js');
const sheetRows = X.utils.sheet_to_json(X.read(fs.readFileSync(xl)).Sheets.Correspondance, { header: 1 });
const made = sheetRows.slice(1).map(r => r[0]);
check(sheetRows[0].join() === 'Code,Nom' && made.length === 30 && new Set(made).size === 30 && made.every(c => /^[A-HJ-NP-Z2-9]{6}$/.test(c)), 'enseignant : codes générés ' + made.slice(0, 3));

await browser.close();
console.log('envois de suivi :', posts.length, '· lectures enseignant :', gets.length, '· erreurs :', errors);
if (errors.length) fails.push('erreurs JavaScript : ' + errors.join(' | '));
if (fails.length) { console.log('ÉCHECS :\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('tout est bon');
