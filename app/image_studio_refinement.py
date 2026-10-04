"""Official Transformers ViTMatte Base on ROCm, guided by BiRefNet HR."""
import time
import cv2
import numpy as np
import torch
from PIL import Image
from transformers import VitMatteForImageMatting, VitMatteImageProcessor

REPOSITORY = 'hustvl/vitmatte-base-distinctions-646'
REVISION = 'b58373f8dbbfbeb58157456e2e4949f9f872aa18'
model = None
processor = None


def make_trimap(mask):
    # Keep soft hair pixels unknown; erosion gives the network room to recover
    # edges just outside the first mask. Radius scales with source resolution.
    radius = max(3, round(max(mask.shape) * 0.006))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*radius+1, 2*radius+1))
    foreground = cv2.erode((mask >= 250).astype(np.uint8), kernel).astype(bool)
    background = cv2.erode((mask <= 5).astype(np.uint8), kernel).astype(bool)
    trimap = np.full(mask.shape, 128, dtype=np.uint8)
    trimap[foreground] = 255
    trimap[background] = 0
    return trimap


def refine_alpha(image, mask):
    global model, processor
    trimap = make_trimap(mask)
    if not np.any(trimap == 128):
        return mask.copy()
    if not np.any(trimap == 255) or not np.any(trimap == 0):
        # Without both anchors the automatic trimap is ambiguous. Preserve HR.
        print('ViTMatte: no reliable foreground/background anchors; keeping HR alpha', flush=True)
        return mask.copy()
    started = time.monotonic()
    if model is None:
        processor = VitMatteImageProcessor.from_pretrained(REPOSITORY, revision=REVISION)
        model = VitMatteForImageMatting.from_pretrained(
            REPOSITORY, revision=REVISION, use_safetensors=True,
        ).to(device='cuda', dtype=torch.float32).eval()
    rgb = Image.fromarray(image)
    inputs = processor(images=rgb, trimaps=Image.fromarray(trimap),
                       return_tensors='pt', do_resize=False).to('cuda')
    with torch.inference_mode():
        alpha = model(**inputs).alphas[0, 0, :mask.shape[0], :mask.shape[1]]
        if alpha.shape != mask.shape or not torch.isfinite(alpha).all():
            raise RuntimeError('ViTMatte returned invalid alpha')
    refined = (alpha.cpu().numpy()*255).round().clip(0,255).astype(np.uint8)
    # Only the unknown band is refined; definite foreground/background is fixed.
    refined[trimap == 255] = 255
    refined[trimap == 0] = 0
    print(f'ViTMatte Base edge refinement: {time.monotonic()-started:.2f}s', flush=True)
    return refined
