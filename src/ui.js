import { t } from './i18n/index.js';

export const html = markup => { const template = document.createElement('template'); template.innerHTML = markup.trim(); return template.content.firstElementChild; };

// Created at load so screen readers already watch it before the first message. Skipped outside a page (unit tests).
const live = globalThis.document && Object.assign(document.createElement('div'), { className: 'toast-region' });
live?.setAttribute('aria-live', 'polite');
if (live) document.body.append(live);
let toastTimer;
export function toast(message, action) {
  clearTimeout(toastTimer);
  live.replaceChildren();
  const box = html('<div class="toast"><span></span></div>');
  box.firstChild.textContent = message;
  if (action) {
    const button = html('<button type="button"></button>');
    button.textContent = action.label;
    button.onclick = () => { live.replaceChildren(); action.run(); };
    box.append(button);
  }
  live.append(box);
  toastTimer = setTimeout(() => live.replaceChildren(), action ? 5000 : 3500);
}
export const clearToast = () => live.replaceChildren();

export function confirmSheet({ title, text, confirm }) {
  return new Promise(resolve => {
    const dialog = html(`<dialog class="sheet" aria-labelledby="sheet-title"><h2 id="sheet-title"></h2><p></p>
      <button type="button" class="sheet-confirm"></button><button type="button" class="sheet-cancel">${t('cancel')}</button></dialog>`);
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = text;
    dialog.querySelector('.sheet-confirm').textContent = confirm;
    dialog.querySelector('.sheet-confirm').onclick = () => dialog.close('ok');
    dialog.querySelector('.sheet-cancel').onclick = () => dialog.close('');
    dialog.onclick = event => { if (event.target === dialog) dialog.close(''); };
    dialog.onclose = () => { resolve(dialog.returnValue === 'ok'); dialog.remove(); };
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function pickFile(accept, multiple, onFiles) {
  const input = html(`<input type="file" accept="${accept}" ${multiple ? 'multiple' : ''} hidden>`);
  input.onchange = () => { if (input.files.length) onFiles([...input.files]); input.remove(); };
  document.body.append(input);
  input.click();
}
