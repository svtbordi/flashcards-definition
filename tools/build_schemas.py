"""Schémas à légender : assemble www/data/schemas.json à partir de source/schemas/.

Usage : python tools/build_schemas.py source/schemas www/data/schemas.json

source/schemas/catalogue.xlsx, onglet « catalogue » :
  chapitre ; schema ; type (titre à dessiner / légende / leurre) ; numero ; terme ; a garder (oui/non) ; source
  une ligne « titre à dessiner » par schéma : le titre montré en mode « Dessiner » (sinon, la balise <title> du SVG).
  une ligne « légende » par numéro du schéma ; une ligne « leurre » par étiquette erronée (sans numéro).
  un leurre marqué « non » n'est pas proposé ; vide ou « oui » : proposé.
source/schemas/<chapitre>_<schema>/<…>-numeros.svg
  version numérotée du schéma : chaque numéro est un <g class="legende" data-n="…">.
source/schemas/<chapitre>_<schema>/<…>-legendes.svg
  version légendée, montrée pour la correction du mode « Dessiner ».

Le titre affiché vient de la balise <title> du SVG, sauf s'il contient une légende à trouver (« Artère musculaire »,
« Double circulation »…) : on prend alors le titre neutre de TITRES, pour ne pas donner la réponse.
Les attributs data-terme et la balise <title> sont retirés du SVG publié (sinon la réponse apparaîtrait au survol).
"""
import json, pathlib, re, sys, unicodedata

from openpyxl import load_workbook

TITRES = {
    'potentiel-action': 'Variation du potentiel de membrane d’un neurone',
    'double-circulation': 'Organisation de l’appareil circulatoire',
    'artere-musculaire': 'Paroi d’un vaisseau : coupe 1 (microscopie optique)',
    'arteriole-musculaire': 'Paroi d’un vaisseau : coupe 2 (microscopie électronique)',
    'capillaire': 'Paroi d’un vaisseau : coupe 3 (microscopie électronique)',
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s).strip().lower().replace('œ', 'oe').replace('’', "'"))
    return re.sub(r'\s+', ' ', ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn'))


src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
wb = load_workbook(src / 'catalogue.xlsx', read_only=True, data_only=True)
schemas, leurres, a_dessiner = {}, [], {}
for row in list(wb['catalogue'].iter_rows(values_only=True))[1:]:
    row = (tuple(row) + (None,) * 7)[:7]
    if not row[1] or row[4] is None or not str(row[4]).strip():
        continue
    chap, slug, kind, terme = str(row[0]).strip(), str(row[1]).strip(), norm(row[2] or ''), str(row[4]).strip()
    if kind.startswith('titre'):
        a_dessiner[slug] = terme
        continue
    if kind.startswith('leurre'):
        if norm(row[5] or '') != 'non':
            leurres.append((slug, terme))
        continue
    assert kind.startswith('legende'), f'{slug} « {terme} » : type « {row[2]} » (attendu : légende ou leurre)'
    s = schemas.setdefault(slug, {'id': slug, 'chapitre': chap, 'legendes': [], 'leurres': []})
    s['legendes'].append({'n': int(row[3]), 'terme': terme})
for slug, terme in leurres:
    assert slug in schemas, f'leurre « {terme} » : schéma « {slug} » sans légende'
    schemas[slug]['leurres'].append(terme)

result = []
for slug, s in schemas.items():
    files = list(src.glob(f'*_{slug}/*-numeros.svg'))
    assert len(files) == 1, f'{slug} : {len(files)} fichier(s) SVG numéroté(s)'
    svg = files[0].read_text(encoding='utf8')
    titre = re.search(r'<title>(.*?)</title>', svg, re.S)
    titre = titre.group(1).strip().replace("'", '’') if titre else slug
    dessin = a_dessiner.get(slug, titre)  # les légendes contenues dans ce titre ne sont pas à cocher
    corr = list(src.glob(f'*_{slug}/*-legendes.svg'))
    assert len(corr) == 1, f'{slug} : {len(corr)} fichier(s) SVG légendé(s)'
    corrige = re.sub(r'<title>.*?</title>', '', corr[0].read_text(encoding='utf8'), flags=re.S)
    corrige = re.sub(r'\sdata-terme="[^"]*"', '', corrige)
    corrige = re.sub(r'>\s+<', '><', corrige).strip()
    termes = {norm(l['terme']) for l in s['legendes']}
    if any(t in norm(titre) for t in termes):
        assert slug in TITRES, f'{slug} : le titre « {titre} » donne une réponse ; ajouter un titre neutre dans TITRES'
        titre = TITRES[slug]
    svg = re.sub(r'<title>.*?</title>', '', svg, flags=re.S)
    svg = re.sub(r'\sdata-terme="[^"]*"', '', svg)
    svg = re.sub(r'>\s+<', '><', svg)
    nums = sorted(int(x) for x in re.findall(r'class="legende" data-n="(\d+)"', svg))
    attendus = sorted(l['n'] for l in s['legendes'])
    assert nums == attendus, f'{slug} : numéros du SVG {nums} ≠ catalogue {attendus}'
    # un leurre ne doit jamais être la bonne réponse d'un autre numéro du même schéma
    s['leurres'] = [x for x in dict.fromkeys(s['leurres']) if norm(x) not in termes]
    s['legendes'].sort(key=lambda l: l['n'])
    result.append(dict(s, titre=titre, svg=svg.strip(), dessin=dessin, corrige=corrige))

result.sort(key=lambda s: (s['chapitre'], s['titre']))
out.write_text(json.dumps({'schemas': result}, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print('ok', out, len(result), 'schémas,', sum(len(s['legendes']) for s in result), 'légendes,',
      round(out.stat().st_size / 1e3), 'ko')
