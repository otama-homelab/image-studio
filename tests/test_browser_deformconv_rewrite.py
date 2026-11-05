"""Tiny correctness/rejection checks; never load the learned HR graph."""
import copy
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))


class DeformConvRewriteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy
            import onnx
            import onnxruntime
        except ImportError:
            raise unittest.SkipTest('Use the pinned browser ONNX environment')
        cls.np, cls.onnx, cls.ort = numpy, onnx, onnxruntime

    def fixture(self):
        from browser_deformconv_graph import build
        model, _, specs = build([1, 2, 7, 9], [3, 2, 3, 3], self.onnx.TensorProto.FLOAT16,
                                pads=[1]*4, strides=[1, 1], dilations=[1, 1])
        rng = self.np.random.default_rng(3601)
        feeds = {name: rng.uniform(-.5, .5, shape).astype(self.np.float16) for name, shape in specs}
        # Learned values are now inline initializers, while offsets/mask remain runtime inputs.
        for name in ['weight', 'bias']:
            model.graph.initializer.append(self.onnx.numpy_helper.from_array(feeds.pop(name), name))
        inputs = [i for i in model.graph.input if i.name not in ('weight', 'bias')]
        del model.graph.input[:]
        model.graph.input.extend(inputs)
        return model, feeds

    def test_rewrite_keeps_values_io_offsets_and_mask(self):
        from rewrite_browser_birefnet_deformconv import rewrite
        original, feeds = self.fixture()
        candidate = copy.deepcopy(original)
        rewrite(candidate, expected_count=1)
        self.onnx.checker.check_model(candidate)
        self.assertEqual([i.SerializeToString() for i in original.graph.initializer],
                         [i.SerializeToString() for i in candidate.graph.initializer[:2]])
        self.assertEqual([i.SerializeToString() for i in original.graph.input],
                         [i.SerializeToString() for i in candidate.graph.input])
        self.assertEqual([i.SerializeToString() for i in original.graph.output],
                         [i.SerializeToString() for i in candidate.graph.output])
        self.assertFalse(any(n.op_type == 'DeformConv' for n in candidate.graph.node))
        options = self.ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        reference = self.ort.InferenceSession(original.SerializeToString(), options, providers=['CPUExecutionProvider'])
        transformed = self.ort.InferenceSession(candidate.SerializeToString(), options, providers=['CPUExecutionProvider'])
        for changed_mask in (False, True):
            if changed_mask:
                feeds['mask'] = self.np.zeros_like(feeds['mask'])
            expected = reference.run(None, feeds)[0]
            actual = transformed.run(None, feeds)[0]
            self.np.testing.assert_allclose(actual, expected, rtol=.002, atol=.001)

    def test_rejects_grouped_missing_mask_or_wrong_shape(self):
        from rewrite_browser_birefnet_deformconv import rewrite
        for condition in ('grouped', 'mask_missing', 'offset_shape'):
            model, _ = self.fixture()
            if condition == 'grouped':
                next(a for a in model.graph.node[0].attribute if a.name == 'group').i = 2
            elif condition == 'mask_missing':
                model.graph.node[0].input.pop()
            else:
                next(i for i in model.graph.input if i.name == 'offset').type.tensor_type.shape.dim[1].dim_value -= 1
            with self.subTest(condition=condition), self.assertRaises(ValueError):
                rewrite(model, expected_count=1)

    def test_rejects_namespace_collision_or_wrong_count(self):
        from rewrite_browser_birefnet_deformconv import rewrite
        model, _ = self.fixture()
        with self.assertRaises(ValueError):
            rewrite(model, expected_count=20)
        model, _ = self.fixture()
        model.graph.initializer.append(self.onnx.numpy_helper.from_array(
            self.np.array([1], dtype=self.np.int64), 'browser_deform_000__collision'))
        with self.assertRaises(ValueError):
            rewrite(model, expected_count=1)

    def test_external_data_copy_is_independent_verified_and_never_overwrites(self):
        from rewrite_browser_birefnet_deformconv import copy_verified
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'source', Path(directory)/'copy'
            data = b'fixture-for-external-data'
            source.write_bytes(data)
            copy_verified(source,target,hashlib.sha256(data).hexdigest())
            self.assertEqual(target.read_bytes(),data)
            self.assertNotEqual(source.stat().st_ino,target.stat().st_ino)
            self.assertEqual(target.stat().st_nlink,1)
            with self.assertRaises(FileExistsError):
                copy_verified(source,target,hashlib.sha256(data).hexdigest())
            with self.assertRaises(ValueError):
                copy_verified(source,Path(directory)/'invalid','0'*64)


if __name__ == '__main__':
    unittest.main()
