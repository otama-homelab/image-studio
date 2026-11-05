// Hardware diagnostics only. Passing this probe says nothing about model fit.
self.onmessage = async ({data}) => {
  if (data.type !== 'probe') return;
  const report = {scope:'WebGPU in a dedicated Worker; no ONNX inference',status:'started'};
  let device;
  const buffers = [];
  try {
    report.webgpuExposed = Boolean(navigator.gpu);
    if (!navigator.gpu) {
      report.status = 'webgpu-unavailable';
      return;
    }
    const adapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
    if (!adapter) {
      report.status = 'adapter-unavailable';
      return;
    }
    const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    report.adapter = Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter']
      .map(key => [key, info[key] ?? (key === 'isFallbackAdapter' ? adapter[key] ?? null : null)]));
    report.features = [...adapter.features].sort();
    report.limits = {};
    for (const key in adapter.limits) {
      if (typeof adapter.limits[key] === 'number') report.limits[key] = adapter.limits[key];
    }
    device = await adapter.requestDevice();
    const source = device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const target = device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const readback = device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    buffers.push(source,target,readback);
    device.queue.writeBuffer(source,0,new Float32Array([1,3,5,7]));
    const module = device.createShaderModule({code:`
      @group(0) @binding(0) var<storage,read> valuesIn: array<f32>;
      @group(0) @binding(1) var<storage,read_write> valuesOut: array<f32>;
      @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id:vec3<u32>) {
        valuesOut[id.x] = valuesIn[id.x] * 2.0 + 1.0;
      }`});
    report.shaderMessages = [...(await module.getCompilationInfo()).messages]
      .map(message => ({type:message.type,message:message.message,lineNum:message.lineNum}));
    const pipeline = await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    const bindGroup = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
      {binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:target}}]});
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0,bindGroup); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(target,0,readback,0,16);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    report.output = [...new Float32Array(readback.getMappedRange())];
    readback.unmap();
    report.status = report.output.every((value,index)=>value === [3,7,11,15][index]) ? 'compute-verified' : 'compute-mismatch';
  } catch (error) {
    report.status = 'error'; report.error = {name:error.name,message:error.message};
  } finally {
    for (const buffer of buffers) buffer.destroy();
    device?.destroy();
    self.postMessage(report);
  }
};
