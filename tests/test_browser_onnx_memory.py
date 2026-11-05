"""Analytical fixtures for the static-size report, never model inference."""
from pathlib import Path
import sys
import unittest
import tempfile
import subprocess
import hashlib
import json

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))


class StaticMemoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import onnx
        except ImportError:
            raise unittest.SkipTest('Use the pinned ONNX environment')
        cls.onnx=onnx

    def model(self, shape):
        h,T=self.onnx.helper,self.onnx.TensorProto
        return h.make_model(h.make_graph([
            h.make_node('Add',['x','w'],['a'],name='add'),
            h.make_node('Relu',['a'],['y'],name='relu')], 'fixture',
            [h.make_tensor_value_info('x',T.FLOAT,shape)],
            [h.make_tensor_value_info('y',T.FLOAT,shape)],
            [h.make_tensor('w',T.FLOAT,[3],[1,2,3])],
            value_info=[h.make_tensor_value_info('a',T.FLOAT,shape)]))

    def test_exact_sizes_and_literal_liveness(self):
        from inspect_browser_onnx_memory import analyze
        r=analyze(self.model([3]),buffer_limit=12,binding_limit=12)
        self.assertEqual(r['unknown_value_count'],0)
        self.assertEqual(r['max_known_tensor_bytes'],12)
        self.assertEqual(r['idealized_literal_order_liveness']['known_activation_bytes'],24)
        self.assertEqual(r['idealized_literal_order_liveness']['known_activation_plus_initializers'],36)
        self.assertTrue(r['all_known_logical_tensors_within_limits'])

    def test_unknown_sizes_remain_explicit_and_cannot_prove_completeness(self):
        from inspect_browser_onnx_memory import analyze
        r=analyze(self.model(['length']),buffer_limit=12,binding_limit=12)
        self.assertEqual(r['unknown_value_count'],3)
        self.assertFalse(r['all_root_tensor_sizes_known'])
        self.assertFalse(r['idealized_literal_order_liveness']['complete_root_shapes'])

    def test_binding_limit_is_checked_separately_from_buffer_limit(self):
        from inspect_browser_onnx_memory import analyze
        r=analyze(self.model([3]),buffer_limit=16,binding_limit=8)
        self.assertEqual(len(r['known_tensors_exceed_buffer']),0)
        self.assertEqual(len(r['known_tensors_exceed_binding']),4)
        self.assertFalse(r['all_known_logical_tensors_within_limits'])

    def test_unused_stale_shape_metadata_is_not_a_live_tensor(self):
        from inspect_browser_onnx_memory import analyze
        m=self.model([3])
        m.graph.value_info.append(self.onnx.helper.make_tensor_value_info('removed_tensor',self.onnx.TensorProto.FLOAT,[1000000]))
        r=analyze(m,buffer_limit=12,binding_limit=12)
        self.assertEqual(r['max_known_tensor_bytes'],12)


    def test_cli_uses_separate_inferred_file_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'source.onnx';report=root/'report.json'
            self.onnx.save(self.model([3]),source)
            before=hashlib.sha256(source.read_bytes()).hexdigest()
            tool=Path(__file__).resolve().parents[1]/'tools/inspect_browser_onnx_memory.py'
            result=subprocess.run([sys.executable,str(tool),'--onnx',str(source),'--output',str(report),'--buffer-limit','12','--binding-limit','12'],capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
            data=json.loads(report.read_text())
            self.assertEqual(data['shape_inference_api'],'onnx.shape_inference.infer_shapes_path')
            self.assertFalse(data['inference_executed'])
            self.assertEqual(data['unknown_value_count'],0)
            self.assertEqual(sorted(p.name for p in root.iterdir()),['report.json','source.onnx'])


if __name__=='__main__':
    unittest.main()
