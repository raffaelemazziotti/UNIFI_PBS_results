"""Tests use synthetic identifiers and text, never students' submissions."""
import importlib.util
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('export_pbs', ROOT/'scripts'/'export_pbs.py')
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


def fake_row(number, text='cellule guida migrazione sviluppo corteccia'):
    row = {'A': 'COGNOME_PRIVATO', 'B': 'NOME_PRIVATO', 'C': f'{number:07}.0', 'D': 'privato@example.invalid', 'E': ''}
    row.update({column: '1' if i < 4 else '0.5' for i, column in enumerate(export.GRADE_COLS)})
    row.update({column: text for column in export.ANSWER_COLS})
    return row


def fake_embeddings(texts):
    """Deterministic token vectors: unit tests need no downloaded model."""
    vectors = np.zeros((len(texts), 384), dtype=np.float32)
    for i, text in enumerate(texts):
        for word in export.tokens(text):
            index = int.from_bytes(hashlib.sha256(word.encode()).digest()[:4], 'big') % 384
            vectors[i, index] += 1
    return export.unit_vectors(vectors)


class ExportTests(unittest.TestCase):
    def setUp(self):
        encoder = patch.object(export, 'semantic_embeddings', side_effect=fake_embeddings)
        encoder.start()
        self.addCleanup(encoder.stop)

    def test_matricole_normalizzate_senza_perdere_zeri(self):
        self.assertEqual(export.normalise_identifier(' 0001234.0 '), '0001234')
        self.assertEqual(export.normalise_identifier(' ab0123 '), 'AB0123')
        self.assertEqual(export.normalise_identifier('123.45'), '123.45')

    def test_dati_pubblici_allowlist_e_ritiro(self):
        rows = [fake_row(1), fake_row(2)]
        rows[1]['E'] = 'Ritirato'
        with patch.object(export, 'read_rows', return_value=rows):
            data = export.make_data()
        self.assertEqual(set(data), {'students', 'similarity'})
        self.assertEqual(set(data['students'][0]), {'matricola', 'voti'})
        self.assertEqual(set(data['students'][1]), {'matricola', 'ritirato'})
        self.assertEqual(sum(data['students'][0]['voti']), 8)
        self.assertEqual(len(data['similarity']['points']), 1)
        for forbidden in ('COGNOME_PRIVATO', 'NOME_PRIVATO', '@example.invalid', 'migrazione', 'commento'):
            self.assertNotIn(forbidden, json.dumps(data))

    def test_voti_fuori_limite_rifiutati(self):
        row = fake_row(1)
        row[export.GRADE_COLS[4]] = '1.5'
        with patch.object(export, 'read_rows', return_value=[row]):
            with self.assertRaises(ValueError):
                export.make_data()

    def test_matricole_duplicate_rifiutate(self):
        with patch.object(export, 'read_rows', return_value=[fake_row(1), fake_row(1)]):
            with self.assertRaises(ValueError):
                export.make_data()

    def test_proiezione_deterministica_collegata_alle_matricole(self):
        rows = [fake_row(1), fake_row(2, 'ormoni circuiti inibitori apprendimento'), fake_row(3, 'memoria riconoscimento voce prenatale'), fake_row(4, 'glia guida migrazione neuroni')]
        first = export.similarity_projection(rows)
        self.assertEqual(first, export.similarity_projection(rows))
        self.assertEqual(set(first), {'points'})
        self.assertEqual(len(first['points']), 4)
        self.assertEqual([p['matricola'] for p in first['points']], [f'{i:07}' for i in range(1, 5)])
        coordinates = [[p['x'], p['y']] for p in first['points']]
        self.assertTrue(np.isfinite(coordinates).all())
        self.assertTrue((np.abs(coordinates) <= .500001).all())
        for point in first['points']:
            self.assertEqual(set(point), {'matricola', 'x', 'y'})

    def test_compiti_identici_sono_piu_vicini(self):
        rows = [fake_row(1), fake_row(2), fake_row(3, 'ormoni recettori memoria apprendimento')]
        points = export.similarity_projection(rows)['points']
        coordinates = np.array([[p['x'], p['y']] for p in points])
        same = np.linalg.norm(coordinates[0] - coordinates[1])
        different = np.linalg.norm(coordinates[0] - coordinates[2])
        self.assertLess(same, .001)
        self.assertGreater(different, .9)

    def test_gruppo_di_compiti_identici(self):
        points = export.similarity_projection([fake_row(1), fake_row(2), fake_row(3)])['points']
        self.assertTrue(all(point['x'] == point['y'] == 0 for point in points))

    def test_ordine_delle_righe_non_cambia_la_mappa(self):
        rows = [fake_row(i, f'neuroni migrazione corteccia termine{i}') for i in range(1, 10)]
        self.assertEqual(export.similarity_projection(rows), export.similarity_projection(rows[::-1]))

    def test_voti_e_nomi_non_influenzano_le_distanze(self):
        rows = [fake_row(1), fake_row(2, 'memoria riconoscimento voce prenatale')]
        before = export.answer_distances(rows)
        for row in rows:
            row.update({'A': 'ALTRO_COGNOME', 'B': 'ALTRO_NOME'})
            row.update({column: '0' for column in export.GRADE_COLS})
        np.testing.assert_array_equal(before, export.answer_distances(rows))

    def test_risposte_confrontate_solo_alla_stessa_domanda(self):
        rows = [fake_row(1), fake_row(2)]
        first, second = export.ANSWER_COLS[:2]
        rows[0][first], rows[0][second] = 'neuroni glia corteccia', 'ormoni recettori surrene'
        rows[1][first], rows[1][second] = rows[0][second], rows[0][first]
        self.assertGreater(export.answer_distances(rows)[0, 1], .05)

    def test_assenze_e_vero_falso_isolati_non_sono_somiglianze(self):
        rows = [fake_row(1, ''), fake_row(2, 'Vero.'), fake_row(3, 'Falso')]
        expected = np.ones((3, 3)) - np.eye(3)
        np.testing.assert_array_equal(export.answer_distances(rows), expected)

    def test_domande_assenti_escluse_dal_confronto(self):
        rows = [fake_row(1), fake_row(2)]
        rows[0][export.ANSWER_COLS[0]] = ''
        self.assertLess(export.answer_distances(rows)[0, 1], 1e-6)

    def test_duplicati_non_separati_dalla_proiezione_locale(self):
        rows = [fake_row(1), fake_row(2)] + [fake_row(i, f'argomento termine{i} parola{i} concetto{i}') for i in range(3, 12)]
        points = export.similarity_projection(rows)['points']
        self.assertEqual((points[0]['x'], points[0]['y']), (points[1]['x'], points[1]['y']))

    def test_proiezione_campione_vuoto_o_singolo(self):
        self.assertEqual(export.similarity_projection([]), {'points': []})
        point = export.similarity_projection([fake_row(1)])['points'][0]
        self.assertEqual((point['x'], point['y']), (0, 0))

    def test_proiezione_non_modifica_le_distanze_originali(self):
        random = np.random.RandomState(42)
        features = random.normal(size=(12, 8))
        distances = np.linalg.norm(features[:, None, :] - features[None, :, :], axis=2)
        before = distances.copy()
        export.project_distances(distances)
        np.testing.assert_array_equal(distances, before)

    def test_proiezione_locale_conserva_gruppi_sintetici_netti(self):
        random = np.random.RandomState(19)
        groups = np.repeat(np.arange(3), 4)
        features = np.eye(3)[groups] * 10 + random.normal(scale=.05, size=(12, 3))
        distances = np.linalg.norm(features[:, None, :] - features[None, :, :], axis=2)
        coordinates = export.project_distances(distances)
        mapped = np.linalg.norm(coordinates[:, None, :] - coordinates[None, :, :], axis=2)
        np.fill_diagonal(mapped, np.inf)
        neighbours = np.argsort(mapped, axis=1)[:, :3]
        self.assertTrue(all(np.all(groups[near] == groups[i]) for i, near in enumerate(neighbours)))

    def test_metriche_di_verifica_su_mappa_esatta(self):
        coordinates = np.random.RandomState(7).normal(size=(16, 2))
        distances = np.linalg.norm(coordinates[:, None, :] - coordinates[None, :, :], axis=2)
        quality = export.projection_quality(distances, coordinates)
        self.assertEqual(quality['neighbour_recall_at_5'], 1)
        self.assertEqual(quality['neighbour_recall_at_10'], 1)
        self.assertEqual(quality['trustworthiness_at_5'], 1)
        self.assertEqual(quality['distance_rank_correlation'], 1)


if __name__ == '__main__':
    unittest.main()
