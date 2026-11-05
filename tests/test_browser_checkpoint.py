from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))

class Checkpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
            import onnx
            import onnxruntime as ort
        except ImportError:
            raise unittest.SkipTest('Use the pinned ONNX environment')
        cls.np,cls.onnx,cls.ort=np,onnx,ort

    def fixture(self):
        o=self.onnx;h=o.helper;T=o.TensorProto
        nodes=[h.make_node('Add',['x','w'],['mid']),h.make_node('Tanh',['mid'],['checkpoint']),h.make_node('Mul',['mid','unused_weight'],['unused'])]
        m=h.make_model(h.make_graph(nodes,'tiny',[h.make_tensor_value_info('x',T.FLOAT16,[1,2])],
            [h.make_tensor_value_info('checkpoint',T.FLOAT16,[1,2]),h.make_tensor_value_info('unused',T.FLOAT16,[1,2])],
            [o.numpy_helper.from_array(self.np.array([[.25,.5]],dtype=self.np.float16),'w'),o.numpy_helper.from_array(self.np.ones((1,2),dtype=self.np.float16),'unused_weight')],
            value_info=[h.make_tensor_value_info('mid',T.FLOAT16,[1,2])]),opset_imports=[h.make_opsetid('',19)],ir_version=13)
        return m

    def test_pruning_preserves_nodes_weights_and_values(self):
        from extract_browser_checkpoint import extract
        source=self.fixture();snapshot=source.SerializeToString();result,report=extract(source,'checkpoint')
        self.assertEqual(source.SerializeToString(),snapshot)
        self.assertEqual([x.SerializeToString() for x in result.graph.node[:2]],[x.SerializeToString() for x in source.graph.node[:2]])
        self.assertEqual([x.name for x in result.graph.initializer],['w'])
        self.assertEqual(result.graph.initializer[0].SerializeToString(),source.graph.initializer[0].SerializeToString())
        options=self.ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
        options.graph_optimization_level=self.ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        x=self.np.array([[1,-1]],dtype=self.np.float16)
        a=self.ort.InferenceSession(snapshot,options,providers=['CPUExecutionProvider']).run(['checkpoint'],{'x':x})[0]
        b=self.ort.InferenceSession(result.SerializeToString(),options,providers=['CPUExecutionProvider']).run(None,{'x':x})[0]
        self.np.testing.assert_array_equal(a,b)
        self.assertEqual(a.dtype,b.dtype)
        self.assertEqual(report['observer_nodes'],0)
        self.assertEqual(report['retained_original_nodes'],2)
        self.assertEqual(report['output_shape'],[1,2])

    def test_reject_unknown_or_nonstatic_checkpoint(self):
        from extract_browser_checkpoint import extract
        m=self.fixture()
        with self.assertRaises(ValueError):extract(m,'absent')
        m.graph.output[0].type.tensor_type.shape.dim[1].ClearField('dim_value')
        with self.assertRaises(ValueError):extract(m,'checkpoint')

    def test_inferred_metadata_retains_original_computation(self):
        from extract_browser_checkpoint import extract
        m=self.fixture();del m.graph.value_info[:]
        with self.assertRaises(ValueError):extract(m,'mid')
        inferred=self.onnx.shape_inference.infer_shapes(m,strict_mode=True,data_prop=False)
        result,report=extract(inferred,'mid')
        self.assertEqual(result.graph.node[0].SerializeToString(),m.graph.node[0].SerializeToString())
        self.assertEqual(report['output_dtype'],'float16')
        self.assertEqual(report['output_shape'],[1,2])

if __name__=='__main__':unittest.main()
