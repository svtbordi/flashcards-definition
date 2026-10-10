"""Construit www/data/definitions.json et chapters.json à partir du tableur et de l'index du programme."""
import json, re, sys, unicodedata, datetime, collections
import openpyxl

XLSX, OUT = sys.argv[1], sys.argv[2]
INDEX = sys.argv[3] if len(sys.argv) > 3 else None  # index du programme : seulement pour régénérer chapters.json

def norm(term):
    t = term.strip().lower().replace('œ', 'oe').replace('’', "'").replace('\xa0', ' ')
    t = unicodedata.normalize('NFD', t)
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', t)

wb = openpyxl.load_workbook(XLSX, read_only=True)
ws = wb['Toutes']
cards, seen, skipped = [], collections.Counter(), 0
for row in ws.iter_rows(values_only=True):
    term, codes, definition = (row + (None, None, None))[:3]
    if not term or not definition:
        continue
    cl = [c.strip() for c in re.split(r'[,;]', str(codes or '')) if c.strip()]
    if not cl:  # sans chapitre : la définition n'est pas proposée dans l'application
        skipped += 1
        continue
    cid = norm(str(term))
    seen[cid] += 1
    if seen[cid] > 1:
        cid = f'{cid}#{seen[cid]}'
    cards.append({'id': cid, 'term': str(term).strip(), 'def': str(definition).strip(), 'codes': cl})

chapters = []
part_re = re.compile(r'^\| ((?:SV|BG|ST)-[A-K]) \| (.+?) \| (.+?) \|')
sub_re = re.compile(r'^- ((?:SV|BG|ST)-[A-K](?:-\d+)+) [–-]? ?(.+)$')
for line in (open(INDEX, encoding='utf8') if INDEX else []):
    m = part_re.match(line)
    if m:
        title = re.sub(r'\s*\(\+ synth.*?\)|\s*\(dont .*?\)', '', m.group(2)).strip()
        chapters.append({'code': m.group(1), 'title': title, 'year': m.group(3).strip()})
        continue
    m = sub_re.match(line.strip())
    if m:
        chapters.append({'code': m.group(1), 'title': re.sub(r'\s*\(BCPST.*?\)$', '', m.group(2)).strip()})

stamp = datetime.date.today().isoformat()
json.dump({'version': stamp, 'source': 'definitions_SVT.xlsx', 'cards': cards},
          open(f'{OUT}/definitions.json', 'w', encoding='utf8'), ensure_ascii=False)
if chapters:
    json.dump(chapters, open(f'{OUT}/chapters.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print(len(cards), 'cartes,', skipped, 'sans chapitre ignorées,', sum(v > 1 for v in seen.values()), 'termes en double;', len(chapters), 'chapitres')
