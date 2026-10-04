function setSplit(value) {
  const split = Math.max(0, Math.min(100, Number(value)));
  element.querySelector('.comparison').style.setProperty('--split', split + '%');
  const slider = element.querySelector('.comparison-slider');
  slider.value = String(split);
  slider.setAttribute('aria-valuetext', `変更前${split}%、変更後${100-split}%`);
}
function syncComparison() {
  const data = props.value;
  const ready = Boolean(data && typeof data.before === 'string' && typeof data.after === 'string' &&
    data.before.startsWith('data:image/jpeg;base64,') && data.after.startsWith('data:image/jpeg;base64,'));
  const stage = element.querySelector('.comparison-stage');
  stage.dataset.ready = String(ready);
  element.querySelector('.comparison-empty').hidden = ready;
  for (const selector of ['.comparison-before','.comparison-after','.comparison-tags','.comparison-line','.comparison-slider']) {
    element.querySelector(selector).hidden = !ready;
  }
  const before = element.querySelector('.comparison-before');
  const after = element.querySelector('.comparison-after');
  if (ready) {
    before.src = data.before;
    after.src = data.after;
    element.querySelector('.preview-size').textContent = `${Number(data.width)} × ${Number(data.height)} px`;
  } else {
    before.removeAttribute('src'); after.removeAttribute('src');
    element.querySelector('.preview-size').textContent = '';
  }
  element.querySelector('.comparison-hint').textContent = ready ? 'バーをドラッグして比較。← → キーでも調整できます。' : '結果ができたら、バーを左右に動かして比較できます';
  setSplit(50);
}
element.addEventListener('input', event => {
  if (event.target.matches('.comparison-slider')) setSplit(event.target.value);
});
watch('value', () => requestAnimationFrame(syncComparison));
syncComparison();
