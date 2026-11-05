"""Small metadata-only tests; no models, tensors or inference."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('poc_serve', Path(__file__).resolve().parents[1] / 'tools/browser-webgpu-poc/serve.py')
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)


class Contracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.folder = self.root / 'birefnet-native-reference-01'
        self.folder.mkdir()
        self.case = dict(id='reference-01', file='input.f16', dtype='float16',
                         shape=[1,3,2048,2048], bytes=25165824,
                         sha256='bf6ff495d0c1f2dab6d7fd6d17f6eb397b6475b72f8a177a65c762fb5f5a92ee')

    def contract(self):
        (self.folder / 'inputs.json').write_text(json.dumps({'cases':[self.case]}))
        return serve.model_contract(self.root, 'birefnet-output-tiles-01')

    def test_full_hr_contract(self):
        model, files, _, config = self.contract()
        self.assertEqual(model.name, 'onnx-birefnet-grid-03')
        self.assertEqual(set(files), {'model-output-tiles-01.onnx','model.onnx.data'})
        self.assertEqual((config['precision'],config['inputName'],config['outputName']), ('float16','pixels','alpha'))

    def test_reject_input_contract_changes(self):
        original = dict(self.case)
        for key, value in [('dtype','float32'),('shape',[1,3,1024,1024]),('bytes',12),('sha256','0'*64)]:
            self.case = {**original, key:value}
            with self.subTest(key=key), self.assertRaises(ValueError): self.contract()

    def test_reject_model_traversal(self):
        with self.assertRaises(ValueError):
            serve.model_contract(self.root, 'birefnet-output-tiles-01', '../outside')

    def test_full_hr_set_is_complete_and_hash_pinned(self):
        folder = self.root / 'birefnet-inputs-01'; folder.mkdir()
        cases = [{**self.case, 'id':name, 'file':name+'.f16', 'sha256':sha}
                 for name,sha in serve.HR_INPUT_SHA256.items()]
        manifest = folder / 'inputs.json'
        manifest.write_text(json.dumps({'cases':cases}))
        _,_,_,config = serve.model_contract(self.root,'birefnet-output-tiles-01',hr_input_set='full-reference')
        self.assertEqual(len(config['cases']),5)
        for invalid in [cases[:-1], [{**c,'sha256':'0'*64} if i==1 else c for i,c in enumerate(cases)]]:
            manifest.write_text(json.dumps({'cases':invalid}))
            with self.assertRaises(ValueError):
                serve.model_contract(self.root,'birefnet-output-tiles-01',hr_input_set='full-reference')

    def test_vitmatte_preserved(self):
        model = self.root / 'onnx-vitmatte-03'; model.mkdir()
        (model/'report.json').write_text(json.dumps(dict(status='exported_synthetic_parity_measured_not_accepted',model='hustvl/vitmatte-base-distinctions-646',files={})))
        inputs = self.root / 'vitmatte-inputs-01'; inputs.mkdir()
        (inputs/'inputs.json').write_text(json.dumps({'cases':[dict(id='test',file='test.f32',dtype='float32',shape=[1,4,32,64],bytes=32768)]}))
        _,_,_,config=serve.model_contract(self.root,'vitmatte','onnx-vitmatte-03')
        self.assertEqual((config['precision'],config['inputName'],config['outputName']),('float32','pixel_values','alphas'))

    def test_checkpoint_requires_original_dtype_and_source_receipt(self):
        self.contract()
        model=self.root/'onnx-birefnet-grid-03';model.mkdir()
        receipt=dict(status='diagnostic_graph_checked_not_executed',observer_nodes=0,
                     source_graph_sha256='3fbcfed0079e8a3b95bcba7c6bd2a8776a73c1e6681ab0aec51198bd24349006',
                     input_names=['pixels'],graph={'name':'probe.onnx','bytes':12,'sha256':'a'*64},
                     output_name='intermediate',output_shape=[1,2],output_dtype='float16')
        path=model/'probe.report.json';path.write_text(json.dumps(receipt))
        _,files,_,config=serve.model_contract(self.root,'birefnet-output-tiles-01',checkpoint='probe.onnx')
        self.assertEqual(config['outputName'],'intermediate')
        self.assertEqual(config['diagnosticCheckpoint']['output_dtype'],'float16')
        self.assertIn('probe.onnx',files)
        for key,value in [('observer_nodes',1),('source_graph_sha256','0'*64),('status','rejected_before_execution')]:
            path.write_text(json.dumps({**receipt,key:value}))
            with self.assertRaises(ValueError):
                serve.model_contract(self.root,'birefnet-output-tiles-01',checkpoint='probe.onnx')

    def test_fp32_mean_variant_keeps_original_input_contract(self):
        self.contract()
        _,files,_,config=serve.model_contract(self.root,'birefnet-fp32-means-01')
        self.assertIn('model-fp32-means-01.onnx',files)
        self.assertNotIn('model-output-tiles-01.onnx',files)
        self.assertEqual(config['precision'],'float16')
        self.assertEqual(config['outputName'],'alpha')
        self.assertTrue(config['modelId'].endswith('-fp32-means-01'))


if __name__ == '__main__': unittest.main()
