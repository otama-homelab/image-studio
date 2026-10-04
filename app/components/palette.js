const names = new Map([['#F5F3EF','オフホワイト'],['#FFFFFF','白'],['#8EC5FF','青'],['#DDDDDD','グレー']]);
function syncPalette() {
  const color = String(props.value || '#F5F3EF').toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) return;
  for (const button of element.querySelectorAll('[data-color]')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === color));
  }
  element.querySelector('.color-name').textContent = names.get(color) || 'カスタム';
  element.querySelector('.hex-value').textContent = color;
  element.querySelector('input[type=color]').value = color;
}
element.addEventListener('click', event => {
  const button = event.target.closest('button[data-color]');
  if (!button || !element.contains(button)) return;
  props.value = button.dataset.color;
  trigger('input');
  requestAnimationFrame(syncPalette);
});
element.addEventListener('input', event => {
  if (!event.target.matches('input[type=color]')) return;
  props.value = event.target.value.toUpperCase();
  trigger('input');
  requestAnimationFrame(syncPalette);
});
watch('value', () => requestAnimationFrame(syncPalette));
syncPalette();
