"""Single native CPU DeformConv probe, not full-model or WebGPU acceptance."""
import json,numpy as np,onnx,onnxruntime as ort
from onnx import helper,numpy_helper,TensorProto
result=[]
for dtype,name,kind in [(np.float16,'float16',TensorProto.FLOAT16),(np.float32,'float32',TensorProto.FLOAT)]:
 node=helper.make_node('DeformConv',['input','weight','offset'],['output'],kernel_shape=[1,1])
 graph=helper.make_graph([node],'deform-probe',[helper.make_tensor_value_info('input',kind,[1,1,3,3])],[helper.make_tensor_value_info('output',kind,[1,1,3,3])],[numpy_helper.from_array(np.ones((1,1,1,1),dtype=dtype),'weight'),numpy_helper.from_array(np.zeros((1,2,3,3),dtype=dtype),'offset')])
 model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',19)],ir_version=13)
 try:
  options=ort.SessionOptions();options.intra_op_num_threads=1
  session=ort.InferenceSession(model.SerializeToString(),sess_options=options,providers=['CPUExecutionProvider'])
  actual=session.run(None,{'input':np.ones((1,1,3,3),dtype=dtype)})[0]
  result.append({'precision':name,'supported':bool(np.array_equal(actual,np.ones((1,1,3,3),dtype=dtype)))})
 except Exception as error:result.append({'precision':name,'supported':False,'error_type':type(error).__name__,'error':str(error)})
print(json.dumps({'scope':'single native CPU operator probe only','ort':ort.__version__,'opset':19,'results':result},indent=2))
