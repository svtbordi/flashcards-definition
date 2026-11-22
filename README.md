# Flashcards BCPST

Application installable (téléphone Android ou iPhone, ordinateur) pour apprendre les définitions de SVT du programme BCPST avec la répétition espacée. Une définition réussie revient de plus en plus tard ; une définition ratée revient 10 minutes plus tard, puis quelques jours après. Le calendrier est calculé par l'algorithme FSRS (bibliothèque [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), licence MIT).

## Ce que fait l'application

- Révisions espacées du jour : les nouvelles cartes viennent seulement de « Mes chapitres », la liste que l'élève compose lui-même (bouton « ＋ Ajouter des chapitres à mes révisions » sur l'accueil, ou « Ajouter aussi à mes chapitres » en entraînement libre), au fil des chapitres vus en cours. « Méthodes et techniques » s'y ajoute comme un chapitre. Retirer un chapitre ne retire aucune carte commencée : les cartes déjà commencées, ici ou ailleurs, continuent d'être révisées selon leur calendrier. La liste est enregistrée avec la progression (sauvegarde comprise).
- Bascule « Bio / Géol » dans le bandeau : l'accueil, les révisions espacées du jour, « Mes chapitres », l'entraînement libre, les méthodes et « Mes chapitres commencés » ne montrent que la biologie (SV) ou la géologie (ST) ; les biogéosciences (BG) sont dans les deux (même carte, une seule révision). Le choix est mémorisé (réglage `discipline`, Bio par défaut) et ne modifie aucune carte. Le nombre de cartes à revoir aujourd'hui dans l'autre discipline (hors BG) s'affiche sur la bascule, pour qu'elles ne s'accumulent pas sans qu'on le voie. La limite de nouvelles cartes par jour et l'objectif quotidien sont communs aux deux disciplines. Le lexique, les définitions cochées et « Ma progression » couvrent tout.
- Premier lancement : tant que « Mes chapitres » est vide, l'accueil montre en trois étapes comment ajouter des chapitres, à la place du bloc des révisions.
- Entraînement libre sur un chapitre, plusieurs (BCPST 1 compris, par exemple pendant les vacances), ou « Mes chapitres commencés ». Les chapitres vus en cours y sont signalés.
- Méthodes et techniques : les définitions marquées « M » en colonne E du tableur (principe et objectif d'une méthode du programme) ont leur bouton en entraînement libre, tous chapitres confondus. Elles restent aussi dans leur chapitre et, sauf si l'enseignant décoche l'option sur la page « Chapitres vus en cours », entrent toujours dans les révisions espacées, car elles servent dans toutes les parties.
- Mots-clés à vérifier : quand une définition a des éléments-clés (colonne D du tableur), ils sont soulignés au verso et l'élève coche ceux qu'il avait cités ; « Su » ne s'active que s'il les a tous. Comparer sa réponse à des éléments précis corrige la tendance à se juger trop vite (Dunlosky et Rawson, 2012).
- Contenu d'une séance : cartes à revoir et nouvelles cartes (20 par jour par défaut en révisions espacées, 50 par jour en entraînement libre, tirées au hasard dans la sélection), présentées dans un ordre aléatoire tiré à chaque séance ; une carte ratée revient dans la séance après 10 minutes. Le QCM d'échauffement porte d'abord sur les cartes de la séance, qui sont ensuite les mêmes en flashcards.
- Révision en avance avant une colle, sans fausser le calendrier.
- Échauffement par QCM, proposé au début d'une séance sur un ou plusieurs chapitres (et conseillé la première fois qu'un thème est abordé) : 10 définitions, le terme masqué, à retrouver parmi quatre termes. Les trois leurres viennent de `source/leurres.csv`, relu par l'enseignante : pour chaque terme, un leurre toujours proposé et deux tirés au hasard parmi quatre, tous de même nature que le terme (molécule, minéral, roche, méthode, principe…). Un leurre cité dans la définition affichée est écarté, et un terme absent du fichier reçoit les termes les plus proches par le sens et par la forme, de préférence du même chapitre. Pour modifier les leurres : éditer ce fichier (séparateur « ; », leurres secondaires séparés par « | ») ; il est publié avec les définitions. Correction après chaque question, score à la fin, puis les flashcards du thème, toujours. Une erreur au QCM compte comme « Raté » pour le calendrier ; une bonne réponse ne compte pas comme « Su », car reconnaître un terme ne prouve pas qu'on saurait retrouver sa définition. Les définitions ratées reviennent en flashcard dix minutes plus tard. Pas d'échauffement pour les révisions du jour sur tout le programme.
- Sens des cartes en entraînement libre (accueil) : terme → définition (par défaut), définition → terme, ou les deux mélangés. Une carte « définition → terme » montre la définition, terme masqué ; l'élève tape le terme (facultatif) puis l'affiche. Une réponse identique au terme, à ses accents, majuscules, pluriel ou sigle près, est comptée juste ; sinon l'élève choisit « Su » (synonyme) ou « Raté », et une carte ratée revient plus loin dans la séance. Ces cartes ne modifient pas le calendrier des révisions espacées (retrouver le terme ne prouve pas qu'on sait la définition) et ne partent pas dans le suivi ; elles sont notées localement dans `revLog`. Les révisions espacées du jour restent toujours dans le sens terme → définition.
- Signalement d'une erreur (icône ⚠ sur une flashcard retournée, une question de QCM corrigée ou une définition du lexique) : erreur de définition, coquille, question ambiguë (QCM) ou autre avec une précision. Le signalement s'ajoute au tableur Google de l'enseignant (mail facultatif) ; l'élève ne voit pas où il part. Hors connexion, le signalement part plus tard.
- Suggestions et demandes (bouton sur l'accueil) : amélioration de l'application, demande (définition ou chapitre à ajouter) ou problème technique, avec un message. Elles arrivent dans l'onglet « Suggestions » du même tableur Google, avec une case « Traité ».
- Paliers de 10 cartes : une séance s'interrompt toutes les 10 réponses (s'il reste des cartes) sur un bilan du palier (« 8 sur 10 justes »), avec « Continuer » ou « M'arrêter là » ; s'arrêter ne perd rien. Message positif à 60 % de réussite ou plus ; en dessous, un coup de pouce, plus explicite pendant les 7 premiers jours d'utilisation. Les messages sont dans `STEP_GOOD`, `STEP_BOOST` et `STEP_BOOST_START` (`www/app.js`).
- Bilan « Vos progrès » sur l'accueil et dans « Ma progression » : depuis hier et sur 7 jours, nouvelles définitions apprises (vues pour la première fois dans la période, dernière réponse autre que « Raté ») et définitions ratées puis retrouvées, d'après le journal des réponses.
- « Découvrir 10 nouvelles définitions » (accueil) : un paquet de nouvelles cartes en plus de la limite du jour, dans les chapitres vus en cours, proposé seulement quand les révisions du jour sont faites et qu'il n'y a pas de retard, car chaque nouvelle carte ajoute des révisions les jours suivants.
- Retard étalé : en révisions espacées, au plus 2 fois l'objectif du jour en réponses (60 avec l'objectif de 30), les cartes les plus menacées d'oubli d'abord ; le reste est reporté aux jours suivants, et aucune nouvelle carte n'est ajoutée tant qu'il reste du retard. En fin de séance, « Faire quand même les cartes en retard » lève la limite.
- Objectif quotidien ramené à ce qui est à faire ce jour-là (objectif réglé, ou moins si le calendrier demande moins de cartes), jours d'affilée, avertissement à partir de l'heure du rappel si l'objectif n'est pas atteint.
- Rappel quotidien ajouté au calendrier du téléphone (fichier .ics, 20 h par défaut ; l'ancien défaut de 18 h passe à 20 h, mais un rappel déjà importé dans le calendrier garde son heure et doit être réimporté) et nombre de cartes à revoir sur l'icône (Android et ordinateur).
- Bandeaux de l'accueil, un à la fois : sur téléphone, tant que l'application n'est pas installée, invitation à l'installer dès le premier jour (bouton sur Android, étapes sur iPhone ; « Plus tard » la masque 3 jours). Sur iPhone, l'application installée ne reprend pas les données de Safari ([WebKit, bug 181849](https://bugs.webkit.org/show_bug.cgi?id=181849)) : le bandeau propose d'abord une sauvegarde, et l'application installée sans progression propose de la restaurer. Une fois par semaine, rappel « Sauvegarder ma progression » en un geste (un site ne peut pas enregistrer un fichier sans geste de l'élève).
- Lexique (loupe en haut de l'écran) : recherche d'un terme avec complétion, accents facultatifs, ou sommaire des parties et sous-parties avec leurs termes par ordre alphabétique ; la définition s'ouvre dans une bulle. Le lexique n'est pas accessible pendant une séance.
- Définitions cochées (lexique) : l'élève coche des termes, un par un, par sous-partie (« Tout cocher ») ou dans la bulle d'une définition, puis lance « Réviser mes définitions cochées » (lexique ou accueil). Ces cartes ne butent pas sur la limite de nouvelles cartes du jour (au plus 20 nouvelles par séance). Une fois travaillées, elles suivent le calendrier des révisions espacées ; décocher ne les en retire pas. La coche est enregistrée avec la progression (sauvegarde comprise).
- Réponse écrite (facultative) : sur une flashcard, « ✎ Écrire ma réponse » ouvre une zone de texte (choix mémorisé, « Ne plus écrire » pour revenir). Au retournement, la réponse s'affiche au-dessus de la définition et les éléments-clés retrouvés dans le texte sont précochés ; l'élève s'évalue toujours lui-même. Le texte n'est ni enregistré ni envoyé. Écrire aide à retenir des définitions (Tauber et al., 2018, J. Appl. Res. Mem. Cogn. 7(1) : 106-115).
- Lexique « De A à Z » : index des lettres (accents ignorés, lettres grecques sous « # ») ; chaque lettre affiche ses termes de tous les chapitres, avec leur code de chapitre et une case à cocher. Pas de « Tout cocher » par lettre.
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

Format attendu : onglet « Toutes » (sinon le premier onglet), sans ligne d'en-tête ; colonne A le terme, B le ou les codes de partie séparés par des virgules (ex. `SV-G-1, SV-H`), C la définition, D (facultative) les éléments-clés séparés par des points-virgules (ex. `pollinisation ; vent`), tels qu'ils apparaissent dans la définition. Une définition sans code en colonne B n'est pas proposée dans l'application.

Le terme sert d'identifiant : corriger une définition garde la progression des élèves, renommer un terme crée une nouvelle carte. Les majuscules, accents, « œ » et apostrophes typographiques sont ignorés dans cette comparaison.

## Chapitres : choisis par les élèves (depuis novembre 2026)

Ce n'est plus l'enseignant qui ouvre les chapitres : chaque élève compose « Mes chapitres ». `www/data/ouverts.json` (page `chapitres.html`, qui n'est plus liée depuis les Réglages) ne sert plus qu'à une migration, une seule fois par appareil : un élève qui avait déjà commencé avec l'ancienne version reçoit une liste « Mes chapitres » égale aux chapitres que l'enseignant proposait (méthodes comprises si elles l'étaient), avec un bandeau qui explique le changement ; ses révisions continuent donc à l'identique. Un nouvel élève part d'une liste vide. Une ancienne sauvegarde restaurée est migrée de la même façon. Ne pas vider `ouverts.json` tant que des élèves peuvent encore ouvrir l'application pour la première fois depuis la mise à jour. La page enseignant (`prof.html`) s'en sert encore pour colorer les thèmes du suivi.

Test : `node tools/test_mes_chapitres.mjs <www de l'ancienne version> www` (migration sans perte, ancienne sauvegarde, premier lancement).

## Schémas à légender (pilote, novembre 2026)

Dans « Entraînement libre », le bouton **Schémas à légender** ouvre la liste des schémas de la discipline choisie (Bio ou Géol), d'abord ceux des chapitres de l'élève (« Mes chapitres »), avec un onglet « Tous les chapitres ». L'élève touche un numéro (sur le schéma ou dans la liste dessous) et choisit la légende parmi 6 propositions : la bonne, jusqu'à 2 étiquettes erronées du catalogue, et d'autres légendes du même schéma. Chaque légende a son propre calendrier (FSRS, séparé des définitions : les statistiques et l'objectif du jour des définitions ne changent pas). Seule la première réponse compte ; une légende ratée revient plus vite. La progression est dans la sauvegarde exportée.

En haut de la liste, l'élève choisit **Compléter les légendes** ou **Dessiner** (choix mémorisé). En mode Dessiner, il dessine le schéma de mémoire (stylo 8 couleurs, gomme, trait de légende, texte au clavier ; souris, stylet ou doigt), touche « Correction » : le schéma légendé s'affiche et il coche les légendes justes de son dessin. Seul le score est gardé (`store.schemaDraw`, 30 derniers essais par schéma), jamais le dessin. Ce score auto-évalué reste séparé du calendrier et des statistiques du mode Compléter. Les légendes que le titre à dessiner donne déjà (« Capillaire »…) ne sont pas à cocher. Le titre à dessiner vient des lignes « titre à dessiner » du catalogue (à défaut, la balise `<title>` du SVG). Le texte tapé passe à la ligne au bord du cadre ; avec l'outil Texte, toucher une légende écrite permet de la corriger (vidée, elle est supprimée).

Suivi enseignant : le bilan envoyé contient `schemas` (par schéma : réponses et justes en Compléter, légendes sues ; essais, dernier, meilleur et moyenne en Dessin). La page enseignant l'affiche (classe et élève par élève) et l'exporte ; rien à changer dans le script Google.

Ajouter ou modifier un schéma :
- `source/schemas/<CODE-CHAPITRE>_<nom>/<nom>-numeros.svg` : version numérotée ; chaque numéro est un `<g class="legende" data-n="…">`. À côté, `<nom>-legendes.svg` : version légendée, montrée en correction du mode Dessiner.
- `source/schemas/catalogue.xlsx`, onglet `catalogue` : chapitre, schema, type (`titre à dessiner`, `légende` ou `leurre`), numero (légendes seulement), terme, à garder (« non » = leurre écarté), source. Les leurres d'un schéma sont rangés sous ses légendes.
- `python tools/build_schemas.py source/schemas www/data/schemas.json` (fait automatiquement à la publication GitHub). Le script vérifie que les numéros du SVG et du catalogue correspondent, retire du SVG les réponses (`data-terme`, `<title>`) et remplace un titre qui donnerait une légende par un titre neutre (dictionnaire `TITRES` du script).
- Le calendrier d'une légende est rattaché au nom du schéma et au texte de la légende : renuméroter ne perd rien, mais renommer une légende la fait repartir de zéro.
- Tests : `node tools/schemas_test.mjs` et `node tools/dessin_test.mjs`.

## Recevoir les signalements (une seule fois)

Le bouton ⚠ n'apparaît que lorsque `www/config.json` contient une adresse. Chaque signalement devient une ligne d'un tableur Google qui t'appartient (onglet « Signalements », avec une case « Traité » à cocher) : tu le consultes quand tu veux, sur ordinateur ou dans l'application Google Sheets. Pas de mail, sauf si tu l'actives. Ton adresse n'est jamais visible dans l'application.

1. Créer un tableur Google vide (par exemple « Signalements flashcards »), puis menu « Extensions », « Apps Script ».
2. Remplacer le contenu par celui de `tools/signalement.gs`, puis enregistrer. Pour recevoir aussi un mail par signalement, mettre `ENVOYER_MAIL = true`.
3. « Déployer », « Nouveau déploiement », type « Application Web ». Exécuter en tant que : « Moi ». Qui a accès : « Tout le monde ». Autoriser l'accès demandé (écriture dans ce tableur, et envoi de mails si activé).
4. Copier l'adresse de l'application Web (elle finit par `/exec`) et la coller dans `www/config.json` sur GitHub : `{ "signalement": "https://script.google.com/macros/s/…/exec" }`.

Le script limite les envois à 60 par jour, pour le cas où quelqu'un utiliserait l'adresse pour remplir le tableur en masse. Pour arrêter les signalements, vide l'adresse dans `config.json` ou archive le déploiement.

## Suivi des élèves par l'enseignant (sous code, sans nom)

Un élève qui saisit un code de suivi (Ma progression) envoie automatiquement son bilan au même tableur, après ses séances et au plus toutes les 10 minutes. Le bilan ne contient jamais son nom : seulement le code, ses nombres de réponses et de jours de travail, ses définitions vues, acquises et à revoir par partie, et celles qu'il rate le plus. L'onglet « Suivi » garde une ligne par code (le dernier bilan). Quand un élève touche « Arrêter le suivi », sa ligne garde le dernier bilan, passe en orange et la colonne « Statut » indique la date de l'arrêt ; la page enseignant l'affiche aussi. Un nouvel envoi sous ce code efface la couleur. La page enseignant en tire, par élève et pour la classe : dernière utilisation, jours sans utilisation, nombre de cartes sues (dernière réponse autre que Raté) et ratées, au total et par thème, avec leur évolution semaine par semaine (thèmes vus en cours en couleur, les autres en gris), et les définitions les plus ratées. Des nombres de cartes plutôt que des pourcentages, pour que l'ajout de définitions ne fausse pas la lecture.

1. Page enseignant (`prof.html`), « Créer des codes de suivi » : télécharger le fichier de codes, compléter la colonne « Nom ». Ce fichier de correspondance reste sur ton ordinateur ; il ne doit jamais aller dans le tableur.
2. Dans le tableur, créer un onglet « Codes » et coller les codes (sans les noms) en colonne A : les autres codes sont refusés.
3. Dans le script, choisir une phrase secrète pour `CLE_ENSEIGNANT`, enregistrer, puis « Déployer », « Gérer les déploiements », modifier, « Nouvelle version » (l'adresse ne change pas).
4. Passer `"suivi": true` dans `www/config.json` : la carte « Suivi par ton professeur » apparaît alors chez les élèves.
5. Pour consulter : page enseignant, saisir la clé, « Charger les bilans du suivi », puis le fichier de correspondance. Les noms ne sont ajoutés que dans ce navigateur. Sans la clé : télécharger l'onglet « Suivi » en .csv et le déposer dans la page.

Des données sous code restent des données personnelles au sens du RGPD (données pseudonymisées) : informer les élèves et le référent RGPD de l'établissement.

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
node tools/revisions_test.mjs    # révisions limitées aux chapitres ouverts, mots-clés à cocher, page enseignant
node tools/inverse_test.mjs      # cartes définition → terme : saisie, correction, hors calendrier, mode mélangé
node tools/suivi_test.mjs /tmp   # suivi sous code : script du tableur, envois de l'élève, lecture et noms dans la page enseignant
```

- `www/` : l'application (HTML, CSS, JavaScript sans étape de compilation).
- `www/vendor/` : ts-fsrs 5.4.2 (FSRS-6) et SheetJS 0.18.5, copiés depuis npm.
- `www/data/chapters.json` : titres des parties et sous-parties du programme 2021.
- `tools/build_data.py` : convertit le tableur en `www/data/definitions.json`.
- `www/qcm.js` : masquage du terme dans sa définition et choix des leurres du QCM (testé par `node tools/qcm_test.mjs`).
- `tools/signalement.gs` : script Google qui range chaque signalement, suggestion et bilan de suivi dans un tableur (et envoie un mail par signalement si activé).
- `tools/build_artifact.py` : assemble la version d'aperçu publiée sur claude.ai.

Réglages de l'algorithme (dans `app.js`) : rétention cible 90 % (modifiable par l'élève : 85 ou 95 %), étape d'apprentissage et de réapprentissage 10 minutes, intervalle maximal 365 jours, légère variation aléatoire des dates. Une carte est comptée « acquise » au-delà de 21 jours de stabilité.

## Limites connues

- Pas de vraie notification push : une web app ne peut pas programmer seule une alerte « tu n'as pas fait tes cartes ». La prochaine étape prévue est d'emballer ce même code en application native (Capacitor) avec des notifications locales.
- Sur iPhone, une page non installée peut voir ses données effacées par Safari après plusieurs semaines sans visite. Il faut l'installer sur l'écran d'accueil.
