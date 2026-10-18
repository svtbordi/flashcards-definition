/**
 * Flashcards BCPST : réception des signalements d'erreur, des suggestions et des bilans de suivi.
 *
 * Chaque signalement devient une ligne d'un tableur Google (onglet « Signalements »), chaque suggestion ou demande
 * sur l'application une ligne de l'onglet « Suggestions ». À consulter quand on veut,
 * sur ordinateur ou dans l'application Google Sheets. L'envoi d'un mail en plus est facultatif (ENVOYER_MAIL).
 *
 * Suivi : les élèves qui ont saisi un code de suivi envoient leur bilan, sous ce code et sans leur nom. L'onglet
 * « Suivi » garde une ligne par code (le dernier bilan reçu). Si un onglet « Codes » existe, seuls les codes listés
 * dans sa colonne A sont acceptés. La correspondance code / nom ne doit jamais être mise dans ce tableur.
 * La page enseignant de l'application lit l'onglet « Suivi » avec la clé CLE_ENSEIGNANT.
 *
 * À installer une fois par l'enseignant (voir README, « Recevoir les signalements ») :
 * créer un tableur Google, Extensions > Apps Script, coller ce fichier, puis Déployer > Nouveau déploiement >
 * Application Web, « Exécuter en tant que : moi », « Qui a accès : tout le monde ».
 * L'adresse obtenue (…/exec) va dans www/config.json. Elle n'apparaît jamais dans l'application.
 */

const ENVOYER_MAIL = false; // true : un mail par signalement, en plus de la ligne du tableur
const MAX_PAR_JOUR = 60; // au-delà, les signalements du jour sont ignorés (protection contre les envois en masse)
const COLONNES = ['Reçu le', 'Terme', 'Problème', 'Précision de l\'élève', 'Définition affichée', 'Partie(s)',
  'Signalé depuis', 'Propositions du QCM', 'Réponse choisie', 'Version des définitions', 'Traité'];
const COLONNES_SUGGESTIONS = ['Reçu le', 'Type', 'Message', 'Version des définitions', 'Traité'];
// Phrase secrète de votre choix (longue : au moins 4 mots) : la page enseignant la demande pour lire l'onglet « Suivi ».
// Laissée vide, la lecture depuis la page enseignant est désactivée (le tableur reste consultable directement).
const CLE_ENSEIGNANT = '';
const MAX_SUIVI_PAR_CODE = 100; // envois acceptés par code et par jour
const COLONNES_SUIVI = ['Code', 'Dernier envoi', 'Réponses 7 j', 'Réponses 30 j', 'Réussite 30 j (%)', 'Jours actifs 7 j',
  'Jours actifs 30 j', 'Série (jours)', 'Définitions vues', 'Acquises', 'À revoir', 'Les plus ratées', 'Bilan complet (lu par la page enseignant)'];

function doPost(e) {
  const p = JSON.parse(e.postData.contents);
  const props = PropertiesService.getScriptProperties();
  const jour = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
  if (p.nature === 'suivi') return suivi(p, props, jour);
  const n = Number(props.getProperty('n-' + jour) || 0);
  if (n >= MAX_PAR_JOUR) return ContentService.createTextOutput('limite');
  props.setProperty('n-' + jour, String(n + 1));

  // une cellule qui commence par = + - @ serait lue comme une formule : on la neutralise
  const cut = (s, max) => String(s == null ? '' : s).slice(0, max).replace(/^[=+\-@]/, '\'$&');
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  if (p.nature === 'suggestion') {
    ajouter(classeur, 'Suggestions', COLONNES_SUGGESTIONS,
      [new Date(), cut(p.type, 100), cut(p.message, 1000), cut(p.version, 40), false]);
    return ContentService.createTextOutput('ok');
  }
  const ligne = [new Date(), cut(p.terme, 200), cut(p.type, 100), cut(p.precision, 500), cut(p.definition, 2000),
    cut(p.codes, 200), cut(p.contexte, 50), cut([].concat(p.propositions || []).join(' | '), 800),
    cut(p.choisi, 200), cut(p.version, 40), false];
  ajouter(classeur, 'Signalements', COLONNES, ligne);

  if (ENVOYER_MAIL) {
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: '[Flashcards BCPST] ' + ligne[2] + ' : ' + ligne[1],
      body: COLONNES.slice(1, -1).map((c, i) => c + ' : ' + ligne[i + 1]).join('\n') + '\n\nTableur : ' + classeur.getUrl(),
      name: 'Flashcards BCPST',
    });
  }
  return ContentService.createTextOutput('ok');
}

// Ajoute une ligne à l'onglet (créé au premier envoi), avec une case « Traité » à cocher en dernière colonne.
function ajouter(classeur, nom, colonnes, ligne) {
  let feuille = classeur.getSheetByName(nom);
  if (!feuille) {
    feuille = classeur.insertSheet(nom, 0);
    feuille.appendRow(colonnes);
    feuille.setFrozenRows(1);
    feuille.getRange(1, 1, 1, colonnes.length).setFontWeight('bold');
  }
  feuille.appendRow(ligne);
  feuille.getRange(feuille.getLastRow(), colonnes.length).insertCheckboxes();
}

// Bilan de suivi : une ligne par code dans l'onglet « Suivi », remplacée à chaque envoi.
function suivi(p, props, jour) {
  const code = String(p.code || '').trim().toUpperCase();
  const b = p.bilan;
  if (!/^[A-Z0-9-]{4,20}$/.test(code) || !b || typeof b !== 'object' || !b.resume) return ContentService.createTextOutput('refusé');
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const codes = classeur.getSheetByName('Codes');
  if (codes && !codes.getRange('A:A').getValues().some(r => String(r[0]).trim().toUpperCase() === code)) {
    return ContentService.createTextOutput('code inconnu');
  }
  const cle = 's-' + jour + '-' + code;
  const n = Number(props.getProperty(cle) || 0);
  if (n >= MAX_SUIVI_PAR_CODE) return ContentService.createTextOutput('limite');
  props.setProperty(cle, String(n + 1));

  const r = b.resume;
  const nb = v => (typeof v === 'number' && isFinite(v) ? v : '');
  b.nom = code; // le bilan ne porte jamais de nom
  const ratees = [].concat(b.plus_ratees || []).slice(0, 5).map(x => String(x && x.terme || '').slice(0, 80)).join(' ; ');
  const ligne = [code, new Date(), nb(r.reponses_7j), nb(r.reponses_30j),
    r.reponses_30j > 0 ? Math.round(100 * (r.reponses_30j - r.ratees_30j) / r.reponses_30j) : '',
    nb(r.jours_actifs_7j), nb(r.jours_actifs_30j), nb(r.serie), nb(r.cartes_vues), nb(r.cartes_acquises), nb(r.cartes_a_revoir),
    ratees.replace(/^[=+\-@]/, '\'$&'), JSON.stringify(b).slice(0, 45000)];

  const verrou = LockService.getScriptLock();
  verrou.waitLock(20000); // deux élèves en même temps : pas de ligne en double
  try {
    let feuille = classeur.getSheetByName('Suivi');
    if (!feuille) {
      feuille = classeur.insertSheet('Suivi', 0);
      feuille.appendRow(COLONNES_SUIVI);
      feuille.setFrozenRows(1);
      feuille.getRange(1, 1, 1, COLONNES_SUIVI.length).setFontWeight('bold');
    }
    const derniere = feuille.getLastRow();
    const liste = derniere > 1 ? feuille.getRange(2, 1, derniere - 1, 1).getValues() : [];
    const i = liste.findIndex(x => String(x[0]) === code);
    if (i >= 0) feuille.getRange(i + 2, 1, 1, ligne.length).setValues([ligne]);
    else feuille.appendRow(ligne);
  } finally {
    verrou.releaseLock();
  }
  return ContentService.createTextOutput('ok');
}

// Lecture de l'onglet « Suivi » par la page enseignant (…/exec?cle=…) : les bilans, sans aucun nom.
function lireSuivi(cle) {
  const json = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (!CLE_ENSEIGNANT) return json({ erreur: 'La lecture est désactivée : renseignez CLE_ENSEIGNANT dans le script, puis déployez une nouvelle version.' });
  if (cle !== CLE_ENSEIGNANT) { Utilities.sleep(1500); return json({ erreur: 'Clé incorrecte.' }); }
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Suivi');
  const lignes = feuille && feuille.getLastRow() > 1 ? feuille.getRange(2, 1, feuille.getLastRow() - 1, COLONNES_SUIVI.length).getValues() : [];
  const bilans = [];
  for (const l of lignes) {
    try { bilans.push(JSON.parse(l[COLONNES_SUIVI.length - 1])); } catch (err) { /* ligne modifiée à la main */ }
  }
  return json({ bilans });
}

// Essai : ouvrir l'adresse …/exec dans un navigateur ajoute une ligne « TEST » au tableur.
// Avec ?cle=… : lecture de l'onglet « Suivi » par la page enseignant.
function doGet(e) {
  if (e && e.parameter && e.parameter.cle !== undefined) return lireSuivi(e.parameter.cle);
  doPost({ postData: { contents: JSON.stringify({ terme: 'TEST', type: 'Essai depuis un navigateur', precision: 'Ligne à supprimer' }) } });
  return ContentService.createTextOutput('Essai réussi : une ligne TEST a été ajoutée à l\'onglet « Signalements » du tableur.');
}
