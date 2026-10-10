/**
 * Flashcards BCPST : réception des signalements d'erreur et envoi par mail.
 *
 * À installer une fois par l'enseignant (voir README, « Recevoir les signalements ») :
 * script.google.com, Nouveau projet, coller ce fichier, puis Déployer > Nouveau déploiement > Application Web,
 * « Exécuter en tant que : moi », « Qui a accès : tout le monde ». L'adresse obtenue (…/exec) va dans www/config.json.
 *
 * Le mail part vers le compte Google qui a déployé le script : son adresse n'apparaît jamais dans l'application.
 */

const MAX_PAR_JOUR = 60; // au-delà, les signalements du jour sont ignorés (protection contre les envois en masse)

function doPost(e) {
  const p = JSON.parse(e.postData.contents);
  const props = PropertiesService.getScriptProperties();
  const jour = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd');
  const n = Number(props.getProperty('n-' + jour) || 0);
  if (n >= MAX_PAR_JOUR) return ContentService.createTextOutput('limite');
  props.setProperty('n-' + jour, String(n + 1));

  const cut = (s, max) => String(s == null ? '' : s).slice(0, max);
  const lignes = [
    'Terme : ' + cut(p.terme, 200),
    'Problème : ' + cut(p.type, 100),
    'Précision de l\'élève : ' + (cut(p.precision, 500) || '(aucune)'),
    '',
    'Définition affichée : ' + cut(p.definition, 2000),
    'Partie(s) du programme : ' + cut(p.codes, 200),
    'Signalé depuis : ' + cut(p.contexte, 50),
  ];
  if (p.propositions) {
    lignes.push('Propositions du QCM : ' + cut([].concat(p.propositions).join(' | '), 800));
    lignes.push('Réponse choisie : ' + cut(p.choisi, 200));
  }
  lignes.push('', 'Version des définitions : ' + cut(p.version, 40), 'Date : ' + cut(p.date, 40));

  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: '[Flashcards BCPST] ' + cut(p.type, 60) + ' : ' + cut(p.terme, 80),
    body: lignes.join('\n'),
    name: 'Flashcards BCPST',
  });
  return ContentService.createTextOutput('ok');
}
