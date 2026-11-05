"""Numerical evaluation must expose boundary errors and absent regions."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('metrics', Path(__file__).resolve().parents[1] / 'tools/compare_browser_alpha.py')
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)


class AlphaMetricsTest(unittest.TestCase):
    def test_boundary_error_and_anchor_violations(self):
        reference = np.array([[0, 128, 255]], dtype=np.uint8)
        candidate = np.array([[1, 255, 254]], dtype=np.uint8)
        result = metrics.measure(reference, candidate, reference)
        self.assertAlmostEqual(result['boundary']['mae'], 127 / 255)
        self.assertEqual(result['definite_foreground_violations'], 1)
        self.assertEqual(result['definite_background_violations'], 1)
        self.assertEqual(result['status'], 'measured_not_accepted')

    def test_empty_boundary_is_not_zero_error(self):
        image = np.array([[0, 255]], dtype=np.uint8)
        result = metrics.measure(image, image, image)
        self.assertIsNone(result['boundary']['mae'])
        self.assertEqual(result['boundary']['pixels'], 0)

    def test_rejects_implicit_conversion_and_wrong_trimap(self):
        image = np.array([[0, 255]], dtype=np.uint8)
        for candidate, trimap in [(image.astype(float), image), (image, image[:, :1]),
                                  (image, np.array([[0, 127]], dtype=np.uint8))]:
            with self.assertRaises(ValueError):
                metrics.measure(image, candidate, trimap)


if __name__ == '__main__':
    unittest.main()
