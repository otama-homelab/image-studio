"""InsightFace's official SCRFD-10G and 106-point landmark pipeline."""
import cv2
import numpy as np
import onnxruntime as ort
from insightface.app import FaceAnalysis
from PIL import Image
from image_studio_gpu import predict_mask

analyzer = None


def head_geometry(image):
    global analyzer
    if analyzer is None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 8
        options.inter_op_num_threads = 1
        analyzer = FaceAnalysis(name='antelopev2', root='/cache/insightface',
                                allowed_modules=['detection', 'landmark_2d_106'],
                                providers=['CPUExecutionProvider'], sess_options=options)
        analyzer.prepare(ctx_id=-1, det_thresh=0.6, det_size=(1024,1024))
    scale = min(1.0, 2000/max(image.shape[:2]))
    working = cv2.resize(image, (round(image.shape[1]*scale),round(image.shape[0]*scale))) if scale<1 else image
    faces = analyzer.get(working)
    if len(faces) != 1:
        raise ValueError('Expected exactly one face')
    face = faces[0]
    points = face.landmark_2d_106
    if points.shape != (106,2) or not np.isfinite(points).all():
        raise ValueError('Invalid face landmarks')
    left, top, right, bottom = face.bbox
    chin = float(points[:,1].max())
    alpha = predict_mask(Image.fromarray(cv2.cvtColor(working,cv2.COLOR_BGR2RGB)), refine=False)
    # Find the main person's silhouette; background objects must not set crown.
    mask = alpha >= 192
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8),8)
    face_x = int(np.clip(face.kps[:,0].mean(),0,working.shape[1]-1))
    face_y = int(np.clip((top+bottom)/2,0,working.shape[0]-1))
    person = labels[face_y,face_x]
    if person == 0:
        raise ValueError('Face is outside the foreground mask')
    x0 = max(0,int(left-(right-left)*.25))
    x1 = min(working.shape[1],int(right+(right-left)*.25)+1)
    rows = np.flatnonzero((labels[:face_y+1,x0:x1]==person).sum(axis=1)>=max(3,round((x1-x0)*.03)))
    if not len(rows):
        raise ValueError('Head crown could not be estimated')
    crown = float(rows[0])
    if chin <= crown or chin > working.shape[0]:
        raise ValueError('Invalid head geometry')
    return float(face.kps[:2,0].mean())/scale, crown/scale, chin/scale
