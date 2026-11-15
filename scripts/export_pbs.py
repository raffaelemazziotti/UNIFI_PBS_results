"""Export authorized student identifiers, scores and similarity coordinates.

Run with: PYTHONNOUSERSITE=1 python3 scripts/export_pbs.py
The workbook and all answer text remain in the ignored PBS directory.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

import numpy as np
from sklearn.manifold import MDS

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'PBS' / 'PBS parziale modulo correzione 1 26_27.xlsx'
DESTINATION = ROOT / 'docs' / 'data.js'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
GRADE_COLS = ['I', 'L', 'O', 'R', 'U', 'X', 'AA', 'AD', 'AG', 'AJ', 'AM', 'AP']
ANSWER_COLS = ['H', 'K', 'N', 'Q', 'T', 'W', 'Z', 'AC', 'AF', 'AI', 'AL', 'AO']
STOPWORDS = set('''a ad al alla alle allo agli ai all anche che chi ci cio come con da dal dalla
dei del della delle dello degli di e ed era essere fa fra gli ha hanno i il in la le lo ma nel
nella nelle nello negli nei non o per piu puo quale quando quanto questa queste questi questo
se si sia sono su sul sulla sulle sui tra un una uno viene vengono vero falsa falso true false
perche quindi infatti detto mentre poi dove cosi ogni loro essa esso essi esse dell dellla
risposta domanda caso ad esempio quello quella quelle quelli'''.split())


def read_rows(path):
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in si.findall('.//m:t', NS))
                       for si in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        root = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    result = []
    for row in root.findall('m:sheetData/m:row', NS):
        if int(row.get('r')) < 2:
            continue
        values = {}
        for cell in row.findall('m:c', NS):
            value = cell.find('m:v', NS)
            text = value.text or '' if value is not None else ''
            if cell.get('t') == 's' and text:
                text = strings[int(text)]
            elif cell.get('t') == 'inlineStr':
                text = ''.join(t.text or '' for t in cell.findall('m:is//m:t', NS))
            values[re.sub(r'\d', '', cell.get('r'))] = text
        if values.get('C'):
            result.append(values)
    return result


def tokens(text):
    normalised = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
    return [word for word in re.findall(r'[a-z][a-z0-9]*', normalised)
            if len(word) > 1 and word not in STOPWORDS]


def normalise_identifier(value):
    identifier = re.sub(r'\s+', '', value).upper()
    # The source export stores integer matricole as strings like "1234567.0".
    # Remove the export artefact without converting to float or losing zeros.
    return re.sub(r'\.0+$', '', identifier) if re.fullmatch(r'\d+\.0+', identifier) else identifier


def similarity_projection(rows):
    """Question-aligned TF-IDF; metric MDS fits all pairwise cosine distances.

    Export coordinates linked to matricole, never answer text or vocabulary.
    Metric MDS approximates the original pairwise dissimilarities globally.
    """
    n = len(rows)
    if n < 2:
        return {'points': [{'matricola': normalise_identifier(row['C']), 'x': 0.0, 'y': 0.0} for row in rows]}
    kernel = np.zeros((n, n), dtype=float)
    for column in ANSWER_COLS:
        documents = []
        for row in rows:
            words = tokens(row.get(column, ''))
            features = words + [' '.join(pair) for pair in zip(words, words[1:])]
            documents.append(Counter(features))
        frequency = Counter(term for document in documents for term in document)
        vocabulary = {term: i for i, term in enumerate(sorted(frequency))}
        vectors = np.zeros((n, len(vocabulary)), dtype=float)
        for i, document in enumerate(documents):
            for term, count in document.items():
                vectors[i, vocabulary[term]] = (1 + math.log(count)) * (1 + math.log((n + 1) / (frequency[term] + 1)))
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors /= np.where(norms > 0, norms, 1)
        kernel += vectors @ vectors.T / len(ANSWER_COLS)
    lengths = np.sqrt(np.diag(kernel))
    normaliser = lengths[:, None] * lengths[None, :]
    kernel = np.divide(kernel, normaliser, out=np.zeros_like(kernel), where=normaliser > 0)
    distances = np.clip(1 - kernel, 0, 1)
    np.fill_diagonal(distances, 0)
    if np.max(distances) < 1e-12:
        coordinates = np.zeros((n, 2))
    else:
        coordinates = MDS(n_components=2, metric=True, dissimilarity='precomputed',
                          n_init=8, max_iter=1500, eps=1e-7, random_state=42,
                          n_jobs=1).fit_transform(distances)
    span = max(float(np.ptp(coordinates[:, 0])), float(np.ptp(coordinates[:, 1])), 1e-12)
    coordinates = (coordinates - (coordinates.max(axis=0) + coordinates.min(axis=0)) / 2) / span
    points = [{'matricola': normalise_identifier(row['C']), 'x': round(float(x), 6), 'y': round(float(y), 6)}
              for row, (x, y) in zip(rows, coordinates)]
    return {'points': sorted(points, key=lambda point: point['matricola'])}


def make_data(path=SOURCE):
    rows = read_rows(path)
    students = []
    active = []
    seen = set()
    for row in rows:
        identifier = normalise_identifier(row['C'])
        if not re.fullmatch(r'[A-Z0-9]{1,32}', identifier) or identifier in seen:
            raise ValueError('Matricola vuota, non valida o duplicata: verificare il file sorgente.')
        seen.add(identifier)
        if row.get('E', '').strip().casefold() == 'ritirato':
            students.append({'matricola': identifier, 'ritirato': True})
            continue
        scores = [float(row[column]) for column in GRADE_COLS]
        for i, score in enumerate(scores):
            if not math.isfinite(score) or not 0 <= score <= (2 if i < 4 else 1):
                raise ValueError('Voto mancante o fuori scala nel file sorgente.')
        students.append({'matricola': identifier, 'voti': scores})
        active.append(row)
    return {'students': sorted(students, key=lambda student: student['matricola']),
            'similarity': similarity_projection(active)}


def serialise(data):
    return '// Dati pubblici autorizzati: matricole e punteggi; nessun nome, risposta o commento.\nwindow.PBS_DATA = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verifica che i dati pubblici coincidano con il file XLSX corrente.')
    args = parser.parse_args()
    data = make_data()
    content = serialise(data)
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text() != content:
            raise SystemExit('I dati della pagina non sono aggiornati. Eseguire prima scripts/export_pbs.py.')
        print('Dati pubblici allineati al workbook; nessun dato identificativo oltre alle matricole.')
    else:
        DESTINATION.write_text(content, encoding='utf-8')
        print(f'Esportati {len(data["students"])} record e {len(data["similarity"]["points"])} punti collegati alle matricole in docs/data.js.')


if __name__ == '__main__':
    main()
