"""Tests use synthetic identifiers and text, never students' submissions."""
import importlib.util
import json
from pathlib import Path
import tempfile
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


class ExportTests(unittest.TestCase):
    def test_matricole_normalizzate_senza_perdere_zeri(self):
        self.assertEqual(export.normalise_identifier(' 0001234.0 '), '0001234')
        self.assertEqual(export.normalise_identifier(' ab0123 '), 'AB0123')
        self.assertEqual(export.normalise_identifier('123.45'), '123.45')

    def test_dati_pubblici_allowlist_e_ritiro(self):
        rows = [fake_row(1), fake_row(2)]
        rows[1]['E'] = 'Ritirato'
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'source.xlsx'
            path.touch()
            with patch.object(export, 'read_rows', return_value=rows):
                data = export.make_data(path)
        self.assertEqual(set(data), {'updatedAt', 'students', 'similarity'})
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


if __name__ == '__main__':
    unittest.main()
