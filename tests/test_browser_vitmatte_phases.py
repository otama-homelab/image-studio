"""Prove lexical capture retention and numerical parity across three sessions."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np
import onnx
from onnx import helper as h, TensorProto as t
import onnxruntime as ort

spec = importlib.util.spec_from_file_location('phases', Path(__file__).parents[1] / 'tools/partition_browser_vitmatte.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PhasesTest(unittest.TestCase):
    def test_source_guard_rejects_unpinned_bytes_before_partition(self):
        with self.assertRaisesRegex(ValueError,'Pinned source graph required'):module.validate_source_graph(self.model().SerializeToString())

    def test_gpu_body_lexical_captures_and_node_bytes_survive_partition(self):
        model=self.model();body=next(a.g for a in model.graph.node[0].attribute if a.name=='body')
        body.node.append(h.make_node('MultiHeadAttention',['Q','K','V'],['unused_attention'],name='official_mha',domain='com.microsoft',num_heads=1,scale=.125))
        for name in ['Q','K','V']:model.graph.initializer.append(h.make_tensor(name,t.FLOAT,[1,1,64],[.1]*64))
        model.opset_import.append(h.make_opsetid('com.microsoft',1));stages=module.partition(model)
        self.assertEqual(stages[0].graph.node[0].SerializeToString(),model.graph.node[0].SerializeToString())
        for name in ['Q','K','V']:
            a=next(v for v in model.graph.initializer if v.name==name);b=next(v for v in stages[0].graph.initializer if v.name==name);self.assertEqual(a.SerializeToString(),b.SerializeToString())
        for stage in stages:onnx.checker.check_model(stage)

    def model(self):
        scalar = lambda name, kind: h.make_tensor_value_info(name, kind, [])
        body = h.make_graph([
            h.make_node('Identity', ['condition'], ['condition_out'], name='body_condition'),
            h.make_node('Identity', ['captured'], ['value_out'], name='body_capture'),
        ], 'body', [scalar('iteration', t.INT64), scalar('condition', t.BOOL), scalar('value', t.FLOAT)],
            [scalar('condition_out', t.BOOL), scalar('value_out', t.FLOAT)])
        nodes = [
            h.make_node('Loop', ['trip', 'continue', 'seed'], ['loop_value'], name='loop', body=body),
            h.make_node('Add', ['pixel_values', 'loop_value'], ['add_13650'], name='backbone'),
            h.make_node('Add', ['pixel_values', 'add_13650'], ['relu_5'], name='decoder1'),
            h.make_node('Add', ['pixel_values', 'relu_5'], ['alphas'], name='decoder2'),
        ]
        info = lambda name: h.make_tensor_value_info(name, t.FLOAT, [1, 4, 32, 32])
        graph = h.make_graph(nodes, 'source', [info('pixel_values')], [info('alphas')],
            initializer=[h.make_tensor('trip', t.INT64, [], [1]), h.make_tensor('continue', t.BOOL, [], [True]),
                         h.make_tensor('seed', t.FLOAT, [], [0]), h.make_tensor('captured', t.FLOAT, [], [2])],
            value_info=[info('add_13650'), info('relu_5'), scalar('loop_value', t.FLOAT)])
        return h.make_model(graph, opset_imports=[h.make_opsetid('', 18)], ir_version=10)

    def test_same_outputs_and_each_original_node_once_with_lexical_capture(self):
        model = self.model()
        stages = module.partition(model)
        self.assertEqual(len(stages), 3)
        self.assertIn('captured', [v.name for v in stages[0].graph.initializer])
        original = {n.name: n.SerializeToString() for n in model.graph.node}
        actual = [n for stage in stages for n in stage.graph.node]
        self.assertEqual(len(actual), len(original))
        self.assertEqual({n.name: n.SerializeToString() for n in actual}, original)
        pixels = np.random.default_rng(42).normal(size=(1, 4, 32, 32)).astype(np.float32)
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        def run(graph, feeds):
            onnx.checker.check_model(graph)
            return ort.InferenceSession(graph.SerializeToString(), options, providers=['CPUExecutionProvider']).run(None, feeds)[0]
        expected = run(model, {'pixel_values': pixels})
        feature = run(stages[0], {'pixel_values': pixels})
        feature = run(stages[1], {'pixel_values': pixels, 'add_13650': feature})
        actual = run(stages[2], {'pixel_values': pixels, 'relu_5': feature})
        np.testing.assert_array_equal(actual, expected)

    def test_missing_boundary_rejected(self):
        model = self.model()
        model.graph.node[1].output[0] = 'unexpected'
        with self.assertRaises(ValueError):
            module.partition(model)

    def test_cli_rejects_unpinned_graph_without_creating_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'input.onnx'
            source.write_bytes(self.model().SerializeToString())
            output = root / 'result'
            process = subprocess.run([sys.executable, str(Path(module.__file__)), '--onnx', str(source),
                                      '--output', str(output)], capture_output=True, text=True)
            self.assertNotEqual(process.returncode, 0)
            self.assertIn('Pinned source graph required', process.stderr)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
