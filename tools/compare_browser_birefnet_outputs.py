"""Postprocess SHA-verified browser HR alpha using the reference CPU interpolation."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def read_raw(path, expected_sha=None):
    import numpy as np
    if path.stat().st_size!=2048*2048*4:raise ValueError('Expected full 2048 FP32 alpha')
    data=path.read_bytes()
    digest=hashlib.sha256(data).hexdigest()
    if expected_sha is not None and digest!=expected_sha:raise ValueError('Raw output SHA mismatch')
    array=np.frombuffer(data,dtype='<f4').reshape(1,1,2048,2048).copy()
    if not np.isfinite(array).all():raise ValueError('Nonfinite raw output')
    return array,digest


def resize_alpha(array, size):
    import numpy as np
    import torch
    with torch.inference_mode():
        resized=torch.nn.functional.interpolate(torch.from_numpy(array),size=(size[1],size[0]),
                                                mode='bilinear',align_corners=False)[0,0].numpy()
    return np.rint(resized*255).clip(0,255).astype(np.uint8)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-result',type=Path,required=True)
    parser.add_argument('--reference-root',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--control-raw',type=Path)
    parser.add_argument('--control-alpha',type=Path)
    args=parser.parse_args()
    if args.output.exists() or bool(args.control_raw)!=bool(args.control_alpha):
        parser.error('Choose a new output; supply both control files together')
    os.environ['OPENBLAS_NUM_THREADS']='1';os.environ['OMP_NUM_THREADS']='1'
    import numpy as np
    from PIL import Image
    import torch
    from compare_browser_alpha import measure
    torch.set_num_threads(1)
    receipt=json.loads((args.browser_result/'report.json').read_text())
    if receipt['status']!='complete-output-sha-verified' or receipt['page']['state']!='complete':
        raise ValueError('Expected a completed and copied browser result')
    meta=receipt['page']['report'];case=meta['caseId'];name=receipt['outputFile']
    if any(Path(x).name!=x or x in ('.','..','') for x in (case,name)):
        raise ValueError('Invalid case/output path')
    if meta['type']!='result' or meta['shape']!=[1,1,2048,2048] or meta['outputDtype']!='float32':
        raise ValueError('Expected full HR result contract')
    if receipt['outputSha256']!=meta['outputSha256']:raise ValueError('Receipt SHA disagreement')
    actual,digest=read_raw(args.browser_result/name,meta['outputSha256'])
    reference=args.reference_root/case/'refine-off'
    with Image.open(reference/'alpha.png') as image:
        if image.mode!='L':raise ValueError('Expected L-mode reference alpha')
        expected=np.asarray(image);size=image.size
    if not all(1<=x<=2000 for x in size):raise ValueError('Reference dimensions outside existing application contract')
    with Image.open(reference/'trimap.png') as image:
        if image.mode!='L':raise ValueError('Expected L-mode trimap')
        trimap=np.asarray(image)
    control=None
    if args.control_raw:
        array,control_sha=read_raw(args.control_raw)
        with Image.open(args.control_alpha) as image:control_expected=np.asarray(image)
        control={'raw_sha256':control_sha,'same_pixels':bool(np.array_equal(resize_alpha(array,size),control_expected))}
        if not control['same_pixels']:raise ValueError('Reference postprocessing control mismatch')
        del array
    alpha=resize_alpha(actual,size)
    report={'status':'original_size_browser_vs_rocm_metrics_measured_not_accepted','case_id':case,
            'browser_version':receipt['browserVersion'],'strict':meta['strict'],'raw_sha256':digest,
            'original_size':list(size),'torch':torch.__version__,'postprocess_device':'cpu',
            'interpolation':'bilinear align_corners=False, NumPy ties-to-even rounding, uint8 clip',
            'control':control,'metrics':measure(expected,alpha,trimap),
            'anchor_note':'Unclamped HR alpha: anchor counts descriptive, not ViTMatte anchor-preservation violations'}
    args.output.mkdir(mode=0o700)
    Image.fromarray(alpha).save(args.output/'alpha.png')
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
