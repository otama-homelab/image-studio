"""BiRefNet HR on ROCm, exposed through rembg's session contract."""
import gc
import time
import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation
from rembg.sessions.base import BaseSession

MODEL_NAME = 'birefnet-hr-matting (AMD GPU · 2048px)'
HR_MODEL_NAME = MODEL_NAME
MODELS = {
    MODEL_NAME: ('ZhengPeng7/BiRefNet_HR-matting', '5d6b6f8adcb5b417c871b1d84ceaae9871355b7f', 2048, torch.float16),
}

model = None
active_model = None


def load_model(name=MODEL_NAME):
    global model, active_model
    if not torch.cuda.is_available() or not torch.version.hip:
        raise RuntimeError('AMD ROCm GPU is required for portrait matting')
    if name != active_model:
        # Keep one GPU model resident; serialized Gradio queue prevents overlap.
        model = None
        active_model = None
        gc.collect()
        torch.cuda.empty_cache()
        repository, revision, _, dtype = MODELS[name]
        model = AutoModelForImageSegmentation.from_pretrained(
            repository, revision=revision, code_revision=revision,
            trust_remote_code=True, use_safetensors=True,
        ).to(device='cuda', dtype=dtype).eval()
        active_model = name
    return model


def predict_mask(rgb, name=MODEL_NAME, refine=True):
    started = time.monotonic()
    net = load_model(name)
    _, _, size, dtype = MODELS[name]
    preprocess = transforms.Compose([
        transforms.Resize((size, size)), transforms.ToTensor(),
        transforms.Normalize([.485,.456,.406],[.229,.224,.225]),
    ])
    rgb = rgb.convert("RGB")
    tensor = preprocess(rgb).unsqueeze(0).to(device='cuda', dtype=dtype)
    with torch.inference_mode():
        alpha = net(tensor)[-1].float().sigmoid()
        if not torch.isfinite(alpha).all():
            raise RuntimeError('Matting returned non-finite values')
        alpha = torch.nn.functional.interpolate(alpha, size=(rgb.height, rgb.width), mode='bilinear', align_corners=False)
    mask = (alpha[0,0].cpu().numpy()*255).round().clip(0,255).astype(np.uint8)
    if refine:
        from image_studio_refinement import refine_alpha
        mask = refine_alpha(np.asarray(rgb), mask)
    print(f'{name}: mask {time.monotonic()-started:.2f}s', flush=True)
    return mask


class PortraitSession(BaseSession):
    """Use existing ROCm weights instead of creating an ONNX session.

    rembg.remove() calls predict() for masks and owns the cutout pipeline.
    """
    def __init__(self, refine=True):
        self.model_name = self.name()
        self.refine = refine

    @classmethod
    def name(cls, *args, **kwargs):
        return 'birefnet-hr-rocm'

    def predict(self, image, *args, **kwargs):
        return [Image.fromarray(predict_mask(image, refine=self.refine))]
