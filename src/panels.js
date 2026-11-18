import { icon } from './icons.js';
import { html } from './ui.js';
import { LOOKS, lookById } from './looks.js';
import { formatDuration } from './trim.js';
import { t } from './i18n/index.js';

// A panel over the lower part of a screen. Tapping the scrim above it or Escape closes it.
function panel(host, kind, label, onClose) {
  const scrim = html('<div class="panel-scrim"></div>');
  const box = html(`<div class="panel ${kind}" role="dialog" aria-label="${label}"></div>`);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    scrim.remove();
    box.remove();
    delete host.dataset.panel;
    onClose?.();
  };
  scrim.onclick = close;
  box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  host.append(scrim, box);
  host.dataset.panel = kind;
  return { box, close };
}
const percent = value => Math.round(value * 100);

const signed = value => `${value > 0 ? '+' : ''}${value}`;

// get() → { title, look, strength, exposure }. onChange(patch, final) fires live while a slider moves
// ({ strength } or { exposure }) and once with final = true on release.
export function openLookPanel(host, { tiles, get, onPick, onChange, onAll, onClose }) {
  const { box, close } = panel(host, 'look-panel', t('filter'), onClose);
  box.innerHTML = `<header class="panel-head"><h2></h2>
      ${onAll ? `<button type="button" class="text-action" data-all>${t('panel.all')}</button>` : ''}
      <button type="button" class="glyph" data-close aria-label="${t('done')}">${icon('check')}</button></header>
    <label class="slider-row" data-row="strength"><span>${t('panel.strength')}</span><input type="range" min="0" max="100" step="1" data-key="strength"><output></output></label>
    <label class="slider-row" data-row="exposure"><span>${t('panel.exposure')}</span><input type="range" min="-100" max="100" step="1" data-key="exposure"><output></output></label>
    <div class="look-strip" role="radiogroup" aria-label="${t('filter')}">${LOOKS.map((look, i) => `<button type="button" role="radio" data-look="${look.id}">
      <span class="look-tile">${tiles[i] ? `<img alt="" src="${tiles[i]}">` : ''}</span><span>${look.name}</span></button>`).join('')}</div>`;
  const show = (input, value) => { input.value = value; input.nextElementSibling.textContent = input.dataset.key === 'exposure' ? signed(value) : value; };
  function sync() {
    const { title, look, strength, exposure } = get();
    box.querySelector('h2').textContent = title;
    box.querySelector('[data-row="strength"]').hidden = look === 'normal';
    box.querySelector('[data-row="exposure"]').hidden = !lookById(look).curve;
    show(box.querySelector('[data-key="strength"]'), percent(strength));
    show(box.querySelector('[data-key="exposure"]'), percent(exposure));
    for (const tile of box.querySelectorAll('[data-look]')) tile.setAttribute('aria-checked', String(tile.dataset.look === look));
  }
  box.onclick = event => {
    const tile = event.target.closest('[data-look]');
    if (tile) { onPick(tile.dataset.look); sync(); return; }
    if (event.target.closest('[data-all]')) { onAll(); sync(); return; }
    if (event.target.closest('[data-close]')) close();
  };
  for (const input of box.querySelectorAll('[data-key]')) {
    const patch = () => ({ [input.dataset.key]: input.value / 100 });
    input.oninput = () => { show(input, Number(input.value)); onChange(patch(), false); };
    input.onchange = () => onChange(patch(), true);
  }
  sync();
  box.querySelector('[aria-checked="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  box.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  return { close, sync };
}

// get() → { track: { name, url, duration, peaks } | null, audio, window, tip }.
// onChange(patch, final) fires live while dragging and once with final = true to commit.
export function openMusicPanel(host, { get, onPick, onRemove, onChange, onClose }) {
  let audition = null;
  const { box, close } = panel(host, 'music-panel', t('music'), () => { audition?.pause(); onClose?.(); });

  function render() {
    audition?.pause();
    audition = null;
    const { track, audio, tip } = get();
    box.innerHTML = `<header class="panel-head"><h2>${t('music')}</h2><button type="button" class="glyph" data-close aria-label="${t('done')}">${icon('check')}</button></header>
      ${track ? `<div class="track-row">
          <button type="button" class="track-play" data-audition aria-label="${t('panel.listen')}">${icon('play')}</button>
          <div class="track-text"><strong></strong><span>${formatDuration(track.duration)}</span></div>
          <button type="button" class="text-action" data-pick>${t('panel.replace')}</button>
          <button type="button" class="glyph is-danger" data-remove aria-label="${t('panel.removeMusic')}">${icon('trash')}</button>
        </div>
        <div class="wave" role="slider" tabindex="0" aria-label="${t('panel.musicStart')}" aria-valuemin="0">
          <div class="wave-bars">${track.peaks.map(p => `<span style="height:${Math.max(6, p * 100)}%"></span>`).join('')}</div>
          <div class="wave-window"></div>
        </div>
        <p class="panel-caption"></p>
        <label class="slider-row"><span>${t('panel.original')}</span><input type="range" min="0" max="100" data-mix="original"><output></output></label>
        <label class="slider-row"><span>${t('music')}</span><input type="range" min="0" max="100" data-mix="music"><output></output></label>`
      : `<button type="button" class="pill primary panel-cta" data-pick>${icon('music')}${t('panel.pickSong')}</button>
        <p class="panel-caption">${t('panel.formats')}</p>`}
      ${tip ? `<p class="panel-caption">${tip}</p>` : ''}`;
    if (track) box.querySelector('.track-text strong').textContent = track.name;
    sync();
    bindWave();
  }
  function sync() {
    const { track, audio, window } = get();
    if (!track) return;
    const span = Math.min(1, window / track.duration), start = audio.musicStart / track.duration;
    const wave = box.querySelector('.wave');
    wave.style.setProperty('--start', `${start * 100}%`);
    wave.style.setProperty('--span', `${span * 100}%`);
    wave.setAttribute('aria-valuemax', String(Math.round(track.duration)));
    wave.setAttribute('aria-valuenow', String(Math.round(audio.musicStart)));
    wave.setAttribute('aria-valuetext', t('panel.startAt', { time: formatDuration(audio.musicStart) }));
    box.querySelector('.wave + .panel-caption').textContent = `${t('panel.startAt', { time: formatDuration(audio.musicStart) })} · ${t('panel.moveSection')}`;
    for (const input of box.querySelectorAll('[data-mix]')) input.value = input.nextElementSibling.textContent = percent(audio[input.dataset.mix]);
  }
  function bindWave() {
    const wave = box.querySelector('.wave');
    if (!wave) return;
    const limit = () => { const { track, window } = get(); return Math.max(0, track.duration - window); };
    wave.onpointerdown = event => {
      const { track, audio } = get(), from = event.clientX, start = audio.musicStart, width = wave.getBoundingClientRect().width;
      let value = start;
      wave.setPointerCapture(event.pointerId);
      wave.onpointermove = e => { value = Math.max(0, Math.min(limit(), start + (e.clientX - from) / width * track.duration)); onChange({ musicStart: value }, false); sync(); };
      wave.onpointerup = wave.onpointercancel = () => { wave.onpointermove = wave.onpointerup = wave.onpointercancel = null; if (value !== start) onChange({ musicStart: value }, true); sync(); };
    };
    wave.onkeydown = event => {
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
      if (!step) return;
      event.preventDefault();
      onChange({ musicStart: Math.max(0, Math.min(limit(), get().audio.musicStart + step)) }, true);
      sync();
    };
  }
  box.addEventListener('input', event => {
    const input = event.target.closest('[data-mix]');
    if (input) { input.nextElementSibling.textContent = input.value; onChange({ [input.dataset.mix]: input.value / 100 }, false); }
  });
  box.addEventListener('change', event => {
    const input = event.target.closest('[data-mix]');
    if (input) onChange({ [input.dataset.mix]: input.value / 100 }, true);
  });
  box.onclick = event => {
    if (event.target.closest('[data-close]')) return close();
    if (event.target.closest('[data-pick]')) return onPick();
    if (event.target.closest('[data-remove]')) return onRemove();
    const play = event.target.closest('[data-audition]');
    if (play) {
      const { track, audio } = get();
      if (audition && !audition.paused) { audition.pause(); } else {
        audition ??= new Audio(track.url);
        audition.currentTime = audio.musicStart;
        audition.onpause = audition.onplay = () => { play.innerHTML = icon(audition.paused ? 'play' : 'pause'); play.setAttribute('aria-label', t(audition.paused ? 'panel.listen' : 'panel.stopListening')); };
        audition.play().catch(() => {});
      }
    }
  };
  render();
  box.querySelector('button')?.focus({ preventScroll: true });
  return { close, render, sync };
}
