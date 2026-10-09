# Flashcards BCPST

Application installable (téléphone Android ou iPhone, ordinateur) pour apprendre les définitions de SVT du programme BCPST avec la répétition espacée. Une définition réussie revient de plus en plus tard ; une définition ratée revient 10 minutes plus tard, puis quelques jours après. Le calendrier est calculé par l'algorithme FSRS (bibliothèque [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), licence MIT).

## Ce que fait l'application

- Entraînement sur un chapitre, plusieurs, tout le programme, ou « Mes chapitres commencés » (les chapitres où l'élève a déjà répondu au moins une fois).
- Ordre d'une séance : cartes ratées dans la séance, puis cartes à revoir (les plus menacées d'oubli d'abord), puis nouvelles cartes (20 par jour par défaut, dans l'ordre du programme).
- Révision en avance avant une colle, sans fausser le calendrier.
- Objectif quotidien, jours d'affilée, avertissement le soir si l'objectif n'est pas atteint.
- Rappel quotidien ajouté au calendrier du téléphone (fichier .ics) et nombre de cartes à revoir sur l'icône (Android et ordinateur).
- Progression par partie et liste des définitions les plus ratées.
- Mise à jour des définitions : automatique quand l'enseignant publie un nouveau tableur, ou import d'un fichier .xlsx par l'élève. La progression est conservée pour chaque terme inchangé.
- Fonctionne sans connexion une fois installée.
- Sauvegarde et restauration de la progression dans un fichier.

## Données personnelles

Aucune donnée ne quitte l'appareil : pas de compte, pas de nom, pas d'e-mail, pas de cookie ni de mesure d'audience. La progression est stockée dans le navigateur de l'élève. L'hébergeur sert seulement les fichiers de l'application.

Conséquence : l'enseignant n'a aucun suivi des élèves dans cette version, et un élève qui change de téléphone doit exporter puis restaurer sa sauvegarde.

## Mettre à jour les définitions (enseignant)

1. Sur GitHub, ouvrir le dossier `source/`.
2. Remplacer `definitions_SVT.xlsx` par la nouvelle version (« Add file » puis « Upload files », même nom de fichier).
3. Valider. La publication se refait seule en une à deux minutes. Les élèves reçoivent la nouvelle version à la prochaine ouverture avec connexion, ou via Réglages, « Vérifier s'il existe une nouvelle version ».

Format attendu : onglet « Toutes » (sinon le premier onglet), sans ligne d'en-tête ; colonne A le terme, B le ou les codes de partie séparés par des virgules (ex. `SV-G-1, SV-H`), C la définition.

Le terme sert d'identifiant : corriger une définition garde la progression des élèves, renommer un terme crée une nouvelle carte. Les majuscules, accents, « œ » et apostrophes typographiques sont ignorés dans cette comparaison.

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
```

- `www/` : l'application (HTML, CSS, JavaScript sans étape de compilation).
- `www/vendor/` : ts-fsrs 5.4.2 (FSRS-6) et SheetJS 0.18.5, copiés depuis npm.
- `www/data/chapters.json` : titres des parties et sous-parties du programme 2021.
- `tools/build_data.py` : convertit le tableur en `www/data/definitions.json`.
- `tools/build_artifact.py` : assemble la version d'aperçu publiée sur claude.ai.

Réglages de l'algorithme (dans `app.js`) : rétention cible 90 % (modifiable par l'élève : 85 ou 95 %), étape d'apprentissage et de réapprentissage 10 minutes, intervalle maximal 365 jours, légère variation aléatoire des dates. Une carte est comptée « acquise » au-delà de 21 jours de stabilité.

## Limites connues

- Pas de vraie notification push : une web app ne peut pas programmer seule une alerte « tu n'as pas fait tes cartes ». La prochaine étape prévue est d'emballer ce même code en application native (Capacitor) avec des notifications locales.
- Sur iPhone, une page non installée peut voir ses données effacées par Safari après plusieurs semaines sans visite. Il faut l'installer sur l'écran d'accueil.
- 444 définitions n'ont pas encore de code de partie ; elles sont regroupées dans « Définitions sans chapitre ».
