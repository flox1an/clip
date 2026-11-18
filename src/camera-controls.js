import { html } from './ui.js';
import { icon } from './icons.js';
import { t } from './i18n/index.js';

// Maps a point on the viewfinder (object-fit: cover, optionally mirrored) to 0–1 coordinates in the camera frame.
export function framePoint(x, y, box, frame, mirror) {
  const scale = Math.max(box.width / frame.width, box.height / frame.height);
  const w = frame.width * scale, h = frame.height * scale, clamp = v => Math.min(1, Math.max(0, v));
  const px = clamp((x - box.left - (box.width - w) / 2) / w), py = clamp((y - box.top - (box.height - h) / 2) / h);
  return { x: mirror ? 1 - px : px, y: py };
}

// Gestures on the viewfinder: swipe for looks, tap to focus/meter, pinch to zoom.
// Hardware controls appear only when the camera reports them (mostly Android); otherwise a tap does nothing.
export function cameraControls(root, surface, { frameSize, canSwipe, onSwipe }) {
  const focus = html(`<div class="focus" hidden>
    <span class="focus-ring"></span>
    <label class="exposure">${icon('sun')}<input type="range" aria-label="${t('camera.exposure')}"></label>
  </div>`);
  const zoomLabel = html('<div class="zoom-label" aria-live="polite"></div>');
  root.append(focus, zoomLabel);
  const slider = focus.querySelector('input');
  const pointers = new Map();
  let track = null, mirror = false, focusModes = [], exposure = null, zoom = null, pinch = null, swipe = null, hideTimer, zoomTimer, zoomFrame = 0;

  const apply = constraint => track?.applyConstraints({ advanced: [constraint] }).catch(() => {});
  const hideLater = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { focus.hidden = true; }, 3000); };
  const distance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  function setTrack(next, isMirrored) {
    track = next;
    mirror = isMirrored;
    focus.hidden = true;
    const caps = track?.getCapabilities?.() ?? {}, settings = track?.getSettings?.() ?? {};
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
    focusModes = supported.pointsOfInterest ? (caps.focusMode ?? []).filter(mode => mode === 'single-shot' || mode === 'continuous') : [];
    exposure = caps.exposureCompensation?.max > caps.exposureCompensation?.min ? caps.exposureCompensation : null;
    zoom = caps.zoom?.max > caps.zoom?.min ? caps.zoom : null;
    focus.querySelector('.exposure').hidden = !exposure;
    if (exposure) Object.assign(slider, { min: exposure.min, max: exposure.max, step: exposure.step || 0.1, value: settings.exposureCompensation ?? 0 });
  }

  function tap(x, y) {
    if (!track || (!focusModes.length && !exposure)) return;
    const box = root.getBoundingClientRect();
    // Keep ring and slider on screen near the edges.
    focus.style.left = `${Math.min(box.width - 110, Math.max(44, x - box.left))}px`;
    focus.style.top = `${Math.min(box.height - 90, Math.max(90, y - box.top))}px`;
    focus.hidden = false;
    focus.classList.remove('is-new');
    void focus.offsetWidth; // restart the ring animation
    focus.classList.add('is-new');
    if (focusModes.length) {
      const [width, height] = frameSize();
      if (width && height) apply({ pointsOfInterest: [framePoint(x, y, surface.getBoundingClientRect(), { width, height }, mirror)], focusMode: focusModes.includes('single-shot') ? 'single-shot' : 'continuous' });
    }
    hideLater();
  }

  function setZoom(value) {
    const next = Math.min(zoom.max, Math.max(zoom.min, value));
    cancelAnimationFrame(zoomFrame);
    zoomFrame = requestAnimationFrame(() => apply({ zoom: next }));
    zoomLabel.textContent = `${(next / zoom.min).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`;
    zoomLabel.classList.add('is-visible');
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => zoomLabel.classList.remove('is-visible'), 900);
  }

  slider.oninput = () => { apply({ exposureCompensation: Number(slider.value) }); hideLater(); };

  surface.addEventListener('pointerdown', event => {
    surface.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && zoom) {
      pinch = { distance: distance(), zoom: track.getSettings().zoom ?? zoom.min };
      swipe = null;
    } else if (pointers.size === 1) swipe = { x: event.clientX, y: event.clientY };
  });
  surface.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) setZoom(pinch.zoom * distance() / pinch.distance);
  });
  const end = event => {
    if (!pointers.delete(event.pointerId)) return;
    if (pinch) { if (!pointers.size) pinch = null; return; }
    if (!swipe || event.type === 'pointercancel') return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (canSwipe()) onSwipe(dx < 0 ? 1 : -1); }
    else if (Math.hypot(dx, dy) < 12) tap(event.clientX, event.clientY);
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);

  return { setTrack, destroy() { clearTimeout(hideTimer); clearTimeout(zoomTimer); cancelAnimationFrame(zoomFrame); } };
}
