"""Assemble une version d'aperçu (page Claude) : CSS et JS en ligne, données à côté."""
import pathlib, re, shutil
www = pathlib.Path('www'); out = pathlib.Path('dist-artifact')
shutil.rmtree(out, ignore_errors=True); (out / 'data').mkdir(parents=True); (out / 'vendor').mkdir()
html = (www / 'index.html').read_text()
body = html[html.index('<body>') + 6: html.index('</body>')]
body = re.sub(r'<script src="[^"]+"></script>\n?', '', body)
page = ('<title>Flashcards BCPST</title>\n<style>\n' + (www / 'styles.css').read_text() + '</style>\n' + body +
        '<script>\n' + (www / 'vendor/ts-fsrs.umd.js').read_text() + '\n</script>\n<script>\n' + (www / 'qcm.js').read_text() + '\n</script>\n<script>\n' + (www / 'app.js').read_text().replace("'vendor/xlsx.full.min.js'", "'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'") + '\n</script>\n')
(out / 'index.html').write_text(page)
for f in ['data/definitions.json', 'data/chapters.json']:
    shutil.copy(www / f, out / f)
print('ok', len(page))
