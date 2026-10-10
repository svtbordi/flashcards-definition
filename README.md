# Flashcards BCPST

Application installable (téléphone Android ou iPhone, ordinateur) pour apprendre les définitions de SVT du programme BCPST avec la répétition espacée. Une définition réussie revient de plus en plus tard ; une définition ratée revient 10 minutes plus tard, puis quelques jours après. Le calendrier est calculé par l'algorithme FSRS (bibliothèque [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), licence MIT).

## Ce que fait l'application

- Entraînement sur un chapitre, plusieurs, tout le programme, ou « Mes chapitres commencés » (les chapitres où l'élève a déjà répondu au moins une fois).
- Ordre d'une séance : cartes ratées dans la séance, puis cartes à revoir (les plus menacées d'oubli d'abord), puis nouvelles cartes (20 par jour par défaut, dans l'ordre du programme).
- Révision en avance avant une colle, sans fausser le calendrier.
- Échauffement par QCM, proposé au début d'une séance sur un ou plusieurs chapitres (et conseillé la première fois qu'un thème est abordé) : 10 définitions, le terme masqué, à retrouver parmi quatre termes. Les trois leurres sont les termes les plus proches par le sens (mots communs aux définitions) et par la forme (anémogamie, entomogamie, anémochorie), de préférence du même chapitre ; les cas particuliers (synapse / synapse chimique) et les quasi-synonymes sont écartés. Correction après chaque question, score à la fin, puis les flashcards du thème, toujours. Une erreur au QCM compte comme « Raté » pour le calendrier ; une bonne réponse ne compte pas comme « Su », car reconnaître un terme ne prouve pas qu'on saurait retrouver sa définition. Les définitions ratées reviennent en flashcard dix minutes plus tard. Pas d'échauffement pour les révisions du jour sur tout le programme.
- Signalement d'une erreur (icône ⚠ sur une flashcard retournée, une question de QCM corrigée ou une définition du lexique) : erreur de définition, coquille, question ambiguë (QCM) ou autre avec une précision. L'enseignant reçoit un mail ; l'élève ne voit pas l'adresse. Hors connexion, le signalement part plus tard.
- Objectif quotidien, jours d'affilée, avertissement le soir si l'objectif n'est pas atteint.
- Rappel quotidien ajouté au calendrier du téléphone (fichier .ics) et nombre de cartes à revoir sur l'icône (Android et ordinateur).
- Lexique (loupe en haut de l'écran) : recherche d'un terme avec complétion, accents facultatifs, ou sommaire des parties et sous-parties avec leurs termes par ordre alphabétique ; la définition s'ouvre dans une bulle. Le lexique n'est pas accessible pendant une séance.
- Progression par partie et liste des définitions les plus ratées.
- Mise à jour des définitions : automatique quand l'enseignant publie un nouveau tableur, ou import d'un fichier .xlsx par l'élève. La progression est conservée pour chaque terme inchangé.
- Fonctionne sans connexion une fois installée.
- Sauvegarde et restauration de la progression dans un fichier.

## Suivi par l'enseignant (bilans)

L'application n'envoie rien toute seule. Pour un suivi, l'élève ouvre « Ma progression », puis « Préparer mon bilan pour le professeur », indique son nom et enregistre le fichier du bilan (ou le copie) pour te l'envoyer par l'ENT ou par mail.

Le bilan contient : réponses sur 7 et 30 jours et taux de réussite, jours de travail, définitions vues et acquises, progression par partie du programme, 20 définitions les plus ratées sur 30 jours, nombre de réponses par jour.

Pour regrouper les bilans : ouvre `prof.html` (lien « Espace enseignant » en bas des Réglages), dépose les fichiers ou colle les textes reçus. La page affiche un tableau par élève (les élèves sans activité dans la semaine sont signalés), un tableau par partie et les définitions les plus ratées de la classe, et exporte le tout en tableur Excel. Rien n'est envoyé : les bilans sont lus dans ton navigateur.

Les bilans sont déclarés par les élèves (un élève peut modifier son fichier) : c'est un outil de suivi, pas de contrôle.

## Données personnelles

Aucune donnée ne quitte l'appareil sans action de l'élève : pas de compte, pas d'e-mail, pas de cookie ni de mesure d'audience. Un signalement d'erreur envoie seulement le terme, sa définition, le type de problème et la précision écrite par l'élève, sans son nom. La progression est stockée dans le navigateur de l'élève. Le nom n'est demandé que pour le bilan ; il reste sur l'appareil et ne figure que dans le bilan que l'élève choisit d'envoyer. L'hébergeur sert seulement les fichiers de l'application.

Un élève qui change de téléphone doit exporter puis restaurer sa sauvegarde.

## Mettre à jour les définitions (enseignant)

1. Sur GitHub, ouvrir le dossier `source/`.
2. Remplacer `definitions_SVT.xlsx` par la nouvelle version (« Add file » puis « Upload files », même nom de fichier).
3. Valider. La publication se refait seule en une à deux minutes. Les élèves reçoivent la nouvelle version à la prochaine ouverture avec connexion, ou via Réglages, « Vérifier s'il existe une nouvelle version ».

Format attendu : onglet « Toutes » (sinon le premier onglet), sans ligne d'en-tête ; colonne A le terme, B le ou les codes de partie séparés par des virgules (ex. `SV-G-1, SV-H`), C la définition. Une définition sans code en colonne B n'est pas proposée dans l'application.

Le terme sert d'identifiant : corriger une définition garde la progression des élèves, renommer un terme crée une nouvelle carte. Les majuscules, accents, « œ » et apostrophes typographiques sont ignorés dans cette comparaison.

## Recevoir les signalements (une seule fois)

Le bouton ⚠ n'apparaît que lorsque `www/config.json` contient une adresse. Les mails sont envoyés par un petit script Google qui tourne sur ton compte : ton adresse n'est jamais visible dans l'application.

1. Ouvrir [script.google.com](https://script.google.com) avec le compte Google qui doit recevoir les mails, puis « Nouveau projet ».
2. Remplacer le contenu par celui de `tools/signalement.gs`, puis enregistrer.
3. « Déployer », « Nouveau déploiement », type « Application Web ». Exécuter en tant que : « Moi ». Qui a accès : « Tout le monde ». Autoriser l'accès demandé (envoi de mails en ton nom).
4. Copier l'adresse de l'application Web (elle finit par `/exec`) et la coller dans `www/config.json` sur GitHub : `{ "signalement": "https://script.google.com/macros/s/…/exec" }`.

Le script limite les envois à 60 mails par jour, pour le cas où quelqu'un utiliserait l'adresse pour t'envoyer des messages en masse. Pour arrêter les signalements, vide l'adresse dans `config.json` ou archive le déploiement.

## Mise en ligne (une seule fois)

1. Pousser ce dossier dans un dépôt GitHub (branche `main`).
2. Dans le dépôt : Settings, Pages, « Source : GitHub Actions ».
3. L'adresse de l'application s'affiche dans l'onglet Actions après la première publication (`https://<compte>.github.io/<dépôt>/`).
4. Donner cette adresse aux élèves. Sur iPhone, ouvrir dans Safari puis Partager, « Sur l'écran d'accueil ». Sur Android, menu de Chrome puis « Installer l'application ».

## Développement

```
npm install          # bibliothèques et Playwright pour les tests
npm run serve        # http://localhost:8765
npm test             # parcours complet dans un navigateur de téléphone simulé
node tools/bilan_test.mjs /tmp   # bilans de trois élèves simulés, regroupement et export Excel
node tools/qcm_test.mjs          # masquage et leurres sur toute la base, puis un échauffement complet et un signalement
```

- `www/` : l'application (HTML, CSS, JavaScript sans étape de compilation).
- `www/vendor/` : ts-fsrs 5.4.2 (FSRS-6) et SheetJS 0.18.5, copiés depuis npm.
- `www/data/chapters.json` : titres des parties et sous-parties du programme 2021.
- `tools/build_data.py` : convertit le tableur en `www/data/definitions.json`.
- `www/qcm.js` : masquage du terme dans sa définition et choix des leurres du QCM (testé par `node tools/qcm_test.mjs`).
- `tools/signalement.gs` : script Google qui transforme un signalement en mail.
- `tools/build_artifact.py` : assemble la version d'aperçu publiée sur claude.ai.

Réglages de l'algorithme (dans `app.js`) : rétention cible 90 % (modifiable par l'élève : 85 ou 95 %), étape d'apprentissage et de réapprentissage 10 minutes, intervalle maximal 365 jours, légère variation aléatoire des dates. Une carte est comptée « acquise » au-delà de 21 jours de stabilité.

## Limites connues

- Pas de vraie notification push : une web app ne peut pas programmer seule une alerte « tu n'as pas fait tes cartes ». La prochaine étape prévue est d'emballer ce même code en application native (Capacitor) avec des notifications locales.
- Sur iPhone, une page non installée peut voir ses données effacées par Safari après plusieurs semaines sans visite. Il faut l'installer sur l'écran d'accueil.
