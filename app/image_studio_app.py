import time
import os
import shutil
import threading
from pathlib import Path
import torch
import gradio as gr
from image_studio_gpu import load_model, unload_model, runtime_model_status
from image_studio_runtime import runtime, control_server
from image_studio_ui import build as build_portrait
from image_studio_theme import CSS, HEADER, theme

Path('/tmp/photos/exports').mkdir(parents=True, exist_ok=True)


def cleanup():
    while True:
        for folder in Path('/tmp/photos/exports').iterdir():
            if folder.is_dir() and folder.stat().st_mtime < time.time()-3600:
                shutil.rmtree(folder, ignore_errors=True)
        time.sleep(300)


if __name__ == '__main__':
    threading.Thread(target=cleanup, daemon=True).start()
    torch.set_num_threads(8)
    print(f'rembg + ROCm {torch.version.hip}: {torch.cuda.get_device_name(0)}', flush=True)
    control_port = int(os.environ.get('IMAGE_STUDIO_RUNTIME_CONTROL_PORT', '0'))
    if control_port:
        if not 1024 <= control_port <= 65535:
            raise ValueError('Runtime control port must be between 1024 and 65535')
        if os.environ.get('IMAGE_STUDIO_BACKEND', 'rocm') != 'rocm':
            raise RuntimeError('Runtime control is supported only for ROCm')
        # Start closed and unloaded. Only the GPU role owner can resume work.
        runtime.drain()
        server = control_server(control_port, gate=runtime, unload=unload_model,
                                model_status=runtime_model_status)
        threading.Thread(target=server.serve_forever, daemon=True).start()
    else:
        load_model()
    tools = [("証明写真", build_portrait)]
    with gr.Blocks(title="Image Studio", delete_cache=(300, 3600)) as demo:
        gr.HTML(HEADER)
        with gr.Tabs(elem_id="studio-tools"):
            for name, build_tool in tools:
                with gr.Tab(name):
                    build_tool()
    demo.queue(default_concurrency_limit=1,max_size=4).launch(
        server_name='0.0.0.0',server_port=7860,share=False,max_file_size='20mb',
        theme=theme(),css=CSS,footer_links=[])
