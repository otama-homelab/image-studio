from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
try:
    import numpy as np
    from compare_browser_alpha import localize
except ImportError:
    np=None

@unittest.skipIf(np is None,'Requires evaluation NumPy/Pillow environment')
class Localization(unittest.TestCase):
    def test_signed_errors_and_histogram(self):
        a=np.array([[0,255],[128,128]],dtype=np.uint8)
        b=np.array([[255,0],[127,129]],dtype=np.uint8)
        t=np.array([[0,255],[128,128]],dtype=np.uint8)
        r=localize(a,b,t,tile_size=1)
        self.assertEqual(r['regions']['all']['absolute_error_histogram_0_to_255'][255],2)
        self.assertEqual(r['regions']['trimap_unknown']['absolute_error_histogram_0_to_255'][1],2)
        self.assertEqual(r['regions']['all']['signed_bias_code_units'],0)
        self.assertEqual(sum(r['regions']['all']['absolute_error_histogram_0_to_255']),4)

    def test_partial_tile_and_empty_region(self):
        a=np.zeros((3,5),dtype=np.uint8);b=a.copy();b[2,4]=12
        r=localize(a,b,a,tile_size=2)
        self.assertEqual(r['worst_tiles_by_total_error'][0]['box_xyxy'],[4,2,5,3])
        self.assertEqual(r['worst_tiles_by_total_error'][0]['pixels'],1)
        self.assertIsNone(r['regions']['trimap_unknown']['signed_bias_code_units'])
        self.assertEqual(localize(a,a,a)['worst_tiles_by_total_error'],[])

    def test_invalid_inputs(self):
        a=np.zeros((2,2),dtype=np.uint8)
        for size in [0,-1,True,1.5]:
            with self.assertRaises(ValueError):localize(a,a,a,tile_size=size)
        with self.assertRaises(ValueError):localize(a,a.astype(float),a)

if __name__=='__main__':unittest.main()
