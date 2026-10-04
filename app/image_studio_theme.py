"""Image Studio's restrained, responsive visual identity."""
import gradio as gr


def theme():
    return gr.themes.Soft(
        primary_hue=gr.themes.colors.emerald,
        secondary_hue=gr.themes.colors.teal,
        neutral_hue=gr.themes.colors.slate,
        font=['Noto Sans JP', 'system-ui', 'sans-serif'],
    ).set(
        body_background_fill='#f4f5f2', body_background_fill_dark='#111b18',
        block_background_fill='#ffffff', block_background_fill_dark='#192722',
        block_border_width='1px', block_radius='18px',
        button_primary_background_fill='#245d49',
        button_primary_background_fill_hover='#184632',
        button_primary_text_color='#ffffff',
        button_large_radius='12px', input_radius='10px',
        block_label_background_fill='#eef1ec', block_label_background_fill_dark='#26372e',
        block_label_text_color='#526058', block_label_text_color_dark='#d5e0d8',
    )


HEADER = '''<header class="studio-header">
  <div class="studio-brand"><span class="studio-mark" aria-hidden="true">◩</span>
    <div><div class="studio-name">Image Studio</div><div class="studio-subtitle">写真を、仕上げる。</div></div>
  </div><span class="studio-badge">あなたの写真の作業室</span>
</header>'''

CSS = '''
.gradio-container { width: 100% !important; min-width: 0 !important; max-width: 1240px !important; margin: auto !important; padding: clamp(12px,3vw,28px) !important; }
.main { min-width: 0 !important; width: 100% !important; }
.studio-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 0 22px; gap: 16px; }
.studio-brand { display: flex; align-items: center; gap: 14px; }
.studio-mark { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; color: #fff; background: #245d49; font-size: 28px; }
.studio-name { font-size: 24px; font-weight: 750; letter-spacing: -.7px; color: var(--body-text-color); }
.studio-subtitle { margin-top: 3px; font-size: 11px; color: var(--body-text-color-subdued); letter-spacing: .1em; }
.studio-badge { color: var(--body-text-color-subdued); font-size: 11px; border: 1px solid var(--border-color-primary); border-radius: 100px; padding: 8px 14px; }
#studio-tools [role=tab] { min-height: 38px; border-radius: 9px !important; font-weight: 650 !important; }
#studio-steps [role=tab] { min-height: 43px; padding: 10px 20px !important; border: 0 !important; border-radius: 10px !important; margin: 4px 4px 8px 0; font-size: 13px !important; }
#studio-steps [role=tab][aria-selected=true] { background: var(--button-primary-background-fill) !important; color: white !important; }
.step-heading { padding: 26px 0 20px; color: var(--body-text-color); }
.step-kicker { color: var(--body-text-color-subdued); font: 10px ui-monospace,monospace; letter-spacing: .16em; }
.step-heading h2 { font-size: clamp(22px,3vw,29px); letter-spacing: -.045em; line-height: 1.4; font-weight: 700; margin: 9px 0; }
.step-heading p { font-size: 12px; color: var(--body-text-color-subdued); line-height: 1.8; margin: 0; }
.studio-workspace { gap: 24px !important; align-items: flex-start !important; }
.studio-controls { box-sizing: border-box; background: var(--block-background-fill) !important; border: 1px solid var(--border-color-primary) !important; border-radius: 20px !important; padding: 20px !important; gap: 18px !important; }
.studio-preview { gap: 14px !important; min-width: 280px !important; }
.panel-title h4 { font-size: 13px !important; margin: 0 !important; font-weight: 650 !important; }
.studio-help { color: var(--body-text-color-subdued); font-size: 11px !important; line-height: 1.8 !important; }
.studio-help p { font-size: 11px !important; }
.studio-primary { min-height: 46px !important; }
.studio-result-actions { background: transparent !important; border: 0 !important; padding: 0 !important; gap: 10px !important; }
.studio-print-note { color: var(--body-text-color-subdued); font-size: 12px; }
#background-source, #crop-source, #print-source { border-radius: 13px !important; }
#crop-preview, #print-preview { background: var(--background-fill-secondary) !important; border-radius: 18px !important; }
button:focus-visible, a:focus-visible { outline: 3px solid #75a891 !important; outline-offset: 3px; }
@media (max-width: 640px) {
 .studio-header { padding-bottom: 14px; }
 .studio-badge { display: none; }
 .studio-controls { padding: 16px !important; }
 .studio-workspace { gap: 20px !important; flex-direction: column !important; }
 .studio-workspace > .studio-controls, .studio-workspace > .studio-preview { width: 100% !important; min-width: 0 !important; flex: auto !important; }
 #studio-steps [role=tab] { padding: 9px 14px !important; }
}
'''
