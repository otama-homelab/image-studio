import copy
import tempfile
import sys
from pathlib import Path
import unittest
import numpy as np
import onnx
from onnx import TensorProto as T, helper as h, numpy_helper
from onnx.reference import ReferenceEvaluator
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from partition_browser_onnx import plan_stages, extract_stages, pack_stages


def graph(dtype=T.FLOAT, width=4):
    x = h.make_tensor_value_info('x', dtype, [1, width])
    out = h.make_tensor_value_info('out', dtype, [1, width])
    w = numpy_helper.from_array(np.resize(np.array([1, -2, 3, 4], dtype=np.float32 if dtype == T.FLOAT else np.float16), (1, width)), name='w')
    nodes = [h.make_node('Add', ['w', 'w'], ['constant'], name='constant'),
             h.make_node('Mul', ['x', 'constant'], ['a'], name='a'),
             h.make_node('Add', ['a', 'w'], ['b'], name='b'),
             h.make_node('Mul', ['x', 'w'], ['skip'], name='skip'),
             h.make_node('Add', ['b', 'skip'], ['joined'], name='joined'),
             h.make_node('Add', ['joined', 'constant'], ['c'], name='c'),
             h.make_node('Relu', ['c'], ['out'], name='out')]
    return onnx.shape_inference.infer_shapes(h.make_model(h.make_graph(nodes, 'partition-test', [x], [out], [w]), opset_imports=[h.make_opsetid('', 17)]), strict_mode=True)


class PartitionTests(unittest.TestCase):
    def test_full_reference_matches_stages_with_skip_and_reused_constant(self):
        for dtype in [T.FLOAT, T.FLOAT16]:
            m = graph(dtype)
            before = m.SerializeToString()
            stages, analysis = plan_stages(m, 32)
            parts = list(extract_stages(m, stages, analysis))
            self.assertGreater(len(parts), 1)
            self.assertTrue(all('constant' not in s['inputs'] + s['outputs'] for s in stages))
            self.assertGreater(sum(n.name == 'constant' for p in parts for n in p.graph.node), 1)
            data = np.array([[-1, 0, .5, 2]], dtype=np.float32 if dtype == T.FLOAT else np.float16)
            expected = ReferenceEvaluator(m).run(None, {'x': data})[0]
            values = {'x': data}
            for stage, part in zip(stages, parts):
                onnx.checker.check_model(part)
                result = ReferenceEvaluator(part).run(stage['outputs'], {n: values[n] for n in stage['inputs']})
                values.update(zip(stage['outputs'], result))
            np.testing.assert_array_equal(values['out'], expected)
            self.assertEqual(values['out'].dtype, data.dtype)
            self.assertEqual(m.SerializeToString(), before)

    def test_external_packing_keeps_initializer_bits_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            m = graph(T.FLOAT16, 1024)
            bits = np.resize(np.array([0x8000, 0x0001, 0x7e23, 0x7bff], dtype=np.uint16), (1, 1024))
            m.graph.initializer[0].CopyFrom(numpy_helper.from_array(bits.view(np.float16), name='w'))
            onnx.save_model(m, root / 'source.onnx', save_as_external_data=True,
                            all_tensors_to_one_file=True, location='source.data', size_threshold=1024)
            source = onnx.load(root / 'source.onnx', load_external_data=False)
            before = source.SerializeToString()
            stages, analysis = plan_stages(source, 4096)
            output = root / 'parts'
            output.mkdir()
            records = pack_stages(source, stages, analysis, root, output)
            self.assertEqual(len(records), len(stages))
            self.assertTrue(all(r['checker_passed'] for r in records))
            for i in range(len(stages)):
                part = onnx.load(output / f'stage-{i:03d}/model.onnx')
                for tensor in part.graph.initializer:
                    if tensor.name == 'w':
                        np.testing.assert_array_equal(numpy_helper.to_array(tensor).view(np.uint16), bits)
            self.assertEqual(source.SerializeToString(), before)

    def test_single_large_node_advances_and_is_not_claimed_to_fit(self):
        m = graph()
        stages, analysis = plan_stages(m, 1)
        self.assertTrue(any(s['logical_output_work_bytes'] > 1 for s in stages))
        self.assertEqual(sum(len(s['runtime_node_indices']) for s in stages), 6)
        self.assertEqual(len(list(extract_stages(m, stages, analysis))), len(stages))

    def test_tampered_cut_cannot_omit_or_duplicate_computation(self):
        m = graph()
        stages, analysis = plan_stages(m, 32)
        stages[0]['runtime_node_indices'] = []
        with self.assertRaisesRegex(ValueError, 'omitted or duplicated'):
            list(extract_stages(m, stages, analysis))

    def test_dynamic_shape_and_stateful_nodes_rejected(self):
        m = graph()
        m.graph.input[0].type.tensor_type.shape.dim[1].ClearField('dim_value')
        with self.assertRaisesRegex(ValueError, 'Static tensor'):
            plan_stages(m, 32)
        for op in ['Dropout', 'RandomNormal']:
            m = graph()
            m.graph.node[0].op_type = op
            with self.assertRaisesRegex(ValueError, 'Stateful'):
                plan_stages(m, 32)

    def test_non_topological_and_overridable_weights_rejected(self):
        m = graph()
        m.graph.node[1].input[0] = 'out'
        with self.assertRaisesRegex(ValueError, 'Topologically'):
            plan_stages(m, 32)
        m = graph()
        m.graph.input.append(h.make_tensor_value_info('w', T.FLOAT, [1, 4]))
        with self.assertRaisesRegex(ValueError, 'Overridable'):
            plan_stages(m, 32)

    def test_nonfloating_runtime_boundary_rejected(self):
        x = h.make_tensor_value_info('x', T.FLOAT, [4])
        out = h.make_tensor_value_info('out', T.FLOAT, [4])
        m = onnx.shape_inference.infer_shapes(h.make_model(h.make_graph([
            h.make_node('Cast', ['x'], ['i'], to=T.INT64),
            h.make_node('Cast', ['i'], ['out'], to=T.FLOAT)], 'boundary', [x], [out]), opset_imports=[h.make_opsetid('', 17)]))
        with self.assertRaisesRegex(ValueError, 'non-floating'):
            plan_stages(m, 1)


if __name__ == '__main__':
    unittest.main()
