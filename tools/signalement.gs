/**
 * Flashcards BCPST : réception des signalements d'erreur et des suggestions.
 *
 * Chaque signalement devient une ligne d'un tableur Google (onglet « Signalements »), chaque suggestion ou demande
 * sur l'application une ligne de l'onglet « Suggestions ». À consulter quand on veut,
 * sur ordinateur ou dans l'application Google Sheets. L'envoi d'un mail en plus est facultatif (ENVOYER_MAIL).
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

function doPost(e) {
  const p = JSON.parse(e.postData.contents);
  const props = PropertiesService.getScriptProperties();
  const jour = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
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

// Essai : ouvrir l'adresse …/exec dans un navigateur ajoute une ligne « TEST » au tableur.
function doGet() {
  doPost({ postData: { contents: JSON.stringify({ terme: 'TEST', type: 'Essai depuis un navigateur', precision: 'Ligne à supprimer' }) } });
  return ContentService.createTextOutput('Essai réussi : une ligne TEST a été ajoutée à l\'onglet « Signalements » du tableur.');
}
