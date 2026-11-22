"""Optional, offline integration checks using synthetic sentences only.

Run in the local similarity environment after --prepare-model. These checks
skip when the CPU runtime or the public model is not available.
"""
import importlib.util
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np

spec = importlib.util.spec_from_file_location('pbs_semantic_export', Path(__file__).resolve().parents[1] / 'scripts/export_pbs.py')
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)
AVAILABLE = (importlib.util.find_spec('onnxruntime') is not None
             and importlib.util.find_spec('tokenizers') is not None
             and all((export.MODEL_DIRECTORY / name).exists() for name in export.MODEL_FILES))


@unittest.skipUnless(AVAILABLE, 'Modello o runtime CPU locale non disponibile.')
class LocalSemanticTests(unittest.TestCase):
    def test_parafrasi_lingue_refusi_e_inferenza_senza_rete(self):
        texts = [
            'La glia radiale guida i neuroni durante la migrazione verso la corteccia.',
            'Le cellule gliali radiali forniscono un supporto lungo cui i neuroni si spostano nella corteccia.',
            'I recettori dei glucocorticoidi nell’ippocampo partecipano al feedback negativo dell’asse HPA.',
            'La glía radial sirve de guía para la migración neuronal hacia la corteza.',
            'La glia radale guida i neuroni nela migrazione corticale.',
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(export, 'CACHE_DIRECTORY', Path(directory)), \
                patch.object(export.urllib.request, 'urlopen', side_effect=AssertionError('Rete vietata durante l’inferenza')):
            vectors = export.semantic_embeddings(texts)
            cached = export.semantic_embeddings(texts)
        self.assertEqual(vectors.shape, (5, 384))
        np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-6)
        np.testing.assert_array_equal(vectors, cached)
        unrelated = float(vectors[0] @ vectors[2])
        for i in (1, 3, 4):
            self.assertGreater(float(vectors[0] @ vectors[i]), unrelated + .15)

    def test_coda_di_una_risposta_lunga_non_viene_troncata(self):
        prefix = 'La glia radiale guida i neuroni verso la corteccia. ' * 16
        first = prefix + 'La memoria dipende dalla plasticità delle sinapsi e dall’apprendimento. ' * 16
        second = prefix + 'Il cortisolo e i glucocorticoidi regolano il feedback negativo dell’asse HPA. ' * 16
        with tempfile.TemporaryDirectory() as directory, patch.object(export, 'CACHE_DIRECTORY', Path(directory)), \
                patch.object(export.urllib.request, 'urlopen', side_effect=AssertionError('Rete vietata durante l’inferenza')):
            vectors = export.semantic_embeddings([first, second])
        self.assertTrue(np.isfinite(vectors).all())
        self.assertLess(float(vectors[0] @ vectors[1]), .99)


if __name__ == '__main__':
    unittest.main()
