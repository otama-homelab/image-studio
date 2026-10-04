"""rembg owns the cutout, foreground recovery and background composition."""
from pathlib import Path
import tempfile
import re
import numpy as np
from PIL import Image, ImageOps
from rembg import remove
from rembg.bg import apply_background_color
from image_studio_gpu import PortraitSession
import gradio as gr

SESSIONS = {True: PortraitSession(refine=True), False: PortraitSession(refine=False)}


def change_background(image, color, refine):
    if image is None:
        raise gr.Error('写真をアップロードしてください。')
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', color or ''):
        raise gr.Error('背景色を選択してください。')
    original = ImageOps.exif_transpose(Image.fromarray(image).convert('RGB'))
    # Keep the same 2000px source limit as the previous backend.
    original.thumbnail((2000,2000), Image.Resampling.LANCZOS)
    cutout = remove(original, session=SESSIONS[bool(refine)], decontaminate=True,
                    alpha_matting=False, post_process_mask=False)
    rgba = np.array(cutout.convert('RGBA'))
    if rgba.shape != (original.height,original.width,4):
        raise RuntimeError('rembg returned an invalid cutout')
    # Foreground recovery is only intended for partial transparency. Preserve
    # opaque face/clothing exactly; no skin correction or retouching is applied.
    opaque = rgba[:,:,3] == 255
    rgba[:,:,:3][opaque] = np.asarray(original)[opaque]
    cutout = Image.fromarray(rgba)
    channels = tuple(int(color[i:i+2],16) for i in (1,3,5))
    background = apply_background_color(cutout, (*channels,255)).convert('RGB')
    folder = Path(tempfile.mkdtemp(dir='/tmp/photos/exports'))
    transparent = folder/'transparent.png'
    result = folder/'background.png'
    cutout.save(transparent)
    background.save(result)
    return str(result),str(result),str(transparent),str(result)
