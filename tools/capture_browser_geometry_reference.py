#!/usr/bin/env python3
"""Capture scalar geometry from existing UI code without importing ML/Pillow.

Image operations are recording stubs: this proves coordinates, never pixels,
resampling, metadata encoding, or actual file output. Runs no model/browser.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace


def capture(source: Path) -> dict:
    raw = source.read_bytes()
    tree = ast.parse(raw, filename=str(source))
    names = {"US_SIZE", "SIZES", "PAPERS"}
    functions = {"dimensions", "frame", "print_layout"}
    nodes = [node for node in tree.body if
             (isinstance(node, ast.Assign) and any(
                 isinstance(target, ast.Name) and target.id in names
                 for target in node.targets)) or
             (isinstance(node, ast.FunctionDef) and node.name in functions)]
    assert {n.name for n in nodes if isinstance(n, ast.FunctionDef)} == functions
    recorded = {}

    class GeometryImage:
        def __init__(self, width, height, dpi=None):
            self.width, self.height = width, height
            self.info = {} if dpi is None else {"dpi": dpi}

        def convert(self, mode):
            assert mode == "RGB"
            return self

        def resize(self, size, resample, box):
            recorded["crop"] = {"source_px": [self.width, self.height],
                                "output_px": list(size), "box": list(box)}
            return GeometryImage(*size)

        def paste(self, image, position):
            recorded["layout"]["positions_px"].append(list(position))

        def save(self, path, **kwargs):
            recorded["layout"].setdefault("save_arguments", []).append(kwargs)

    def new_sheet(mode, size, color):
        assert mode == "RGB" and color == "white"
        recorded["layout"] = {"sheet_px": list(size), "positions_px": []}
        return GeometryImage(*size)

    env = {"gr": SimpleNamespace(Error=ValueError),
           "Image": SimpleNamespace(Resampling=SimpleNamespace(LANCZOS="LANCZOS"),
                                    new=new_sheet),
           "Path": Path,
           "tempfile": SimpleNamespace(mkdtemp=lambda **kwargs: "/not-written")}
    # Only the named constants/functions execute; imports and build() are excluded.
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), env)
    presets = {name: list(env["dimensions"](name, 30, 40))
               for name, value in env["SIZES"].items() if value is not None}
    crops = []
    for image_size, preset, zoom, horizontal, vertical in [
        ((1601, 2000), next(iter(env["SIZES"])), 100, 50, 50),
        ((2000, 1333), next(iter(env["SIZES"])), 10, 0, 100),
        ((2000, 2000), env["US_SIZE"], 75, 100, 0),
        ((300, 900), "カスタムサイズ", 100, 50, 50),
    ]:
        env["frame"](GeometryImage(*image_size), preset, 152, 9,
                     zoom, horizontal, vertical)
        crops.append({"preset": preset, "custom_mm": [152, 9],
                      "range_percent": zoom, "horizontal_percent": horizontal,
                      "vertical_percent": vertical, **recorded.pop("crop")})
    layouts = []
    for paper in env["PAPERS"]:
        env["print_layout"](GeometryImage(354, 472), paper)
        layouts.append({"paper": paper, "photo_px": [354, 472],
                        "dpi_input": "absent-assumed-300", **recorded.pop("layout")})
    failures = []
    for case, image in [("non_300dpi", GeometryImage(354, 472, (299, 300))),
                        ("too_large", GeometryImage(4000, 4000))]:
        try:
            env["print_layout"](image, next(iter(env["PAPERS"])))
        except ValueError as error:
            failures.append({"case": case, "message": str(error)})
        else:
            raise AssertionError(f"Expected failure: {case}")
    return {"scope": "Existing Python scalar geometry with recording image stubs; no pixel/file/metadata acceptance",
            "source": "app/image_studio_ui.py", "source_sha256": hashlib.sha256(raw).hexdigest(),
            "presets_px": presets, "crops": crops, "layouts": layouts,
            "rejected": failures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / "app/image_studio_ui.py"
    args.output.write_text(json.dumps(capture(source), ensure_ascii=False, indent=2) + "\n")
