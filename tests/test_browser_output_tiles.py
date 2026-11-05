"""Tiny numeric and fail-closed fixtures for the HR output-block candidate."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))


class OutputTileTests(unittest.TestCase):
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
        np,h,T=self.np,self.onnx.helper,self.onnx.TensorProto
        rng=np.random.default_rng(3602)
        initializer=[self.onnx.numpy_helper.from_array(rng.uniform(-.5,.5,(1,8,1,1)).astype(np.float16),'w'),
                     self.onnx.numpy_helper.from_array(np.array([.25],dtype=np.float16),'b'),
                     self.onnx.numpy_helper.from_array(np.array([1,6,12,16],dtype=np.int64),'size')]
        nodes=[h.make_node('Resize',['small','','','size'],['large'],name='resize',mode='linear',coordinate_transformation_mode='align_corners'),
               h.make_node('Concat',['large','detail'],['cat'],name='cat',axis=1),
               h.make_node('Conv',['cat','w','b'],['y'],name='conv',kernel_shape=[1,1])]
        specs=[('small',[1,6,3,4]),('detail',[1,2,12,16])]
        model=h.make_model(h.make_graph(nodes,'tiles',[h.make_tensor_value_info(name,T.FLOAT16,shape) for name,shape in specs],
            [h.make_tensor_value_info('y',T.FLOAT16,[1,1,12,16])],initializer,
            value_info=[h.make_tensor_value_info('large',T.FLOAT16,[1,6,12,16]),h.make_tensor_value_info('cat',T.FLOAT16,[1,8,12,16])]),
            opset_imports=[h.make_opsetid('',19)],ir_version=13)
        feeds={name:rng.uniform(-.5,.5,shape).astype(np.float16) for name,shape in specs}
        return model,feeds

    def test_all_channels_bias_and_original_io_are_preserved(self):
        from tile_browser_birefnet_output import tile
        original,feeds=self.fixture();candidate=copy.deepcopy(original)
        report=tile(candidate,resize_name='resize',concat_name='cat',conv_name='conv',tile_channels=2)
        self.assertEqual([(t['weight_first'],t['end_channel']-t['first_channel']) for t in report['tiles']],[(0,2),(2,2),(4,2),(6,2)])
        self.assertEqual([v.SerializeToString() for v in original.graph.initializer],[v.SerializeToString() for v in candidate.graph.initializer[:3]])
        self.assertEqual([v.SerializeToString() for v in original.graph.output],[v.SerializeToString() for v in candidate.graph.output])
        self.onnx.checker.check_model(candidate)
        options=self.ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
        a=self.ort.InferenceSession(original.SerializeToString(),options,providers=['CPUExecutionProvider'])
        b=self.ort.InferenceSession(candidate.SerializeToString(),options,providers=['CPUExecutionProvider'])
        self.np.testing.assert_allclose(a.run(None,feeds)[0],b.run(None,feeds)[0],rtol=.002,atol=.001)

    def test_bias_is_added_once_with_zero_features(self):
        from tile_browser_birefnet_output import tile
        model,feeds=self.fixture();tile(model,resize_name='resize',concat_name='cat',conv_name='conv',tile_channels=1)
        options=self.ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
        session=self.ort.InferenceSession(model.SerializeToString(),options,providers=['CPUExecutionProvider'])
        feeds={name:self.np.zeros_like(value) for name,value in feeds.items()}
        self.np.testing.assert_array_equal(session.run(None,feeds)[0],self.np.full((1,1,12,16),.25,dtype=self.np.float16))

    def test_extra_consumer_and_grouped_conv_are_rejected(self):
        from tile_browser_birefnet_output import tile
        for condition in ('consumer','group'):
            model,_=self.fixture()
            if condition=='consumer':
                model.graph.node.append(self.onnx.helper.make_node('Identity',['large'],['tap'],name='tap'))
            else:
                model.graph.node[-1].attribute.append(self.onnx.helper.make_attribute('group',2))
            with self.subTest(condition=condition),self.assertRaises(ValueError):
                tile(model,resize_name='resize',concat_name='cat',conv_name='conv')


if __name__=='__main__':unittest.main()
