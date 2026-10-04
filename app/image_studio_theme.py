"""Image Studio's restrained, responsive visual identity."""
import gradio as gr


def theme():
    return gr.themes.Soft(
        primary_hue=gr.themes.colors.emerald,
        secondary_hue=gr.themes.colors.teal,
        neutral_hue=gr.themes.colors.slate,
        font=[gr.themes.GoogleFont('Noto Sans JP'), 'system-ui', 'sans-serif'],
    ).set(
        body_background_fill='#f4f5f2', body_background_fill_dark='#111b18',
        block_background_fill='#ffffff', block_background_fill_dark='#192722',
        block_border_width='1px', block_radius='18px',
        button_primary_background_fill='#245d49',
        button_primary_background_fill_hover='#184632',
        button_primary_text_color='#ffffff',
        button_large_radius='12px', input_radius='10px',
    )


HEADER = '''<header class="studio-header">
  <div class="studio-brand"><span class="studio-mark" aria-hidden="true">◩</span>
    <div><div class="studio-name">Image Studio</div><div class="studio-subtitle">写真を、仕上げる。</div></div>
  </div><span class="studio-badge">あなたの写真の作業室</span>
</header>'''

CSS = '''
.gradio-container { max-width: 1180px !important; margin: auto !important; padding: 28px 24px 40px !important; }
.studio-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 0 28px; gap: 16px; }
.studio-brand { display: flex; align-items: center; gap: 14px; }
.studio-mark { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 15px; color: #fff; background: #245d49; font-size: 28px; }
.studio-name { font-size: 25px; font-weight: 750; letter-spacing: -.8px; color: var(--body-text-color); }
.studio-subtitle { margin-top: 3px; font-size: 12px; color: var(--body-text-color-subdued); letter-spacing: .12em; }
.studio-badge { color: var(--body-text-color-subdued); font-size: 12px; border: 1px solid var(--border-color-primary); border-radius: 100px; padding: 8px 14px; }
.workflow-intro { color: var(--body-text-color-subdued); padding: 4px 0 16px; }
.tab-nav { gap: 6px; padding-bottom: 10px !important; border-bottom: 1px solid var(--border-color-primary) !important; }
.tab-nav button { border-radius: 10px !important; padding: 11px 18px !important; font-weight: 650 !important; }
.tab-nav button.selected { background: var(--button-primary-background-fill) !important; color: #fff !important; border: 0 !important; }
.tabitem { padding-top: 20px !important; }
h3 { letter-spacing: -.025em; margin-bottom: 8px !important; }
.block { box-shadow: none !important; }
button:focus-visible { outline: 3px solid #5c9b7e !important; outline-offset: 3px; }
@media (max-width: 640px) {
 .gradio-container { padding: 16px 12px 28px !important; }
 .studio-header { padding-bottom: 18px; }
 .studio-name { font-size: 22px; }
 .studio-badge { display: none; }
 .tab-nav button { padding: 10px 12px !important; font-size: 13px !important; }
}
'''
