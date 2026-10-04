"""Owned HTML/JS components using Gradio's public props/events API."""
import base64
from io import BytesIO
from pathlib import Path

import gradio as gr
from PIL import Image

ROOT = Path(__file__).parent / 'components'


def component(name, value=None, **kwargs):
    return gr.HTML(
        value=value,
        html_template=(ROOT / f'{name}.html').read_text(),
        css_template=(ROOT / f'{name}.css').read_text(),
        js_on_load=(ROOT / f'{name}.js').read_text(),
        apply_default_css=False,
        **kwargs,
    )


def comparison_value(source, result):
    """Bound preview payloads; downloadable PNGs retain their full resolution."""
    original = Image.fromarray(source).convert('RGB')
    with Image.open(result) as completed:
        before = original.resize(completed.size, Image.Resampling.LANCZOS)
        width, height = completed.size
        previews = []
        for image in (before, completed.convert('RGB')):
            image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
            stream = BytesIO()
            image.save(stream, format='JPEG', quality=92)
            previews.append('data:image/jpeg;base64,' + base64.b64encode(stream.getvalue()).decode('ascii'))
    return dict(before=previews[0], after=previews[1], width=width, height=height)
