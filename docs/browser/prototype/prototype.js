'use strict';
const session = new PrototypeSession({operationTracker:PrototypeCropControls.createOperationTracker()});
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles = {start:'どんな一枚にしますか。',background:'背景を、好きな色に。',crop:'ちょうどいい、一枚に。',print:'写真を並べて、印刷へ。'};
const button = (action, text, disabled = false, primary = false) => `<button id="action-${encodeURIComponent(action)}" data-action="${action}" ${disabled ? 'disabled' : ''} ${primary ? 'class="primary"' : ''}>${text}</button>`;
let lastJob = null, dialogAction = null, dialogReturn = null, cropPointer = null;
const view = {comparison:50, transparent:false, zoom:'fit', scrollLeft:0, scrollTop:0};
const dialog = $('dialog');
function announce(error = false) {
  $('announcement').setAttribute('role', error ? 'alert' : 'status');
  $('announcement').textContent = session.message;
}
function confirmAction(title, body, label, action) {
  dialogReturn = document.activeElement;
  $('dialog-title').textContent = title;
  $('dialog-body').innerHTML = body;
  $('dialog-ok').textContent = label;
  dialogAction = action;
  dialog.showModal();
  $('dialog-cancel').focus();
}
$('dialog-cancel').onclick = () => dialog.close();
$('dialog-ok').onclick = () => {
  const action = dialogAction;
  dialog.close();
  if (action) safe(action);
};
dialog.addEventListener('close', () => {
  dialogAction = null;
  const target = dialogReturn?.isConnected ? dialogReturn : $(dialogReturn?.id);
  (target && !target.disabled ? target : $('action-cancel') || $('heading'))?.focus();
});
function safe(action) {
  try { action(); render(); } catch (error) {
    session.message = error.message;
    render();
    announce(true);
  }
}
function navigate(name) {
  location.hash = name === 'start' ? '#/' : `#/${name}`;
}
function route() {
  let name = location.hash.slice(2) || 'start';
  if (!(name in titles)) {
    name = 'start';
    history.replaceState(null, '', '#/');
  }
  session.screen = name;
  render();
  $('heading').focus();
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', event => {
  if (Object.values(session.stages).some(stage => stage.input)) {
    event.preventDefault();
    event.returnValue = '';
  }
});
function numeric(id, label, value, min, max, step = 1, range = false) {
  return `<label for="${id}">${label}<input id="${id}" data-setting="${id}" type="${range ? 'range' : 'number'}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
}
function render() {
  cropPointer?.close(); cropPointer = null;
  const name = session.screen, stage = session.stages[name];
  const focused = document.activeElement?.id;
  if ($('stage')) { view.scrollLeft = $('stage').scrollLeft; view.scrollTop = $('stage').scrollTop; }
  $('gpu').checked = session.gpu;
  $('online').checked = session.online;
  document.querySelectorAll('nav a').forEach(a => {
    if (a.hash === (name === 'start' ? '#/' : `#/${name}`)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('job-region').innerHTML = session.job ? `<section class="status" aria-label="処理中の操作"><strong>${session.job.preparing ? '疑似データを取得中' : '疑似処理中'}</strong><p>疑似経過時間：${session.job.step}秒（所要3秒）</p>${session.job.preparing ? `<progress max="3" value="${session.job.step}" aria-label="疑似取得進捗"></progress><p>${Math.min(session.job.step, 3)}/3段階・実ダウンロードなし</p>` : ''}${button('cancel','処理を中止')}</section>` : '';
  $('recovery-region').innerHTML = recoveryPanel();
  let html = `<h1 id="heading" tabindex="-1">${titles[name]}</h1>`;
  if (!stage) {
    html += '<p>写真はこの端末で処理します。背景変更は初回に処理用データの取得が必要です。</p><div class="cards">';
    for (const [target,label,description] of [['background','背景を変える','人物を切り抜き、色や透過を選ぶ。'],['crop','サイズを整える','背景変更やモデル取得なしで手動調整。'],['print','印刷用に並べる','加工済みの写真から直接用紙を作る。']]) {
      html += `<section class="card"><h2>${label}</h2><p>${description}</p><a href="#/${target}">この目的へ進む</a></section>`;
    }
    html += '</div>';
  } else {
    const settings = stage.settings, valid = session.canSave(name), input = stage.input;
    const staleInput = !!input && !session.key(name);
    html += `<div class="workspace"><section class="panel" aria-labelledby="settings-heading"><h2 id="settings-heading" tabindex="-1">写真と設定</h2><p>${input ? escapeHtml(input.label) : '写真が選ばれていません'}</p><div class="actions">${button('choose',input ? '別のダミー写真にする' : 'ダミー写真を選ぶ')}</div>`;
    if (name === 'background') {
      html += `<label for="color">背景色（hex）<input id="color" type="text" value="${settings.color}" aria-describedby="color-help"></label><p id="color-help" class="hint">#RRGGBBで入力。例：白は#FFFFFF。色変更は疑似alphaを再利用します。</p><label><input id="refine" type="checkbox" ${settings.refine ? 'checked' : ''}>髪・輪郭を精密に補正（採否未確定の疑似操作）</label>${button('start','背景を変更',!input || !!session.job,true)}<p class="hint">モデル取得・推論は実行しません。</p>`;
      html += `<div class="actions">${button('original-crop','元写真をサイズ調整へ',!input)}${button('original-print','元写真を印刷へ',!input)}</div>`;
    }
    if (name === 'crop') {
      html += numeric('width','幅（mm）',settings.width,9,152,.1) + numeric('height','高さ（mm）',settings.height,9,152,.1);
      for (const [key,label,min] of [['range','写る範囲（小さくすると拡大）',10],['x','横位置（左 → 右）',0],['y','縦位置（上 → 下）',0]]) {
        html += numeric(key,label,settings[key],min,100,1,true) + numeric(`${key}-number`,`${label}（数値・%）`,settings[key],min,100);
      }
      html += `<label><input id="guides" type="checkbox" ${settings.guides ? 'checked' : ''}>顔の位置の目安を表示</label>${button('reset','位置と拡大を元に戻す')}<p>出力：${roundEven(settings.width / 25.4 * 300)}×${roundEven(settings.height / 25.4 * 300)}px・300dpi</p>${button('start','このサイズで保存用データを作る',!session.key(name) || !!session.job,true)}<p class="hint">顔自動配置は含みません。ガイドは保存画像に入りません。</p>`;
    }
    if (name === 'print') {
      html += `<label for="paper">印刷用紙<select id="paper">${['A4','L','2L','はがき'].map(p => `<option ${p === settings.paper ? 'selected' : ''}>${p}</option>`).join('')}</select></label><p>疑似入力：354×472px・300dpi相当</p><p>100%／実際のサイズで印刷。「用紙に合わせる」はOFFにし、最初の1枚を定規で確認してください。</p>${button('start','印刷レイアウトを作成',!session.key(name) || !!session.job,true)}<details><summary>レビュー用の入力異常</summary><div class="actions">${button('bad-dpi','非300dpiのダミー入力')}${button('oversized','用紙に収まらないダミー入力')}</div></details>`;
    }
    html += '<p><a class="screenlink" href="#preview-heading" data-focus="preview-heading">プレビューへ</a></p></section><section class="preview" aria-labelledby="preview-heading"><h2 id="preview-heading" tabindex="-1">プレビューと出力</h2>';
    if (staleInput) html += `<div class="error"><strong>元の画像が変更されました</strong><p>旧画像の保存と受渡しはできません。</p>${button('refresh','最新画像を反映')}</div>`;
    if (stage.result && !valid && !staleInput) html += '<p class="error">設定変更前の結果です。最新設定で作成してください。</p>';
    html += `<div class="actions" aria-label="画像の閲覧倍率">${button('view:fit','全体表示',!input)}${button('view:100','等倍',!input)}${button('view:minus','縮小',!input)}${button('view:plus','拡大',!input)}<output id="zoom-label"></output></div><p id="view-help" class="hint">閲覧倍率は保存結果に影響しません。拡大後はスクロールバー・矢印キー・下の方向ボタンで閲覧できます。等倍はダミー図形を最大280×360 CSS pxの枠内に表示します。</p>`;
    if (name === 'print' && valid) html += `<p>${PrototypeCropControls.printLayout(settings.paper).count}枚配置しました。写真1枚：約30.0×40.0mm（疑似固定入力）。</p>`;
    html += `<div class="stage" id="stage" tabindex="0" aria-label="画像プレビューの閲覧領域" aria-describedby="view-help"><div id="preview-frame" class="preview-frame ${name === 'crop' && settings.guides ? 'guides' : ''}">${input ? name === 'print' && valid ? PrototypeCropControls.paperDrawing(settings.paper) : drawing(settings.color,name === 'crop' ? settings : null) : '<p>写真を選ぶとここに表示されます。</p>'}</div></div><div class="actions" aria-label="拡大画像の閲覧">${button('pan:left','左を見る',!input)}${button('pan:right','右を見る',!input)}${button('pan:up','上を見る',!input)}${button('pan:down','下を見る',!input)}</div><p class="hint">図形による疑似表示。設定によるcrop範囲の変化を表しますが、画素・用紙の実寸の受入ではありません。</p>`;
    if (name === 'background' && valid) html += `<label for="comparison">変更前を表示する割合<input id="comparison" type="range" min="0" max="100" value="${view.comparison}"></label><label><input id="transparent" type="checkbox" ${view.transparent ? 'checked' : ''}>透過表示（市松）</label>`;
    if (valid) {
      html += '<p>疑似結果は現在の設定に一致しています。</p><div class="actions">';
      for (const format of name === 'background' ? ['背景付きPNG','透過PNG'] : name === 'crop' ? ['写真PNG・300dpi'] : ['用紙PNG','用紙PDF']) html += button(`save:${format}`,`${format}を保存（${name === 'print' ? format === '用紙PDF' ? '印刷向け・' : '画像・' : ''}疑似）`);
      if (name === 'background') html += button('transfer:crop','この画像をサイズ調整へ') + button('transfer:print','この画像を印刷へ');
      if (name === 'crop') html += button('transfer:print','この写真を印刷へ');
      html += '</div>';
    } else html += '<p>最新の保存用データができると、保存と次工程への操作が表示されます。</p>';
    html += '<a class="screenlink" href="#settings-heading" data-focus="settings-heading">設定へ戻る</a></section></div>';
  }
  $('main').innerHTML = html;
  $('main').setAttribute('aria-busy',String(!!session.activeJob));
  applyZoom();
  bindCropControls();
  if (stage) for (const [key, value] of Object.entries(stage.drafts)) {
    const input = $(`${key}-number`) || $(key);
    if (input) {
      input.value = value; input.setAttribute('aria-invalid','true');
      const errorId = `${input.id}-error`;
      input.setAttribute('aria-describedby',errorId);
      input.insertAdjacentHTML('afterend',`<span id="${errorId}" class="field-error">${key === 'color' ? '#RRGGBBで入力してください。' : `${input.min}〜${input.max}の数値で入力してください。`}</span>`);
    }
  }
  if (name === 'background' && session.canSave(name)) applyComparison();
  // Preserve focus through local updates, without moving it on asynchronous completion.
  if (focused && $(focused)) $(focused).focus();
  else if (focused?.startsWith('action-')) ($('action-start') || $('heading'))?.focus();
  announce();
}
function roundEven(x) {
  const n = Math.floor(x), f = x - n;
  return f < .5 ? n : f > .5 ? n + 1 : n % 2 ? n + 1 : n;
}
function recoveryPanel() {
  const failure = session.failure;
  if (!failure) return '';
  const action = {quota:['recover:cache','保存済みデータを削除（疑似）'],corrupt:['retry','再取得して再試行'],
    offline:['recover:connection','接続を復旧（疑似）'],gpu:['recover:gpu','GPUを復旧（疑似）'],
    download:['retry','取得を再試行'],memory:['retry','解放後に再試行（疑似）'],
    shape:['retry','処理を再試行'],save:['retry','保存用データを再生成'],dpi:['input-crop','この写真をサイズ調整へ'],fit:['input-crop','この写真をサイズ調整へ']}[failure.code];
  return `<section class="error" aria-label="失敗からの復帰"><h2>${{background:'背景編集',crop:'サイズ・配置',print:'印刷配置'}[failure.name]}：次の操作を選べます</h2><p>${escapeHtml(failure.message)}</p><div class="actions">${action ? button(...action) : ''}${failure.name === 'background' ? button('input-crop','元写真をサイズ調整へ') + button('input-print','元写真を印刷へ') : ''}</div><p class="hint">写真と設定は保持しています。復旧・再試行は自動では実行しません。</p></section>`;
}
function applyZoom() {
  const stage = $('stage'), frame = $('preview-frame');
  if (!stage || !frame) return;
  const crop = session.screen === 'crop' ? session.stages.crop.settings : null;
  const paper = session.screen === 'print' && session.canSave('print') ? PrototypeCropControls.printLayout(session.stages.print.settings.paper) : null;
  const aspect = paper ? paper.width/paper.height : crop ? roundEven(crop.width / 25.4 * 300) / roundEven(crop.height / 25.4 * 300) : 280 / 360;
  const width = Math.min(280,360 * aspect), height = width / aspect;
  const factor = view.zoom === 'fit' ? Math.min(stage.clientWidth / width,stage.clientHeight / height) : view.zoom / 100;
  frame.style.width = `${width * factor}px`;
  frame.style.height = `${height * factor}px`;
  $('zoom-label').textContent = view.zoom === 'fit' ? '全体表示' : `${view.zoom}%`;
  stage.scrollLeft = view.scrollLeft; stage.scrollTop = view.scrollTop;
}
window.addEventListener('resize',()=>{cropPointer?.end();applyZoom();});
window.addEventListener('pagehide',()=>{cropPointer?.close();cropPointer=null;});
function bindCropControls() {
  if (session.screen !== 'crop' || !session.key('crop')) return;
  const frame = $('preview-frame');
  frame.classList.add('crop-draggable');
  cropPointer = PrototypeCropControls.bindCropPointer({
    element:frame,
    getCrop:()=>PrototypeCropControls.geometry(session.stages.crop.settings),
    applyCrop:next=>{
      PrototypeCropControls.applyDrag(session,next);
      const settings = session.stages.crop.settings;
      frame.querySelector('svg').setAttribute('viewBox',PrototypeCropControls.viewBox(settings));
      for (const key of ['x','y']) for (const id of [key,`${key}-number`]) $(id).value = id.endsWith('-number') ? settings[key].toFixed(1) : settings[key];
      for (const button of document.querySelectorAll('[data-action^="save:"],[data-action^="transfer:"],#action-start')) button.disabled = true;
    },
    onEnd:()=>render(),
  });
}
function drawing(color = '#d5d8d5',crop = null) {
  let box = [0,0,280,360];
  if (crop) {
    box = PrototypeCropControls.viewBox(crop).split(' ').map(Number);
  }
  return `<svg viewBox="${box.join(' ')}" role="img" aria-label="ダミー人物図形"><rect id="photo-background" width="280" height="360" fill="${/^#[\da-f]{6}$/i.test(color) ? color : '#d5d8d5'}"/><rect id="photo-before" width="0" height="360" fill="#d5d8d5"/><circle cx="140" cy="112" r="55" fill="#9aa19d"/><path d="M38 360v-70c0-72 48-107 102-107s102 35 102 107v70" fill="#737b80"/></svg>`;
}
function applyComparison() {
  $('stage').classList.toggle('transparent',view.transparent);
  $('photo-background').setAttribute('fill',view.transparent ? 'transparent' : session.stages.background.settings.color);
  $('photo-before').setAttribute('width',view.transparent ? 0 : 280 * view.comparison / 100);
}
function execute() {
  session.fault = $('fault').value;
  $('fault').value = '';
  const job = session.start(session.screen);
  lastJob = job;
  for (let second = 1; second <= 3; second++) setTimeout(() => {
    if (session.tick(job.id,job.operationId)) render();
    if (second === 3) {
      const current = session.job?.id === job.id;
      session.finish(job);
      if (current) { render(); announce(!!job.fault); }
    }
  }, second * 1000);
}
function replaceInput(name, label, dpi = 300, oversized = false) {
  const action = () => session.choose(name, label, dpi, oversized);
  if (session.stages[name].input) confirmAction('写真を入れ替えますか？','<p>現在の写真と加工結果を入れ替えます。設定は保持し、手動位置は中央へ戻します。</p>','入れ替える',action);
  else action();
}
function transfer(from, to) {
  const action = () => { session.transfer(from,to); navigate(to); };
  if (session.stages[to].input) confirmAction('編集画像を置き換えますか？','<p>受取先の画像と加工結果を置き換えます。取消では現在の編集を保持します。</p>','置き換える',action);
  else action();
}
document.addEventListener('click', event => {
  const focusLink = event.target.closest('[data-focus]');
  if (focusLink) { event.preventDefault(); $(focusLink.dataset.focus).focus(); $(focusLink.dataset.focus).scrollIntoView(); return; }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  safe(() => {
    const action = target.dataset.action, name = session.screen;
    if (action === 'choose') replaceInput(name, session.stages[name].input?.label === 'ダミー写真A' ? 'ダミー写真B' : 'ダミー写真A');
    if (action === 'cancel') session.cancel();
    if (action.startsWith('view:')) {
      const value = action.slice(5);
      view.zoom = value === 'fit' ? 'fit' : value === '100' ? 100 : Math.max(25,Math.min(400,(typeof view.zoom === 'number' ? view.zoom : 100) + (value === 'plus' ? 25 : -25)));
      view.scrollLeft = 0; view.scrollTop = 0;
      if ($('stage')) { $('stage').scrollLeft = 0; $('stage').scrollTop = 0; }
    }
    if (action.startsWith('pan:')) {
      const direction = action.slice(4);
      $('stage').scrollBy({left:direction === 'left' ? -80 : direction === 'right' ? 80 : 0,top:direction === 'up' ? -80 : direction === 'down' ? 80 : 0});
    }
    if (action === 'retry') {
      const failedStage = session.failure.name;
      session.screen = failedStage; navigate(failedStage); execute();
    }
    if (action.startsWith('recover:')) {
      const kind = action.slice(8), failedStage = session.failure.name;
      const recover = () => { session.recover(kind); session.screen = failedStage; navigate(failedStage); };
      if (kind === 'cache') confirmAction('疑似データを削除しますか？','<p>次回に再取得します。写真と加工結果は保持します。</p>','削除する',recover);
      else recover();
    }
    if (action === 'input-crop' || action === 'input-print') {
      const source = session.failure?.name || name, to = action.slice(6), input = session.stages[source].input;
      const apply = () => { session.choose(to,input.label); session.screen = to; navigate(to); };
      if (session.stages[to].input) confirmAction('編集画像を置き換えますか？','<p>保存できなかった写真を手動サイズ調整・印刷で使用します。</p>','置き換える',apply); else apply();
    }
    if (action === 'start') {
      if (name === 'background' && !session.cache && session.gpu) confirmAction('背景変更の準備','<p>追加取得量：10MiB（レビュー用の架空値）。疑似取得後に疑似処理を続けます。実通信はありません。</p>','取得して処理を始める（疑似）',execute);
      else execute();
    }
    if (action === 'reset') session.change('crop',{range:100,x:50,y:50});
    if (action === 'refresh') session.refresh(name);
    if (action.startsWith('transfer:')) transfer(name,action.split(':')[1]);
    if (action.startsWith('save:')) session.save(name,action.split(':')[1]);
    if (action.startsWith('original-')) {
      const to = action.slice(9), label = session.stages.background.input.label;
      const apply = () => { session.choose(to,label); navigate(to); };
      if (session.stages[to].input) confirmAction('編集画像を置き換えますか？','<p>背景を変更する前の元写真を使います。</p>','置き換える',apply); else apply();
    }
    if (action === 'bad-dpi') replaceInput('print','非300dpiダミー',96);
    if (action === 'oversized') replaceInput('print','大きすぎるダミー',300,true);
  });
});
document.addEventListener('change', event => {
  const target = event.target, name = session.screen;
  safe(() => {
    if (target.id === 'gpu') { session.cancel(); session.gpu = target.checked; session.message = target.checked ? 'GPUを疑似復旧しました。再試行できます。' : '背景変更は利用できません。手動サイズ・印刷を利用できます。'; }
    else if (target.id === 'online') { session.cancel(); session.online = target.checked; session.message = '疑似接続状態を変更しました。実際の通信はありません。'; }
    else if (target.id === 'color') {
      if (!/^#[\da-f]{6}$/i.test(target.value)) { invalidDraft('color',target.value); throw new Error('背景色は#RRGGBBで入力してください。'); }
      session.change('background',{color:target.value.toUpperCase()});
    } else if (target.id === 'refine' || target.id === 'guides') session.change(name,{[target.id]:target.checked});
    else if (target.id === 'paper') session.change('print',{paper:target.value});
    else if (target.dataset.setting) {
      if (target.value === '' || !target.checkValidity()) { invalidDraft(target.dataset.setting.replace('-number',''),target.value); throw new Error('欄に表示された範囲の数値を入力してください。'); }
      session.change(name,{[target.dataset.setting.replace('-number','')]:Number(target.value)});
    }
  });
});
function invalidDraft(key, value) {
  session.cancel();
  session.stages[session.screen].drafts[key] = value;
  render();
}
document.addEventListener('keydown', event => {
  const target = event.target;
  if (!(target.id === 'color' || target.dataset?.setting)) return;
  if (event.key === 'Escape') {
    const stage = session.stages[session.screen];
    delete stage.drafts[target.id.replace('-number','')];
    session.message = '入力を確定済みの値に戻しました。';
    render();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    target.dispatchEvent(new Event('change',{bubbles:true}));
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'comparison') { view.comparison = Number(event.target.value); applyComparison(); }
  if (event.target.id === 'transparent') {
    view.transparent = event.target.checked;
    applyComparison();
  }
});
$('support').onclick = () => confirmAction('処理用データと端末（疑似）',`<p>GPU：${session.gpu ? '利用可' : '利用不可'}。疑似データ：${session.cache ? '保存済み' : '未取得'}。実モデルや写真は取得・保存しません。</p><p>閉じても実行中の疑似処理は続きます。中止は共通通知から操作できます。</p>`,'閉じる',() => {});
$('clear-cache').onclick = () => confirmAction('疑似保存データを削除しますか？','<p>次回は疑似取得から開始します。写真と有効な加工結果は保持します。</p>','削除する',() => { session.cancel(); session.cache = false; session.message = '疑似データを未取得にしました。'; });
$('late').onclick = () => safe(() => {
  const current = lastJob && session.job?.id === lastJob.id;
  const accepted = lastJob && session.finish(lastJob);
  if (accepted) session.message = '現行ジョブの疑似完了を反映しました。';
  else if (!current) session.message = '中止済み・旧設定の遅延完了を破棄しました。';
});
route();
