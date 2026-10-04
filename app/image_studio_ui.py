"""Japanese portrait workflow: background, framing, then print."""
from pathlib import Path
import tempfile
import cv2
import numpy as np
from image_studio_face import head_geometry
import gradio as gr
from PIL import Image
from image_studio_backend import change_background

US_SIZE = '米国パスポート（2×2インチ・約51×51mm）'
SIZES = {'履歴書・在留カード（30×40mm）': (30,40),
         'パスポート・マイナンバー（35×45mm）': (35,45),
         '運転免許（24×30mm）': (24,30), US_SIZE: (50.8,50.8), 'カスタムサイズ': None}
PAPERS = {'A4（210×297mm）': (3508,2480), 'L判（89×127mm）': (1051,1500),
          '2L判（127×178mm）': (1500,2102), 'はがき（100×148mm）': (1748,1181)}
COLORS = {'オフホワイト': '#F5F3EF', '白': '#FFFFFF', '青': '#8EC5FF', 'グレー': '#DDDDDD'}


def dimensions(preset, width, height):
    width,height = SIZES[preset] or (width,height)
    if not 9 <= width <= 152 or not 9 <= height <= 152:
        raise gr.Error('幅・高さは9〜152mmで指定してください。')
    return round(width/25.4*300), round(height/25.4*300)


def frame(image, preset, width, height, zoom, horizontal, vertical):
    if image is None:
        return None
    target_w,target_h = dimensions(preset,width,height)
    aspect = target_w/target_h
    crop_h = min(image.height, image.width/aspect)*zoom/100
    crop_w = crop_h*aspect
    left=(image.width-crop_w)*horizontal/100
    top=(image.height-crop_h)*vertical/100
    # Floating crop coordinates retain the exact target aspect ratio.
    return image.convert('RGB').resize((target_w,target_h), Image.Resampling.LANCZOS,
                                      box=(left,top,left+crop_w,top+crop_h))


def center_face(image,preset,width,height):
    if image is None:
        raise gr.Error('写真をアップロードしてください。')
    try:
        center_x, crown, chin = head_geometry(cv2.cvtColor(np.array(image.convert('RGB')),cv2.COLOR_RGB2BGR))
    except Exception as error:
        raise gr.Error('顔と頭頂を1人分検出できませんでした。位置を手動で調整してください。') from error
    target_w,target_h=dimensions(preset,width,height)
    aspect=target_w/target_h
    max_height=min(image.height,image.width/aspect)
    head_ratio = 30/50.8 if preset == US_SIZE else .68
    crop_h=min(max_height,(chin-crown)/head_ratio)
    crop_w=crop_h*aspect
    horizontal=(center_x-crop_w/2)/(image.width-crop_w)*100 if image.width>crop_w else 50
    vertical=(crown-crop_h*.10)/(image.height-crop_h)*100 if image.height>crop_h else 50
    return max(10,min(100,crop_h/max_height*100)),max(0,min(100,horizontal)),max(0,min(100,vertical))


def export_frame(image, preset, width, height, zoom, horizontal, vertical):
    result=frame(image,preset,width,height,zoom,horizontal,vertical)
    if result is None:
        raise gr.Error('トリミングする写真をアップロードしてください。')
    folder=Path(tempfile.mkdtemp(dir='/tmp/photos/exports'))
    path=folder/'trimmed-300dpi.png'
    result.info.pop('exif',None)
    result.save(path,dpi=(300,300))
    return result,str(path),str(path)


def print_layout(image,paper):
    if image is None:
        raise gr.Error('印刷する写真をアップロードしてください。')
    if isinstance(image,str):
        image=Image.open(image)
    # Print at the declared DPI. Standalone uploads without metadata use 300dpi.
    dpi=image.info.get('dpi',(300,300))
    if any(abs(float(value)-300)>.1 for value in dpi):
        raise gr.Error('300dpiの写真を使用してください。「トリミング」から渡すと寸法を保てます。')
    photo=image.convert('RGB')
    height,width=PAPERS[paper]
    margin=round(5/25.4*300);gap=round(3/25.4*300)
    columns=(width-2*margin+gap)//(photo.width+gap)
    rows=(height-2*margin+gap)//(photo.height+gap)
    if columns<1 or rows<1:
        raise gr.Error('写真が用紙に収まりません。大きい用紙を選ぶか、トリミングでサイズを小さくしてください。')
    sheet=Image.new('RGB',(width,height),'white')
    start_x=(width-(columns*photo.width+(columns-1)*gap))//2
    start_y=(height-(rows*photo.height+(rows-1)*gap))//2
    for y in range(rows):
        for x in range(columns):
            sheet.paste(photo,(start_x+x*(photo.width+gap),start_y+y*(photo.height+gap)))
    folder=Path(tempfile.mkdtemp(dir='/tmp/photos/exports'))
    png=folder/'print-layout-300dpi.png';pdf=folder/'print-layout.pdf'
    sheet.save(png,dpi=(300,300))
    sheet.save(pdf,resolution=300,quality=95,subsampling=0)
    note=f'{columns*rows}枚配置しました。写真1枚：約{photo.width/300*25.4:.1f}×{photo.height/300*25.4:.1f}mm。'
    return str(png),str(png),str(pdf),note


def build():
    background_result=gr.State(None,time_to_live=3600)
    crop_result=gr.State(None,time_to_live=3600)
    def move_to_crop(path):
        if not path:raise gr.Error('先に背景を変更してください。元写真はトリミングタブへ直接アップロードできます。')
        return Image.open(path).copy(),gr.update(selected='crop')
    def move_background_to_print(path):
        if not path:raise gr.Error('先に背景を変更してください。')
        return Image.open(path).copy(),gr.update(selected='print')
    def move_to_print(path):
        if not path:raise gr.Error('先に「このサイズで保存」を押してください。')
        return Image.open(path).copy(),gr.update(selected='print')

    gr.Markdown('色を整える。画角を決める。紙にする。', elem_classes=['workflow-intro'])
    with gr.Tabs() as steps:
        with gr.Tab('01  背景変更',id='background'):
            gr.Markdown('### 背景を、好きな色に。
写真を選び、背景色を指定してください。顔や肌色はそのまま残します。')
            with gr.Row():
                with gr.Column():
                    source=gr.Image(type='numpy',sources=['upload'],label='元写真',height=360,format='png')
                    with gr.Row():
                        template=gr.Dropdown(list(COLORS),value='オフホワイト',label='背景色')
                        color=gr.ColorPicker(value='#F5F3EF',label='カラーパレット')
                    template.input(lambda name:COLORS[name],template,color,queue=False)
                    with gr.Accordion('切り抜きの詳細設定',open=False):
                        refine=gr.Checkbox(value=True,label='髪・輪郭を精密に補正')
                        gr.Markdown('補正で輪郭が欠ける場合はOFFにして比較してください。')
                    run=gr.Button('背景を変更',variant='primary')
                with gr.Column():
                    background_preview=gr.Image(label='背景変更の結果',interactive=False,height=360,format='png')
                    with gr.Row():
                        background_file=gr.File(label='背景付きPNG');alpha=gr.File(label='透過PNG')
                    with gr.Row():
                        next_crop=gr.Button('この画像をトリミングへ →')
                        background_print=gr.Button('この画像をそのまま印刷へ →')
                    gr.Markdown('そのまま印刷する場合は、現在のピクセル数を300dpiの寸法として使います。印刷タブで1枚の大きさを確認できます。')
        with gr.Tab('02  トリミング',id='crop'):
            gr.Markdown('### ちょうどいい、一枚に。
用途に合うサイズを選び、右のプレビューで位置を調整します。元写真も直接使えます。')
            with gr.Row():
                with gr.Column():
                    crop_source=gr.Image(type='pil',sources=['upload'],label='トリミングする写真',height=360,format='png')
                    preset=gr.Dropdown(list(SIZES),value=list(SIZES)[0],label='写真のサイズ')
                    with gr.Row(visible=False) as custom:
                        width=gr.Number(value=30,minimum=9,maximum=152,label='幅（mm）')
                        height=gr.Number(value=40,minimum=9,maximum=152,label='高さ（mm）')
                    passport_note=gr.Markdown('米国提出用は白／オフホワイト背景で撮影した元写真を直接アップロードしてください。背景変更・美肌補正は公式に認められていません。出力は600×600px・300dpi（50.8×50.8mm）。頭の高さ25〜35mmを印刷後に確認し、写真用紙へ100%で印刷してください。',visible=False)
                    preset.change(lambda name: (gr.update(visible=name=='カスタムサイズ'),gr.update(visible=name==US_SIZE)),preset,[custom,passport_note],queue=False)
                    zoom=gr.Slider(10,100,value=100,step=1,label='写る範囲（小さくすると拡大）')
                    horizontal=gr.Slider(0,100,value=50,step=1,label='横位置（左 → 右）')
                    vertical=gr.Slider(0,100,value=50,step=1,label='縦位置（上 → 下）')
                    with gr.Accordion('顔の自動配置',open=False):
                        center=gr.Button('顔を中央に合わせる')
                        gr.Markdown('配置の目安です。頭頂・あご・肩の位置はプレビューで確認し、必要に応じて調整してください。')
                    save=gr.Button('このサイズで保存',variant='primary')
                with gr.Column():
                    crop_preview=gr.Image(label='トリミングの結果',interactive=False,height=360,format='png')
                    crop_file=gr.File(label='写真PNG・300dpi')
                    next_print=gr.Button('この写真を印刷へ →')
            controls=[crop_source,preset,width,height,zoom,horizontal,vertical]
            gr.on([crop_source.change,preset.change,width.change,height.change,zoom.change,horizontal.change,vertical.change],lambda *args: (frame(*args),None,None),controls,[crop_preview,crop_result,crop_file],show_progress='hidden')
            center.click(center_face,[crop_source,preset,width,height],[zoom,horizontal,vertical])
            save.click(export_frame,controls,[crop_preview,crop_file,crop_result])
        with gr.Tab('03  印刷',id='print'):
            gr.Markdown('### 写真を並べて、印刷へ。
用紙を選ぶだけで、実寸を保った印刷用PDFとPNGを作成します。')
            with gr.Row():
                with gr.Column():
                    print_source=gr.Image(type='pil',sources=['upload'],label='印刷する写真',height=300,format='png')
                    paper=gr.Dropdown(list(PAPERS),value=list(PAPERS)[0],label='印刷用紙')
                    layout=gr.Button('印刷レイアウトを作成',variant='primary')
                with gr.Column():
                    layout_preview=gr.Image(label='印刷プレビュー',interactive=False,height=360,format='png')
                    note=gr.Markdown()
                    with gr.Row():
                        layout_file=gr.File(label='印刷PNG');pdf=gr.File(label='印刷PDF')
            layout.click(print_layout,[print_source,paper],[layout_preview,layout_file,pdf,note])
            gr.Markdown('実際のサイズ／100%で印刷してください。用紙に合わせる・自動拡大はOFF。提出先の要件と印刷後の実寸も確認してください。')
    run.click(change_background,[source,color,refine],[background_preview,background_file,alpha,background_result])
    next_crop.click(move_to_crop,background_result,[crop_source,steps])
    next_print.click(move_to_print,crop_result,[print_source,steps])
    background_print.click(move_background_to_print,background_result,[print_source,steps])
