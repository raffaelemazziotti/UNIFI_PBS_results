"""Export authorized student identifiers, scores and similarity coordinates.

CPU-only setup and export (all private files stay in ignored PBS/):
    python3 -m venv --system-site-packages PBS/.similarity-env
    PYTHONNOUSERSITE=1 PBS/.similarity-env/bin/python -m pip install -r scripts/requirements-similarity.txt
    PYTHONNOUSERSITE=1 PBS/.similarity-env/bin/python scripts/export_pbs.py --prepare-model
    PYTHONNOUSERSITE=1 PBS/.similarity-env/bin/python scripts/export_pbs.py
    PYTHONNOUSERSITE=1 PBS/.similarity-env/bin/python scripts/export_pbs.py --check

Model download is explicit; inference and cached re-exports work offline.
The workbook, answer text, model and embeddings remain in PBS/.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
import urllib.request

import numpy as np
from sklearn.manifold import MDS, TSNE, trustworthiness
from sklearn.feature_extraction.text import TfidfVectorizer

MODEL_ID = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
MODEL_REVISION = 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42'
MODEL_FILES = {
    'tokenizer.json': '2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8',
    'onnx/model_quint8_avx2.onnx': '98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f',
}

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'PBS' / 'PBS parziale modulo correzione 1 26_27.xlsx'
DESTINATION = ROOT / 'docs' / 'data.js'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
GRADE_COLS = ['I', 'L', 'O', 'R', 'U', 'X', 'AA', 'AD', 'AG', 'AJ', 'AM', 'AP']
ANSWER_COLS = ['H', 'K', 'N', 'Q', 'T', 'W', 'Z', 'AC', 'AF', 'AI', 'AL', 'AO']
MODEL_DIRECTORY = ROOT / 'PBS' / '.similarity-model'
CACHE_DIRECTORY = ROOT / 'PBS' / '.similarity-cache'
STOPWORDS = set('''a ad al alla alle allo agli ai all anche che chi ci cio come con da dal dalla
dei del della delle dello degli di e ed era essere fa fra gli ha hanno i il in la le lo ma nel
nella nelle nello negli nei non o per piu puo quale quando quanto questa queste questi questo
se si sia sono su sul sulla sulle sui tra un una uno viene vengono vero falsa falso true false
perche quindi infatti detto mentre poi dove cosi ogni loro essa esso essi esse dell dellla
risposta domanda caso ad esempio quello quella quelle quelli vera verdadero verdadera'''.split())


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


def prepare_model():
    """Explicit, download-only setup. No answers or identifiers leave this device."""
    for filename, expected in MODEL_FILES.items():
        destination = MODEL_DIRECTORY / filename
        if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + '.part')
        url = f'https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}/{filename}'
        digest = hashlib.sha256()
        try:
            with urllib.request.urlopen(url, timeout=120) as source, temporary.open('wb') as output:
                while block := source.read(1024 * 1024):
                    digest.update(block)
                    output.write(block)
            if digest.hexdigest() != expected:
                raise ValueError('Checksum del modello non valido: download interrotto.')
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    print('Modello locale pronto; nessun compito è stato inviato in rete.')


def unit_vectors(vectors):
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return np.divide(vectors, norms, out=np.zeros_like(vectors), where=norms > 0)


def semantic_embeddings(texts):
    """Local ONNX inference, with overlapping chunks so no answer is truncated.

    The pinned multilingual MiniLM uses 128 tokens and mean-token pooling.
    Cache and model stay inside the ignored PBS directory. Inference never
    creates a remote client, and missing files fail rather than call a service.
    """
    if not texts:
        return np.empty((0, 384), dtype=np.float32)
    key = hashlib.sha256(json.dumps([MODEL_REVISION, 'chunks-128-overlap-16-v1', texts],
                                   ensure_ascii=False).encode()).hexdigest()
    cached = CACHE_DIRECTORY / f'{key}.npz'
    if cached.exists():
        with np.load(cached, allow_pickle=False) as data:
            vectors = data['embeddings']
        if vectors.shape == (len(texts), 384) and np.isfinite(vectors).all():
            return vectors
    try:
        import onnxruntime as ort
        from tokenizers import Tokenizer
    except ImportError as error:
        raise RuntimeError('Installare scripts/requirements-similarity.txt nell’ambiente locale.') from error
    for filename, expected in MODEL_FILES.items():
        path = MODEL_DIRECTORY / filename
        if not path.exists():
            raise RuntimeError('Modello locale assente: eseguire scripts/export_pbs.py --prepare-model.')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Modello locale non integro: eseguire --prepare-model.')
    tokenizer = Tokenizer.from_file(str(MODEL_DIRECTORY / 'tokenizer.json'))
    tokenizer.enable_truncation(max_length=128, stride=16)
    tokenizer.enable_padding(pad_id=1, pad_token='<pad>')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(MODEL_DIRECTORY / 'onnx/model_quint8_avx2.onnx'),
                                   sess_options=options, providers=['CPUExecutionProvider'])
    encodings = tokenizer.encode_batch(texts)
    chunks = [(owner, encoding) for owner, full in enumerate(encodings)
              for encoding in [full, *full.overflowing]]
    sums = np.zeros((len(texts), 384), dtype=np.float64)
    weights = np.zeros(len(texts), dtype=np.float64)
    for start in range(0, len(chunks), 16):
        batch = chunks[start:start + 16]
        length = max(len(encoding.ids) for _, encoding in batch)
        ids = np.ones((len(batch), length), dtype=np.int64)
        mask = np.zeros_like(ids)
        types = np.zeros_like(ids)
        for i, (_, encoding) in enumerate(batch):
            ids[i, :len(encoding.ids)] = encoding.ids
            mask[i, :len(encoding.ids)] = encoding.attention_mask
            types[i, :len(encoding.ids)] = encoding.type_ids
        inputs = {'input_ids': ids, 'attention_mask': mask, 'token_type_ids': types}
        states = session.run(None, {field.name: inputs[field.name] for field in session.get_inputs()})[0]
        pooled = (states * mask[:, :, None]).sum(axis=1) / mask.sum(axis=1, keepdims=True)
        for (owner, _), vector, count in zip(batch, pooled, mask.sum(axis=1)):
            weight = max(int(count) - 2, 1)
            sums[owner] += vector * weight
            weights[owner] += weight
    vectors = unit_vectors(sums / weights[:, None]).astype(np.float32)
    CACHE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cached, embeddings=vectors)
    return vectors


def answer_distances(rows):
    """Equal-weight, question-aligned content distances, independent of grades.

    Multilingual semantic cosine (85%) captures paraphrases; character TF-IDF
    (15%) retains terminology and tolerates inflection and spelling variation.
    Bare true/false and absent answers do not count as shared content. Average
    only questions with substantive answers in both submissions, so missing
    answers are neither matches nor automatically content differences.
    """
    n = len(rows)
    answers = [[(' '.join(row.get(column, '').split()) if tokens(row.get(column, '')) else '')
                for column in ANSWER_COLS] for row in rows]
    texts = sorted({answer for row in answers for answer in row if answer})
    vectors = semantic_embeddings(texts)
    encoded = dict(zip(texts, vectors))
    total = np.zeros((n, n), dtype=np.float64)
    shared = np.zeros((n, n), dtype=np.float64)
    for question in range(len(ANSWER_COLS)):
        present = np.array([bool(row[question]) for row in answers])
        mask = present[:, None] & present[None, :]
        if not present.any():
            continue
        semantic = np.array([encoded[row[question]] if row[question] else np.zeros(384)
                             for row in answers], dtype=np.float64)
        semantic = unit_vectors(semantic)
        lexical = TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), sublinear_tf=True)
        words = [' '.join(tokens(row[question])) for row in answers]
        character_vectors = lexical.fit_transform(words)
        similarity = .85 * np.clip(semantic @ semantic.T, 0, 1)
        similarity += .15 * (character_vectors @ character_vectors.T).toarray()
        total += np.clip(1 - similarity, 0, 1) * mask
        shared += mask
    distances = np.divide(total, shared, out=np.ones_like(total), where=shared > 0)
    np.fill_diagonal(distances, 0)
    # Exact duplicates must remain exact, including in a later 2-D projection.
    for i in range(n):
        for j in range(i):
            if answers[i] == answers[j] and any(answers[i]):
                distances[i, j] = distances[j, i] = 0
    return distances


def project_distances(distances, seed=42):
    """Local-neighbourhood projection; no grades, names or manual placement.

    Use t-SNE on the content dissimilarities, with a fixed seed. Exact duplicate
    submissions share coordinates rather than being separated by repulsion.
    Tiny synthetic cohorts use metric MDS; t-SNE needs enough neighbours.
    Neither projection makes 2-D distances an exact similarity scale.
    """
    n = len(distances)
    if n < 2:
        return np.zeros((n, 2))
    representatives = []
    membership = []
    for i in range(n):
        group = next((j for j, representative in enumerate(representatives)
                      if distances[i, representative] < 1e-12
                      and np.allclose(distances[i], distances[representative], rtol=0, atol=1e-12)), None)
        if group is None:
            group = len(representatives)
            representatives.append(i)
        membership.append(group)
    # Advanced indexing makes a copy: exact t-SNE squares its input in place.
    unique = distances[np.ix_(representatives, representatives)]
    count = len(unique)
    if count == 1:
        coordinates = np.zeros((1, 2))
    elif count == 2:
        coordinates = np.array([[-unique[0, 1] / 2, 0], [unique[0, 1] / 2, 0]])
    elif count < 8:
        coordinates = MDS(n_components=2, metric=True, dissimilarity='precomputed',
                          n_init=8, max_iter=1500, eps=1e-7, random_state=seed,
                          n_jobs=1).fit_transform(unique)
    else:
        coordinates = TSNE(n_components=2, metric='precomputed', init='random',
                           perplexity=min(25, (count - 1) / 3), method='exact',
                           learning_rate='auto', max_iter=2000, random_state=seed,
                           n_jobs=1).fit_transform(unique)
    return np.asarray(coordinates, dtype=np.float64)[membership]


def similarity_projection(rows):
    """Export only identifiers and an isotropically scaled local content map."""
    rows = sorted(rows, key=lambda row: normalise_identifier(row['C']))
    if len(rows) < 2:
        return {'points': [{'matricola': normalise_identifier(row['C']), 'x': 0.0, 'y': 0.0}
                           for row in rows]}
    coordinates = project_distances(answer_distances(rows))
    span = max(float(np.ptp(coordinates[:, 0])), float(np.ptp(coordinates[:, 1])), 1e-12)
    coordinates = (coordinates - (coordinates.max(axis=0) + coordinates.min(axis=0)) / 2) / span
    points = [{'matricola': normalise_identifier(row['C']), 'x': round(float(x), 6), 'y': round(float(y), 6)}
              for row, (x, y) in zip(rows, coordinates)]
    return {'points': sorted(points, key=lambda point: point['matricola'])}


def projection_quality(distances, coordinates):
    """Audit the map against the same original distances, never its appearance."""
    from scipy.stats import spearmanr
    n = len(distances)
    if n < 3:
        return {'samples': n}
    projected = np.linalg.norm(coordinates[:, None, :] - coordinates[None, :, :], axis=2)
    original = distances.copy()
    mapped = projected.copy()
    np.fill_diagonal(original, np.inf)
    np.fill_diagonal(mapped, np.inf)
    result = {'samples': n}
    for k in (5, 10):
        if n <= k:
            continue
        expected = np.argsort(original, axis=1, kind='stable')[:, :k]
        observed = np.argsort(mapped, axis=1, kind='stable')[:, :k]
        result[f'neighbour_recall_at_{k}'] = round(float(np.mean([
            len(set(a) & set(b)) / k for a, b in zip(expected, observed)])), 6)
    k = min(5, (n - 1) // 2)
    result[f'trustworthiness_at_{k}'] = round(float(trustworthiness(
        distances, coordinates, n_neighbors=k, metric='precomputed')), 6)
    pairs = np.triu_indices(n, 1)
    if np.std(distances[pairs]) > 1e-12 and np.std(projected[pairs]) > 1e-12:
        result['distance_rank_correlation'] = round(float(spearmanr(
            distances[pairs], projected[pairs]).statistic), 6)
    return result


def audit_similarity(data, previous=None):
    """Private, aggregate-only evidence for the representation and its limits."""
    rows = sorted([row for row in read_rows(SOURCE)
                   if row.get('E', '').strip().casefold() != 'ritirato'],
                  key=lambda row: normalise_identifier(row['C']))
    distances = answer_distances(rows)
    def coordinates(points):
        lookup = {point['matricola']: (point['x'], point['y']) for point in points}
        return np.array([lookup[normalise_identifier(row['C'])] for row in rows])
    report = {
        'model': MODEL_ID,
        'model_revision': MODEL_REVISION,
        'runtime_versions': {name: importlib.metadata.version(name)
                             for name in ('numpy', 'scipy', 'scikit-learn')},
        'semantic_weight': .85,
        'character_tfidf_weight': .15,
        'question_weighting': 'Equal; only questions answered substantively by both students.',
        'projection': {'method': 't-SNE', 'perplexity': 25, 'seed': 42,
                       'iterations': 2000, 'initialisation': 'random', 'optimizer': 'exact'},
        'limits': 'Local exploratory map, not an exact pairwise distance scale; distances between distant groups are especially approximate.',
        'current': projection_quality(distances, coordinates(data['similarity']['points'])),
        'sensitivity_to_seed': {str(seed): projection_quality(distances, project_distances(distances, seed))
                                for seed in (7, 19)},
    }
    if previous is not None:
        report['grades_unchanged'] = data['students'] == previous['students']
        previous_ids = {point['matricola'] for point in previous['similarity']['points']}
        if previous_ids == {normalise_identifier(row['C']) for row in rows}:
            report['previous_layout_on_same_content_distances'] = projection_quality(
                distances, coordinates(previous['similarity']['points']))
    path = ROOT / 'PBS' / 'verifica_mappa_somiglianze.json'
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Verifica aggregata locale salvata in PBS/verifica_mappa_somiglianze.json.')


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
    parser.add_argument('--prepare-model', action='store_true', help='Scarica e verifica il modello pubblico; non legge i compiti.')
    parser.add_argument('--audit', action='store_true', help='Salva in PBS una verifica aggregata della qualità della mappa.')
    args = parser.parse_args()
    if args.prepare_model:
        prepare_model()
        return
    data = make_data()
    content = serialise(data)
    if args.audit:
        previous = (json.loads(DESTINATION.read_text().split('window.PBS_DATA = ', 1)[1].rstrip(';\n'))
                    if DESTINATION.exists() else None)
        audit_similarity(data, previous)
    if args.check:
        if not DESTINATION.exists() or DESTINATION.read_text() != content:
            raise SystemExit('I dati della pagina non sono aggiornati. Eseguire prima scripts/export_pbs.py.')
        print('Dati pubblici allineati al workbook; nessun dato identificativo oltre alle matricole.')
    else:
        DESTINATION.write_text(content, encoding='utf-8')
        print(f'Esportati {len(data["students"])} record e {len(data["similarity"]["points"])} punti collegati alle matricole in docs/data.js.')


if __name__ == '__main__':
    main()
