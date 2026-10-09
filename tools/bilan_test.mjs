// Test du bilan élève et de la page enseignant : trois élèves simulés, regroupement, export Excel.
import { chromium, devices } from 'playwright';
import fs from 'fs';

const base = process.env.BASE_URL || 'http://localhost:8765';
const out = process.argv[2] || '/tmp';
const browser = await chromium.launch();
const errors = [];
const files = [];
for (const [name, n, fail] of [['Alice Martin', 25, 3], ['Bastien Roux', 12, 2], ['Chloé Petit', 0, 1]]) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}/`);
  await p.waitForSelector('#go-all');
  if (n) {
    await p.click('#go-all');
    for (let i = 0; i < n; i++) {
      if (!(await p.$('#reveal'))) break;
      await p.click('#reveal');
      await p.click(i % fail === 0 ? '.grade .again' : '.grade .good');
    }
    await p.click('#btn-back');
  }
  await p.click('#go-progress');
  await p.click('#go-bilan');
  // sans nom, le bilan est refusé avec un message
  await p.click('#bilan-file');
  await p.waitForSelector('#toast:not([hidden])');
  await p.fill('#sname', name);
  if (name === 'Alice Martin') await p.screenshot({ path: `${out}/bilan-eleve.png` });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#bilan-file')]);
  const path = `${out}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  files.push(path);
  await ctx.close();
}
console.log('bilans', files.map(f => f.split('/').pop()));

const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
await p.goto(`${base}/prof.html`);
await p.setInputFiles('#files', files.slice(0, 2));
// le troisième bilan est collé comme texte, au milieu d'un message
await p.fill('#paste', 'Bonjour, voici mon bilan : ' + fs.readFileSync(files[2], 'utf8') + ' Bonne soirée');
await p.click('#read-paste');
await p.waitForSelector('#export');
console.log('élèves :', await p.$$eval('#results section:first-of-type tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' '))));
await p.screenshot({ path: `${out}/prof.png`, fullPage: true });
const [x] = await Promise.all([p.waitForEvent('download'), p.click('#export')]);
await x.saveAs(`${out}/${x.suggestedFilename()}`);
console.log('tableur', x.suggestedFilename(), 'erreurs', errors);
await browser.close();
if (errors.length) process.exit(1);
