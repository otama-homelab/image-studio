"""Bounded fixtures for raw-input integrity; no Torch, ORT or model execution."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))


class PreparedInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
        except ImportError:
            raise unittest.SkipTest('NumPy required')
        cls.np=np

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.data=self.root/'input.f16'
        with self.data.open('wb') as f:f.truncate(3*2048*2048*2)
        self.case={'id':'fixture','file':'input.f16','shape':[1,3,2048,2048],'dtype':'float16',
                   'bytes':3*2048*2048*2,'original_size':[100,200]}
        self.update_sha()

    def tearDown(self):self.temp.cleanup()

    def update_sha(self):
        with self.data.open('rb') as f:self.case['sha256']=hashlib.file_digest(f,'sha256').hexdigest()
        self.write(self.case)

    def write(self,case):
        (self.root/'inputs.json').write_text(json.dumps({'cases':[case]}))

    def test_verified_full_shape_is_returned_without_preprocessing(self):
        from browser_prepared_hr_input import load_prepared
        x,size,digest=load_prepared(self.root,reference_id='fixture')
        self.assertEqual(x.shape,(1,3,2048,2048));self.assertEqual(size,[100,200])
        self.assertEqual(digest,self.case['sha256']);self.assertEqual(float(x.max()),0)

    def test_id_traversal_shape_and_dimensions_are_rejected(self):
        from browser_prepared_hr_input import load_prepared
        for patch in [{'id':'other'},{'file':'../input.f16'},{'shape':[1,3,512,512]},{'original_size':[0,200]}]:
            case=copy.deepcopy(self.case);case.update(patch);self.write(case)
            with self.subTest(patch=patch),self.assertRaises(ValueError):load_prepared(self.root,reference_id='fixture')

    def test_data_corruption_is_rejected_even_with_same_length(self):
        from browser_prepared_hr_input import load_prepared
        with self.data.open('r+b') as f:f.write(b'\x01\x00')
        with self.assertRaises(ValueError):load_prepared(self.root,reference_id='fixture')

    def test_nonfinite_data_is_rejected_after_valid_sha(self):
        from browser_prepared_hr_input import load_prepared
        with self.data.open('r+b') as f:f.write(self.np.float16(self.np.nan).tobytes())
        self.update_sha()
        with self.assertRaises(ValueError):load_prepared(self.root,reference_id='fixture')


if __name__=='__main__':unittest.main()
