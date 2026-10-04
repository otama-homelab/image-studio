"""Japanese portrait workflow: background, framing, then print."""
from pathlib import Path
import tempfile
import cv2
import numpy as np
from image_studio_face import head_geometry
import gradio as gr
from PIL import Image
from image_studio_backend import change_background
from image_studio_components import component, comparison_value

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
    background_result = gr.State(None, time_to_live=3600)
    crop_result = gr.State(None, time_to_live=3600)

    def move_to_crop(path):
        if not path:
            raise gr.Error('先に背景を変更してください。元写真もトリミングへ直接アップロードできます。')
        with Image.open(path) as image:
            return image.copy(), gr.update(selected='crop')

    def move_to_print(path):
        if not path:
            raise gr.Error('先に写真を仕上げてください。')
        with Image.open(path) as image:
            return image.copy(), gr.update(selected='print')

    def process_background(image, color, refine):
        preview, photo, alpha, state = change_background(image, color, refine)
        return comparison_value(image, preview), photo, alpha, state, gr.update(visible=True)

    def reset_background():
        return None, None, None, None, gr.update(visible=False)

    def save_crop(*args):
        preview, photo, state = export_frame(*args)
        return preview, photo, state, gr.update(visible=True)

    def update_crop(*args):
        return frame(*args), None, None, gr.update(visible=False)

    def create_layout(image, paper):
        preview, png, pdf, note = print_layout(image, paper)
        return preview, png, pdf, note, gr.update(visible=True)

    def reset_print():
        return None, None, None, '', gr.update(visible=False)

    with gr.Tabs(elem_id='studio-steps') as steps:
        with gr.Tab('背景変更', id='background'):
            gr.HTML('<div class="step-heading"><span class="step-kicker">BACKGROUND · 01</span><h2>背景を、好きな色に。</h2><p>写真と色を選ぶだけ。髪や輪郭を丁寧に残して仕上げます。</p></div>')
            with gr.Row(elem_classes=['studio-workspace']):
                with gr.Column(scale=4, min_width=280, elem_classes=['studio-controls']):
                    gr.Markdown('#### 写真を選ぶ', elem_classes=['panel-title'])
                    source = gr.Image(type='numpy', sources=['upload'], label='元写真', show_label=False,
                                      height=230, placeholder='クリックして写真を選択', format='png', buttons=[], elem_id='background-source')
                    color = component('palette', '#F5F3EF', elem_id='background-palette')
                    with gr.Accordion('切り抜きの詳細設定', open=False):
                        refine = gr.Checkbox(value=True, label='髪・輪郭を精密に補正')
                        gr.Markdown('輪郭が欠ける場合はOFFにして比較できます。肌色や明るさは補正しません。', elem_classes=['studio-help'])
                    run = gr.Button('背景を変更', variant='primary', elem_classes=['studio-primary'])
                with gr.Column(scale=7, min_width=280, elem_classes=['studio-preview']):
                    background_preview = component('comparison', elem_id='background-comparison')
                    with gr.Group(visible=False, elem_classes=['studio-result-actions']) as background_actions:
                        with gr.Row():
                            background_file = gr.DownloadButton('背景付きPNGを保存', elem_id='background-download')
                            alpha = gr.DownloadButton('透過PNGを保存', elem_id='alpha-download')
                        with gr.Row():
                            next_crop = gr.Button('この画像をトリミングへ →')
                            background_print = gr.Button('この画像をそのまま印刷へ →')
                        gr.Markdown('そのまま印刷する場合は、ピクセル数から300dpiの実寸を計算します。', elem_classes=['studio-help'])
            background_outputs = [background_preview, background_file, alpha, background_result, background_actions]
            gr.on([source.input, color.input, refine.input], reset_background, outputs=background_outputs,
                  queue=False, show_progress='hidden')
            run.click(process_background, [source, color, refine], background_outputs)

        with gr.Tab('トリミング', id='crop'):
            gr.HTML('<div class="step-heading"><span class="step-kicker">FRAMING · 02</span><h2>ちょうどいい、一枚に。</h2><p>用途に合うサイズを選び、大きなプレビューで位置を整えます。</p></div>')
            with gr.Row(elem_classes=['studio-workspace']):
                with gr.Column(scale=4, min_width=280, elem_classes=['studio-controls']):
                    crop_source = gr.Image(type='pil', sources=['upload'], label='トリミングする写真',
                                           height=210, placeholder='クリックして写真を選択', format='png', buttons=[], elem_id='crop-source')
                    preset = gr.Dropdown(list(SIZES), value=list(SIZES)[0], label='写真のサイズ')
                    with gr.Row(visible=False) as custom:
                        width = gr.Number(value=30, minimum=9, maximum=152, label='幅（mm）')
                        height = gr.Number(value=40, minimum=9, maximum=152, label='高さ（mm）')
                    passport_note = gr.Markdown('米国提出用は白／オフホワイト背景で撮影した元写真を直接アップロードしてください。背景変更・美肌補正は公式に認められていません。出力は600×600px・300dpi（50.8×50.8mm）。頭の高さ25〜35mmを印刷後に確認し、写真用紙へ100%で印刷してください。', visible=False, elem_classes=['studio-help'])
                    preset.change(lambda name: (gr.update(visible=name == 'カスタムサイズ'), gr.update(visible=name == US_SIZE)),
                                  preset, [custom, passport_note], queue=False)
                    center = gr.Button('顔を中央に合わせる')
                    zoom = gr.Slider(10, 100, value=100, step=1, label='写る範囲（小さくすると拡大）')
                    horizontal = gr.Slider(0, 100, value=50, step=1, label='横位置（左 → 右）')
                    vertical = gr.Slider(0, 100, value=50, step=1, label='縦位置（上 → 下）')
                    gr.Markdown('顔の自動配置は目安です。頭頂・あご・肩の位置を確認してください。', elem_classes=['studio-help'])
                    save = gr.Button('このサイズで保存', variant='primary', elem_classes=['studio-primary'])
                with gr.Column(scale=7, min_width=280, elem_classes=['studio-preview']):
                    gr.Markdown('#### 印刷サイズのプレビュー', elem_classes=['panel-title'])
                    crop_preview = gr.Image(label='トリミングの結果', show_label=False, interactive=False,
                                            height=520, format='png', buttons=['fullscreen'], elem_id='crop-preview')
                    with gr.Group(visible=False, elem_classes=['studio-result-actions']) as crop_actions:
                        crop_file = gr.DownloadButton('写真PNGを保存 · 300dpi', elem_id='crop-download')
                        next_print = gr.Button('この写真を印刷へ →')
            controls = [crop_source, preset, width, height, zoom, horizontal, vertical]
            crop_outputs = [crop_preview, crop_file, crop_result, crop_actions]
            gr.on([crop_source.input, preset.change, width.change, height.change, zoom.change, horizontal.change, vertical.change],
                  update_crop, controls, crop_outputs, show_progress='hidden')
            center.click(center_face, [crop_source, preset, width, height], [zoom, horizontal, vertical])
            save.click(save_crop, controls, crop_outputs)

        with gr.Tab('印刷', id='print'):
            gr.HTML('<div class="step-heading"><span class="step-kicker">PRINT · 03</span><h2>写真を並べて、印刷へ。</h2><p>用紙を選んで、実寸を保ったPDFとPNGを作成します。</p></div>')
            with gr.Row(elem_classes=['studio-workspace']):
                with gr.Column(scale=4, min_width=280, elem_classes=['studio-controls']):
                    print_source = gr.Image(type='pil', sources=['upload'], label='印刷する写真',
                                            height=230, placeholder='クリックして写真を選択', format='png', buttons=[], elem_id='print-source')
                    paper = gr.Dropdown(list(PAPERS), value=list(PAPERS)[0], label='印刷用紙')
                    layout = gr.Button('印刷レイアウトを作成', variant='primary', elem_classes=['studio-primary'])
                    gr.Markdown('**実際のサイズ／100%で印刷**\n\n「用紙に合わせる」「自動拡大」はOFFにしてください。提出先の要件と印刷後の実寸も確認してください。', elem_classes=['studio-help'])
                with gr.Column(scale=7, min_width=280, elem_classes=['studio-preview']):
                    gr.Markdown('#### 用紙のプレビュー', elem_classes=['panel-title'])
                    layout_preview = gr.Image(label='印刷プレビュー', show_label=False, interactive=False,
                                              height=520, format='png', buttons=['fullscreen'], elem_id='print-preview')
                    note = gr.Markdown(elem_classes=['studio-print-note'])
                    with gr.Row(visible=False, elem_classes=['studio-result-actions']) as print_actions:
                        layout_file = gr.DownloadButton('印刷PNGを保存', elem_id='print-download')
                        pdf = gr.DownloadButton('印刷PDFを保存', variant='primary', elem_id='pdf-download')
            print_outputs = [layout_preview, layout_file, pdf, note, print_actions]
            gr.on([print_source.input, paper.change], reset_print, outputs=print_outputs, queue=False, show_progress='hidden')
            layout.click(create_layout, [print_source, paper], print_outputs)

    next_crop.click(move_to_crop, background_result, [crop_source, steps]).then(
        update_crop, [crop_source, preset, width, height, zoom, horizontal, vertical],
        [crop_preview, crop_file, crop_result, crop_actions])
    next_print.click(move_to_print, crop_result, [print_source, steps]).then(
        reset_print, outputs=print_outputs, queue=False)
    background_print.click(move_to_print, background_result, [print_source, steps]).then(
        reset_print, outputs=print_outputs, queue=False)
