import './style.css';
import { icon } from './icons.js';
import { html, toast, clearToast, confirmSheet, pickFile } from './ui.js';
import { openCamera, stopStream, createRecorder } from './recorder.js';
import { formatDuration } from './trim.js';
import { probe, thumbnails } from './media.js';
import { exportFilm } from './export.js';
import { createPlayer } from './player.js';
import { LOOKS, lookById, createRenderer, fitCanvas, lookTiles } from './looks.js';
import { readMusic, releaseAudio } from './audio.js';
import { openLookPanel, openMusicPanel } from './panels.js';
import { cameraControls } from './camera-controls.js';
import { SPEEDS, DEFAULT_AUDIO, createProject, addSegment, trimSegment, splitSegment, moveSegment, removeSegment, setSpeed, setLook, setAudio, undo, filmLength, segmentLength } from './project.js';
import { t, formatNumber } from './i18n/index.js';

const MAX_SECONDS = 60, MIN_CLIP = 0.3, HOLD_MS = 350;
const app = document.querySelector('#app');
// Long-press menus (save image/video, copy) on thumbnails, canvases or videos only get in the way of editing.
app.addEventListener('contextmenu', event => event.preventDefault());

let project = createProject(), serial = 0, screen = null;
const sources = new Map(); // sourceId → { blob, url, fit, mirror, hasAudio, width, height, duration, thumbs }
const tracks = new Map(); // musicId → { blob, url, name, duration, peaks }
const settings = { facing: 'environment', speed: 1, timer: 0, look: 'normal', strength: 1, exposure: 0 };
const uid = () => String(++serial);
const remaining = () => MAX_SECONDS - filmLength(project);
const seconds = n => `${formatNumber(n, { maximumFractionDigits: 1, minimumFractionDigits: n < 10 ? 1 : 0 })} s`;
const speedLabel = speed => `${formatNumber(speed)}×`;
const currentTrack = () => tracks.get(project.audio.musicId) ?? null;

// ── Clips & music ────────────────────────────────────────────────────────────

async function addClip(blob, { fit, mirror, speed = 1, look = 'normal', strength = 1, exposure = 0 }) {
  const info = await probe(blob);
  const room = remaining() * speed;
  if (room < MIN_CLIP) throw new RangeError('full');
  const sourceId = uid();
  sources.set(sourceId, { blob, url: URL.createObjectURL(blob), fit, mirror, ...info, thumbs: thumbnails(blob, info.duration) });
  project = addSegment(project, { id: uid(), sourceId, duration: info.duration, end: Math.min(info.duration, room), speed, look, strength, exposure });
  return info.duration > room;
}

async function importFiles(files) {
  const failed = [];
  let shortened = false, full = false;
  for (const file of files) {
    try { shortened = (await addClip(file, { fit: 'contain', mirror: false })) || shortened; }
    catch (error) { error instanceof RangeError ? (full = true) : failed.push(file.name || 'Video'); }
  }
  if (project.segments.length) screen === 'editor' ? editor.reload(true) : showEditor();
  if (failed.length) toast(t('import.unreadable', { names: failed.join(', ') }));
  else if (full || shortened) toast(t('import.tooLong', { max: MAX_SECONDS }));
}
const pickFiles = () => pickFile('video/*', true, importFiles);

// Resolves with the new audio settings, or null when the file cannot be read.
function pickMusic(defaults) {
  return new Promise(resolve => pickFile('audio/*', false, async ([file]) => {
    try {
      const info = await readMusic(file);
      const musicId = uid();
      tracks.set(musicId, { blob: file, url: URL.createObjectURL(file), name: file.name.replace(/\.[^.]+$/, '') || 'Song', ...info });
      resolve({ ...defaults, musicId, musicStart: 0 });
    } catch {
      toast(t('music.unreadable'));
      resolve(null);
    }
  }));
}

function resetProject() {
  for (const source of sources.values()) { URL.revokeObjectURL(source.url); source.thumbs.then(urls => urls.forEach(URL.revokeObjectURL)); }
  for (const track of tracks.values()) URL.revokeObjectURL(track.url);
  sources.clear();
  tracks.clear();
  project = createProject();
}

function leave() {
  camera.close();
  editor.close();
  result.close();
  clearToast();
}

// ── Camera ───────────────────────────────────────────────────────────────────

const camera = (() => {
  let root, stream, recorder, renderer, controls, panel, monitor, recording = false, saving = false, startedAt = 0, frame = 0, pressAt = 0, countdown = null, opening = 0, mirror = true, nameTimer;
  const $ = selector => root.querySelector(selector);

  function show() {
    leave();
    releaseAudio();
    screen = 'camera';
    root = html(`<section class="screen camera" aria-label="${t('camera')}">
      <video class="camera-source" muted playsinline autoplay aria-hidden="true"></video>
      <canvas class="viewfinder" aria-hidden="true"></canvas>
      <div class="camera-message" hidden>${icon('camera')}<h2>${t('camera.unavailable')}</h2><p></p><button type="button" class="pill" data-action="retry">${t('camera.retry')}</button></div>
      <div class="countdown" aria-live="assertive"></div>
      <div class="look-name" aria-live="polite"></div>
      <header class="camera-top">
        <div class="takes" role="progressbar" aria-label="${t('camera.length')}" aria-valuemin="0" aria-valuemax="${MAX_SECONDS}"></div>
        <div class="camera-bar">
          <button type="button" class="glyph" data-action="restart" aria-label="${t('camera.restart')}">${icon('close')}</button>
          <button type="button" class="music-pill" data-action="music">${icon('music')}<span></span></button>
          <span class="clock" aria-hidden="true"></span>
        </div>
      </header>
      <div class="rail">
        <button type="button" data-action="flip">${icon('flip')}<span>${t('camera.flip')}</span></button>
        <button type="button" data-action="speed" aria-expanded="false">${icon('speed')}<span>${t('speed')}</span></button>
        <button type="button" data-action="look">${icon('filter')}<span>${t('filter')}</span></button>
        <button type="button" data-action="timer">${icon('timer')}<span>${t('timer')}</span></button>
      </div>
      <div class="speed-picker" role="radiogroup" aria-label="${t('camera.recordSpeed')}" hidden>
        ${SPEEDS.map(s => `<button type="button" role="radio" data-speed="${s}">${speedLabel(s)}</button>`).join('')}
      </div>
      <footer class="camera-bottom">
        <button type="button" class="upload" data-action="upload"><span class="upload-tile">${icon('gallery')}</span><span>${t('camera.upload')}</span></button>
        <button type="button" class="shutter" aria-label="${t('camera.record')}"><span></span></button>
        <div class="take-actions">
          <button type="button" class="glyph" data-action="delete-last" aria-label="${t('camera.deleteLast')}">${icon('backspace')}</button>
          <button type="button" class="done" data-action="done" aria-label="${t('camera.toEditor')}">${icon('check')}</button>
        </div>
        <p class="shutter-hint">${t('camera.hint')}</p>
      </footer>
      <span class="sr-only" role="status"></span>
    </section>`);
    app.replaceChildren(root);
    renderer = createRenderer($('.viewfinder'));
    paintLoop();
    const shutter = $('.shutter');
    shutter.onpointerdown = event => {
      if (event.button) return;
      pressAt = performance.now();
      if (recording) return stopTake();
      if (countdown) return cancelCountdown();
      settings.timer ? startCountdown() : startTake();
    };
    shutter.onpointerup = shutter.onpointercancel = () => { if (recording && performance.now() - pressAt > HOLD_MS && performance.now() - startedAt > HOLD_MS) stopTake(); };
    shutter.onclick = event => { if (event.detail === 0) recording ? stopTake() : countdown ? cancelCountdown() : settings.timer ? startCountdown() : startTake(); };
    shutter.oncontextmenu = event => event.preventDefault();
    controls = cameraControls(root, $('.viewfinder'), {
      frameSize: () => [$('.camera-source').videoWidth, $('.camera-source').videoHeight],
      canSwipe: () => !recording && !countdown,
      onSwipe: step => { const i = LOOKS.findIndex(look => look.id === settings.look); setCameraLook(LOOKS[(i + step + LOOKS.length) % LOOKS.length].id); },
    });
    root.onclick = event => {
      const speed = event.target.closest('[data-speed]');
      if (speed) { settings.speed = Number(speed.dataset.speed); $('.speed-picker').hidden = true; return update(); }
      const action = event.target.closest('[data-action]')?.dataset.action;
      ({ retry: open, flip, speed: toggleSpeed, look: openLooks, music: openMusic, timer: cycleTimer, upload: pickFiles, 'delete-last': deleteLast, restart, done: () => showEditor() })[action]?.();
    };
    update();
    open();
  }

  function paint() {
    const video = $('.camera-source');
    fitCanvas($('.viewfinder'));
    renderer.draw(video, { width: video.videoWidth, height: video.videoHeight, fit: 'cover', mirror, look: settings.look, strength: settings.strength, exposure: settings.exposure, time: performance.now() / 1000 });
  }
  function paintLoop() {
    if (!root) return;
    paint();
    const video = $('.camera-source');
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(paintLoop) : requestAnimationFrame(paintLoop);
  }

  async function open(avoidDeviceId) {
    const token = ++opening;
    stopStream(stream);
    stream = null;
    controls.setTrack(null);
    update();
    try {
      const next = await openCamera(settings.facing, { avoidDeviceId });
      if (token !== opening) return stopStream(next);
      stream = next;
      const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
      mirror = facing ? facing === 'user' : settings.facing === 'user';
      $('.camera-source').srcObject = stream;
      controls.setTrack(stream.getVideoTracks()[0], mirror);
      $('.camera-message').hidden = true;
    } catch (error) {
      if (token !== opening) return;
      $('.camera-message p').textContent = t(error.name === 'NotAllowedError' ? 'camera.denied' : 'camera.failed');
      $('.camera-message').hidden = false;
    }
    update();
  }

  function update() {
    if (!root) return;
    const used = filmLength(project), take = recording ? (performance.now() - startedAt) / 1000 / settings.speed : 0, takes = project.segments.length;
    root.dataset.state = recording ? 'recording' : countdown ? 'countdown' : saving ? 'saving' : 'idle';
    root.toggleAttribute('data-takes', takes > 0);
    const bar = $('.takes');
    bar.replaceChildren(...project.segments.map(s => Object.assign(document.createElement('span'), { style: `width:${segmentLength(s) / MAX_SECONDS * 100}%` })));
    if (recording) bar.append(Object.assign(document.createElement('span'), { className: 'is-live', style: `width:${take / MAX_SECONDS * 100}%` }));
    bar.setAttribute('aria-valuenow', Math.round(used + take));
    bar.setAttribute('aria-valuetext', t('camera.lengthValue', { used: formatDuration(used + take), max: formatDuration(MAX_SECONDS) }));
    $('.clock').textContent = formatDuration(used + take);
    $('.shutter').disabled = !stream || saving || remaining() < MIN_CLIP;
    $('.shutter').setAttribute('aria-label', t(recording ? 'camera.stop' : countdown ? 'camera.cancelCountdown' : 'camera.record'));
    $('[data-action="flip"]').disabled = !stream;
    const track = currentTrack();
    $('.music-pill span').textContent = track ? track.name : t('music.add');
    $('.music-pill').classList.toggle('is-on', Boolean(track));
    $('[data-action="speed"] span').textContent = settings.speed === 1 ? t('speed') : speedLabel(settings.speed);
    $('[data-action="speed"]').classList.toggle('is-on', settings.speed !== 1);
    $('[data-action="speed"]').setAttribute('aria-expanded', String(!$('.speed-picker').hidden));
    $('[data-action="look"] span').textContent = settings.look === 'normal' ? t('filter') : lookById(settings.look).name;
    $('[data-action="look"]').classList.toggle('is-on', settings.look !== 'normal');
    $('[data-action="timer"] span').textContent = settings.timer ? `${settings.timer} s` : t('timer');
    $('[data-action="timer"]').classList.toggle('is-on', settings.timer > 0);
    for (const chip of root.querySelectorAll('[data-speed]')) chip.setAttribute('aria-checked', String(Number(chip.dataset.speed) === settings.speed));
  }

  function loop() {
    update();
    if (remaining() - (performance.now() - startedAt) / 1000 / settings.speed <= 0) return stopTake();
    frame = requestAnimationFrame(loop);
  }

  // The song continues where the previous take stopped; slowed for fast takes so it matches after speed-up.
  function monitorFor(track) {
    if (monitor?.dataset.url !== track.url) {
      monitor?.pause();
      monitor = new Audio(track.url);
      monitor.dataset.url = track.url;
      monitor.preservesPitch = true;
    }
    return monitor;
  }
  function startMusic() {
    const track = currentTrack(), at = project.audio.musicStart + filmLength(project);
    if (!track || at >= track.duration) return;
    const music = monitorFor(track);
    music.currentTime = at;
    music.playbackRate = 1 / settings.speed;
    music.play().catch(() => {});
  }

  function startTake() {
    if (!stream || recording || saving || remaining() < MIN_CLIP) return;
    try { recorder = createRecorder(stream); recorder.start(); }
    catch { return toast(t('camera.startFailed')); }
    recording = true;
    startedAt = performance.now();
    panel?.close();
    startMusic();
    $('.speed-picker').hidden = true;
    $('[role="status"]').textContent = t('camera.recording');
    navigator.vibrate?.(12);
    loop();
  }

  async function stopTake() {
    if (!recording) return;
    recording = false;
    saving = true;
    monitor?.pause();
    cancelAnimationFrame(frame);
    update();
    try {
      await addClip(await recorder.stop(), { fit: 'cover', mirror, speed: settings.speed, look: settings.look, strength: settings.strength, exposure: settings.exposure });
      $('[role="status"]').textContent = t('camera.saved', { n: project.segments.length });
    } catch {
      if (root) toast(t('camera.saveFailed'));
    }
    saving = false;
    update();
    if (screen === 'camera' && remaining() < MIN_CLIP) showEditor();
  }

  function startCountdown() {
    if (!stream || saving || remaining() < MIN_CLIP) return;
    const track = currentTrack();
    if (track) { const music = monitorFor(track); music.play().then(() => { if (!recording) music.pause(); }, () => {}); } // unlock inside the tap
    let left = settings.timer;
    const tick = () => {
      if (!left) { countdown = null; $('.countdown').textContent = ''; return startTake(); }
      $('.countdown').textContent = left--;
      countdown = setTimeout(tick, 1000);
    };
    $('.speed-picker').hidden = true;
    panel?.close();
    tick();
    update();
  }
  function cancelCountdown() { clearTimeout(countdown); countdown = null; $('.countdown').textContent = ''; update(); }

  function flip() {
    const current = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    settings.facing = settings.facing === 'user' ? 'environment' : 'user';
    open(current);
  }
  function toggleSpeed() { $('.speed-picker').hidden = !$('.speed-picker').hidden; update(); }
  function cycleTimer() {
    settings.timer = { 0: 3, 3: 10, 10: 0 }[settings.timer];
    update();
    toast(settings.timer ? t('camera.timerOn', { n: settings.timer }) : t('camera.timerOff'));
  }

  function setCameraLook(id) {
    if (id !== settings.look) Object.assign(settings, { strength: 1, exposure: 0 });
    settings.look = id;
    update();
    const name = $('.look-name');
    name.textContent = lookById(id).name;
    name.classList.add('is-visible');
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => name.classList.remove('is-visible'), 1100);
  }
  function openLooks() {
    const video = $('.camera-source');
    $('.speed-picker').hidden = true;
    panel = openLookPanel(root, {
      tiles: lookTiles(video, { width: video.videoWidth, height: video.videoHeight, fit: 'cover', mirror }),
      get: () => ({ title: t('filter'), look: settings.look, strength: settings.strength, exposure: settings.exposure }),
      onPick: setCameraLook,
      onChange: patch => Object.assign(settings, patch),
      onClose: () => { panel = null; root?.querySelector('[data-action="look"]')?.focus(); },
    });
  }

  async function openMusic() {
    $('.speed-picker').hidden = true;
    if (!currentTrack()) {
      const audio = await pickMusic({ original: 0.3, music: 1 });
      if (!audio || !root) return;
      project = setAudio(project, audio);
      update();
    }
    let pending = {};
    panel = openMusicPanel(root, {
      get: () => ({ track: currentTrack(), audio: { ...project.audio, ...pending }, window: Math.max(15, filmLength(project)), tip: t('camera.musicTip') }),
      onPick: async () => { const audio = await pickMusic({ original: project.audio.musicId ? project.audio.original : 0.3, music: project.audio.music }); if (audio) { project = setAudio(project, audio); update(); panel?.render(); } },
      onRemove: () => { project = setAudio(project, DEFAULT_AUDIO); monitor?.pause(); update(); panel.render(); },
      onChange: (patch, final) => { pending = { ...pending, ...patch }; if (final) { project = setAudio(project, pending); pending = {}; } },
      onClose: () => { panel = null; root?.querySelector('[data-action="music"]')?.focus(); },
    });
  }

  async function deleteLast() {
    const last = project.segments.at(-1);
    if (!last) return;
    root.querySelector('.takes span:last-child')?.classList.add('is-doomed');
    if (await confirmSheet({ title: t('camera.deleteLastTitle'), text: t('camera.deleteLastText', { length: seconds(segmentLength(last)) }), confirm: t('delete') })) project = removeSegment(project, last.id);
    update();
  }
  async function restart() {
    if (!project.segments.length) return;
    if (await confirmSheet({ title: t('camera.restartTitle'), text: t('camera.restartText'), confirm: t('discard') })) resetProject();
    update();
  }

  return {
    show,
    get active() { return screen === 'camera'; },
    close() {
      if (!root) return;
      if (recording) stopTake();
      clearTimeout(countdown);
      countdown = null;
      cancelAnimationFrame(frame);
      opening++;
      stopStream(stream);
      stream = null;
      monitor?.pause();
      monitor = null;
      renderer.destroy();
      controls.destroy();
      root = null;
    },
    suspend() { if (recording) stopTake(); opening++; stopStream(stream); stream = null; update(); },
    resume: () => open(),
    get busy() { return recording || saving; },
  };
})();

// ── Editor ───────────────────────────────────────────────────────────────────

const editor = (() => {
  let root, player, panel, head = null, picker = false;
  const $ = selector => root.querySelector(selector);
  const active = () => project.segments.find(s => s.id === project.activeId) ?? project.segments[0];

  function show() {
    leave();
    screen = 'editor';
    if (!project.segments.length) return camera.show();
    // The film plays from its beginning; the last-recorded clip was only selected because it was added last.
    project.activeId = project.segments[0].id;
    head = null;
    picker = false;
    root = html(`<section class="screen editor" aria-label="${t('editor')}">
      <header class="editor-top">
        <button type="button" class="glyph" data-action="camera" aria-label="${t('editor.moreClips')}">${icon('back')}</button>
        <button type="button" class="glyph" data-action="undo" aria-label="${t('editor.undo')}">${icon('undo')}</button>
        <button type="button" class="music-pill" data-action="music">${icon('music')}<span></span></button>
        <button type="button" class="pill primary" data-action="next">${t('editor.next')}</button>
      </header>
      <div class="stage-wrap"><div class="stage" role="button" tabindex="0" aria-label="${t('editor.play')}">
        <span class="stage-play">${icon('play')}</span><span class="stage-time"></span>
      </div></div>
      <div class="timeline">
        <div class="clips" role="listbox" aria-label="${t('editor.clips')}" aria-orientation="horizontal"></div>
        <div class="trim-label"><strong></strong><span>${t('editor.trimHint')}</span></div>
        <div class="trim"><div class="trim-track">
          <div class="trim-frames"></div>
          <div class="trim-shade is-start"></div><div class="trim-shade is-end"></div>
          <div class="trim-window"></div>
          <div class="trim-head"></div>
          <div class="trim-handle is-start" role="slider" tabindex="0" aria-label="${t('editor.trimStart')}"></div>
          <div class="trim-handle is-end" role="slider" tabindex="0" aria-label="${t('editor.trimEnd')}"></div>
        </div></div>
      </div>
      <nav class="tools" aria-label="${t('editor.tools')}">
        <button type="button" data-action="split">${icon('split')}<span>${t('editor.split')}</span></button>
        <button type="button" data-action="speed" aria-expanded="false">${icon('speed')}<span>${t('speed')}</span></button>
        <button type="button" data-action="look">${icon('filter')}<span>${t('filter')}</span></button>
        <button type="button" data-action="earlier">${icon('left')}<span>${t('editor.earlier')}</span></button>
        <button type="button" data-action="later">${icon('right')}<span>${t('editor.later')}</span></button>
        <button type="button" data-action="delete" class="is-danger">${icon('trash')}<span>${t('delete')}</span></button>
      </nav>
      <div class="speed-picker" role="radiogroup" aria-label="${t('editor.clipSpeed')}" hidden>
        ${SPEEDS.map(s => `<button type="button" role="radio" data-speed="${s}">${speedLabel(s)}</button>`).join('')}
      </div>
    </section>`);
    app.replaceChildren(root);
    const stage = $('.stage');
    player = createPlayer(stage, sources, {
      onTime: time => {
        $('.stage-time').textContent = `${formatDuration(time)} / ${formatDuration(filmLength(project))}`;
        if (player?.playing && player.shown) { head = player.shown.currentTime; placeHead(active()); }
      },
      onSegment: id => { if (player?.playing && id !== project.activeId) { project.activeId = id; refresh(); } },
      onPlayState: playing => { stage.classList.toggle('is-playing', playing); stage.setAttribute('aria-label', t(playing ? 'editor.pause' : 'editor.play')); },
    });
    player.load(project.segments);
    player.setAudio(project.audio, currentTrack());
    player.seekSegment(project.activeId);
    player.unlock();
    // Unlocking inside this tap lets iOS continue with sound when playback crosses into another file.
    stage.onclick = () => { if (player.playing) return player.pause(); player.unlock(); player.play(); };
    stage.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); stage.click(); } };
    document.addEventListener('keydown', onSpace, true);
    document.addEventListener('keyup', swallowSpace, true);
    root.addEventListener('click', onAction);
    bindTrim();
    refresh();
  }
  // Space plays and pauses like in any video editor, even while a tool button has focus (it would otherwise
  // repeat that button, e.g. delete another clip). Panels and dialogs keep their own keys.
  const isSpace = event => event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
  const spaceIsOurs = () => root && !panel && !document.querySelector('dialog[open]') && !root.querySelector('.exporting');
  function onSpace(event) {
    if (!isSpace(event) || !spaceIsOurs()) return;
    event.preventDefault();
    if (!event.repeat) root.querySelector('.stage').click();
  }
  function swallowSpace(event) { if (isSpace(event) && spaceIsOurs()) event.preventDefault(); }

  function onAction(event) {
    const chip = event.target.closest('[data-speed]');
    if (chip) return changeSpeed(Number(chip.dataset.speed));
    const clip = event.target.closest('[data-clip]');
    if (clip) return select(clip.dataset.clip);
    const action = event.target.closest('[data-action]')?.dataset.action;
    ({ camera: () => camera.show(), undo: undoEdit, next: () => exportVideo(), add: pickFiles, split, speed: togglePicker, look: openLooks, music: openMusic, earlier: () => move(-1), later: () => move(1), delete: remove })[action]?.();
  }

  function commit(next, message) {
    project = next;
    if (!project.segments.length) { camera.show(); return; }
    player.load(project.segments);
    refresh();
    if (message) toast(message, { label: t('editor.undo'), run: undoEdit });
  }
  function undoEdit() {
    if (!project.history.length) return;
    player.pause();
    project = undo(project);
    if (screen !== 'editor') return;
    if (!project.segments.length) return camera.show();
    head = null;
    player.load(project.segments);
    player.seekSegment(active().id);
    refresh();
  }
  function select(id) {
    project.activeId = id;
    head = null;
    picker = false;
    player.pause();
    player.seekSegment(id);
    refresh();
    root.querySelector(`[data-clip="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function refresh(scrollToEnd) {
    if (!root) return;
    const segment = active(), index = project.segments.indexOf(segment), count = project.segments.length;
    $('[data-action="undo"]').disabled = !project.history.length;
    $('.stage-time').textContent = `${formatDuration(player.time())} / ${formatDuration(filmLength(project))}`;
    player.setAudio(project.audio, currentTrack());
    const track = currentTrack();
    $('.music-pill span').textContent = track ? track.name : t('music');
    $('.music-pill').classList.toggle('is-on', Boolean(track));

    const clips = $('.clips');
    clips.replaceChildren(...project.segments.map((s, i) => {
      const tile = html(`<button type="button" class="clip" role="option" data-clip="${s.id}"><span class="clip-length"></span></button>`);
      tile.setAttribute('aria-selected', String(s.id === segment.id));
      tile.setAttribute('aria-label', `${t('editor.clip', { n: i + 1, length: seconds(segmentLength(s)) })}${s.speed !== 1 ? `, ${speedLabel(s.speed)}` : ''}`);
      tile.firstChild.textContent = seconds(segmentLength(s));
      const source = sources.get(s.sourceId);
      source.thumbs.then(urls => {
        if (!urls.length) return;
        const img = html(`<img alt="" class="${source.mirror ? 'is-mirrored' : ''}">`);
        img.src = urls[Math.min(urls.length - 1, Math.floor(s.start / source.duration * urls.length))];
        tile.prepend(img);
      });
      return tile;
    }), html(`<button type="button" class="clip clip-add" data-action="add" aria-label="${t('editor.addFromGallery')}" ${remaining() < MIN_CLIP ? 'disabled' : ''}>${icon('plus')}</button>`));
    if (scrollToEnd) clips.scrollLeft = clips.scrollWidth;

    $('.trim-label strong').textContent = `${t('editor.clipOf', { n: index + 1, count })} · ${seconds(segmentLength(segment))}${segment.speed !== 1 ? ` · ${speedLabel(segment.speed)}` : ''}`;
    const source = sources.get(segment.sourceId), frames = $('.trim-frames');
    frames.replaceChildren();
    frames.dataset.source = segment.sourceId;
    source.thumbs.then(urls => {
      if (frames.dataset.source !== segment.sourceId) return;
      frames.replaceChildren(...urls.map(url => Object.assign(html(`<img alt="" class="${source.mirror ? 'is-mirrored' : ''}">`), { src: url })));
    });
    placeTrim(segment.start, segment.end, segment);
    placeHead(segment);

    $('[data-action="split"]').disabled = !canSplit(segment);
    $('[data-action="earlier"]').disabled = index === 0;
    $('[data-action="later"]').disabled = index === count - 1;
    $('[data-action="speed"] span').textContent = segment.speed === 1 ? t('speed') : speedLabel(segment.speed);
    $('[data-action="speed"]').classList.toggle('is-on', segment.speed !== 1);
    $('[data-action="speed"]').setAttribute('aria-expanded', String(picker));
    $('.speed-picker').hidden = !picker;
    $('.tools').hidden = picker;
    for (const chip of root.querySelectorAll('[data-speed]')) chip.setAttribute('aria-checked', String(Number(chip.dataset.speed) === segment.speed));
    $('[data-action="look"] span').textContent = segment.look === 'normal' ? t('filter') : lookById(segment.look).name;
    $('[data-action="look"]').classList.toggle('is-on', segment.look !== 'normal');
  }

  const pct = (t, segment) => `${t / segment.duration * 100}%`;
  function placeTrim(start, end, segment) {
    const trim = $('.trim');
    trim.style.setProperty('--start', pct(start, segment));
    trim.style.setProperty('--end', pct(end, segment));
    for (const [handle, value, key] of [[$('.trim-handle.is-start'), start, 'editor.startAt'], [$('.trim-handle.is-end'), end, 'editor.endAt']]) {
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', segment.duration.toFixed(1));
      handle.setAttribute('aria-valuenow', value.toFixed(1));
      handle.setAttribute('aria-valuetext', t(key, { time: seconds(value) }));
    }
  }
  function placeHead(segment) {
    const visible = head !== null && head >= segment.start && head <= segment.end;
    $('.trim-head').hidden = !visible;
    if (visible) $('.trim').style.setProperty('--head', pct(head, segment));
    $('[data-action="split"]').disabled = !canSplit(segment);
  }
  const canSplit = segment => head !== null && head > segment.start + MIN_CLIP && head < segment.end - MIN_CLIP;

  function bindTrim() {
    const trim = $('.trim');
    const timeAt = (event, segment) => {
      const rect = $('.trim-frames').getBoundingClientRect();
      return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * segment.duration;
    };
    trim.onpointerdown = event => {
      const segment = active(), handle = event.target.closest('.trim-handle');
      const kind = handle ? (handle.classList.contains('is-start') ? 'start' : 'end') : 'head';
      let { start, end } = segment;
      trim.setPointerCapture(event.pointerId);
      trim.classList.add('is-dragging');
      const move = e => {
        const t = timeAt(e, segment);
        if (kind === 'start') start = Math.min(t, end - MIN_CLIP);
        else if (kind === 'end') end = Math.max(t, start + MIN_CLIP);
        if (kind === 'head') head = Math.max(start, Math.min(end, t));
        else {
          // The whole film stays within the limit while dragging.
          const others = filmLength(project) - segmentLength(segment);
          if (others + (end - start) / segment.speed > MAX_SECONDS) kind === 'start' ? (start = end - (MAX_SECONDS - others) * segment.speed) : (end = start + (MAX_SECONDS - others) * segment.speed);
          head = kind === 'start' ? start : end;
          placeTrim(start, end, segment);
        }
        placeHead(segment);
        player.peek(segment.sourceId, head);
      };
      move(event);
      trim.onpointermove = move;
      trim.onpointerup = trim.onpointercancel = () => {
        trim.onpointermove = trim.onpointerup = trim.onpointercancel = null;
        trim.classList.remove('is-dragging');
        if (kind !== 'head' && (start !== segment.start || end !== segment.end)) commitTrim(segment, start, end);
      };
    };
    for (const handle of root.querySelectorAll('.trim-handle')) {
      handle.onkeydown = event => {
        const step = { ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const segment = active(), isStart = handle.classList.contains('is-start');
        const start = isStart ? Math.max(0, Math.min(segment.end - MIN_CLIP, segment.start + step)) : segment.start;
        const end = isStart ? segment.end : Math.min(segment.duration, Math.max(segment.start + MIN_CLIP, segment.end + step));
        if (filmLength(project) - segmentLength(segment) + (end - start) / segment.speed > MAX_SECONDS + 1e-6) return;
        commitTrim(segment, start, end);
        root.querySelector(`.trim-handle.${isStart ? 'is-start' : 'is-end'}`).focus();
      };
    }
  }
  function commitTrim(segment, start, end) {
    try {
      project = trimSegment(project, segment.id, start, end);
      player.load(project.segments);
      player.peek(segment.sourceId, head ?? start);
      refresh();
    } catch { toast(t('editor.tooShort')); refresh(); }
  }

  function split() {
    const segment = active();
    if (!canSplit(segment)) return toast(t('editor.splitHint'));
    const at = head;
    commit(splitSegment(project, segment.id, at, uid()));
    head = at;
    placeHead(active());
  }
  function move(direction) {
    const segment = active();
    try { commit(moveSegment(project, segment.id, direction)); } catch { /* button is disabled at the ends */ }
    player.seekSegment(segment.id);
  }
  function remove() {
    const index = project.segments.indexOf(active());
    head = null;
    commit(removeSegment(project, active().id), t('editor.deleted', { n: index + 1 }));
  }
  function togglePicker() { picker = !picker; refresh(); if (picker) root.querySelector('.speed-picker [aria-checked="true"]')?.focus(); }
  function changeSpeed(speed) {
    const segment = active();
    picker = false;
    if (speed === segment.speed) return refresh();
    if (filmLength(project) - segmentLength(segment) + (segment.end - segment.start) / speed > MAX_SECONDS + 1e-6) {
      refresh();
      return toast(t('editor.speedTooLong', { speed: speedLabel(speed), max: MAX_SECONDS }));
    }
    commit(setSpeed(project, segment.id, speed));
    root.querySelector('[data-action="speed"]').focus();
  }

  function openLooks() {
    player.pause();
    picker = false;
    refresh();
    const shown = player.shown, source = shown && sources.get(shown.dataset.source);
    panel = openLookPanel(root, {
      tiles: shown ? lookTiles(shown, { width: shown.videoWidth, height: shown.videoHeight, fit: source.fit, mirror: source.mirror }) : [],
      get: () => { const s = active(); return { title: t('editor.filterTitle', { n: project.segments.indexOf(s) + 1 }), look: s.look, strength: s.strength, exposure: s.exposure }; },
      onPick: id => { const s = active(); if (id !== s.look) commit(setLook(project, [s.id], { look: id })); },
      onChange: (patch, final) => {
        const s = active(), look = { look: s.look, strength: s.strength, exposure: s.exposure, ...patch };
        if (!final) return player.preview(look);
        player.preview(null);
        commit(setLook(project, [s.id], look));
      },
      onAll: () => { const s = active(); commit(setLook(project, project.segments.map(x => x.id), s), t('editor.filterAll', { name: lookById(s.look).name })); },
      onClose: () => { panel = null; player?.preview(null); root?.querySelector('[data-action="look"]')?.focus(); },
    });
  }

  async function openMusic() {
    player.pause();
    if (!currentTrack()) {
      const audio = await pickMusic({ original: project.audio.original, music: 1 });
      if (!audio || !root) return;
      commit(setAudio(project, audio));
    }
    let pending = {};
    panel = openMusicPanel(root, {
      get: () => ({ track: currentTrack(), audio: { ...project.audio, ...pending }, window: filmLength(project) }),
      onPick: async () => { const audio = await pickMusic({ original: project.audio.original, music: project.audio.music }); if (audio && root) { commit(setAudio(project, audio)); panel?.render(); } },
      onRemove: () => { commit(setAudio(project, DEFAULT_AUDIO), t('editor.musicRemoved')); panel.render(); },
      onChange: (patch, final) => {
        pending = { ...pending, ...patch };
        if (!final) return player.setAudio({ ...project.audio, ...pending }, currentTrack());
        const next = pending;
        pending = {};
        commit(setAudio(project, next));
      },
      onClose: () => { panel = null; root?.querySelector('[data-action="music"]')?.focus(); },
    });
  }

  async function exportVideo() {
    player.pause();
    const controller = new AbortController();
    const overlay = html(`<div class="exporting" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <h2 id="export-title">${t('export.title')}</h2>
      <div class="export-bar"><span></span></div>
      <p><span class="export-percent">0</span> % · ${t('export.keepOpen')}</p>
      <button type="button" class="pill">${t('cancel')}</button></div>`);
    overlay.querySelector('button').onclick = () => controller.abort();
    root.append(overlay);
    overlay.querySelector('button').focus();
    const lock = await navigator.wakeLock?.request('screen').catch(() => null);
    try {
      const blob = await exportFilm(project.segments, sources, {
        audio: project.audio,
        music: currentTrack()?.blob ?? null,
        signal: controller.signal,
        onProgress: p => { overlay.querySelector('.export-bar span').style.transform = `scaleX(${p})`; overlay.querySelector('.export-percent').textContent = Math.round(p * 100); },
      });
      result.show(blob);
    } catch (error) {
      overlay.remove();
      if (error.name === 'AbortError') toast(t('export.cancelled'));
      else toast(t('export.failed', { reason: error.message?.endsWith('.') ? error.message : '' }).replace(/\s+/g, ' '));
    } finally {
      lock?.release().catch(() => {});
    }
  }

  return {
    show,
    reload(scrollToEnd) { player.load(project.segments); player.seekSegment(active().id); refresh(scrollToEnd); },
    close() {
      document.removeEventListener('keydown', onSpace, true);
      document.removeEventListener('keyup', swallowSpace, true);
      panel = null;
      player?.destroy();
      player = null;
      root = null;
    },
  };
})();
function showEditor() { editor.show(); }

// ── Result ───────────────────────────────────────────────────────────────────

const result = (() => {
  let root, url;
  function show(blob) {
    leave();
    screen = 'result';
    url = URL.createObjectURL(blob);
    const file = new File([blob], `clip-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.mp4`, { type: 'video/mp4' });
    const shareable = Boolean(navigator.canShare?.({ files: [file] }));
    let nostrState;
    root = html(`<section class="screen result" aria-labelledby="result-title">
      <video class="result-video" playsinline loop aria-label="${t('result.video')}"></video>
      <header class="editor-top">
        <button type="button" class="glyph" data-action="edit" aria-label="${t('result.back')}">${icon('back')}</button>
      </header>
      <footer class="result-bottom">
        <h2 id="result-title">${t('result.title')}</h2>
        <p>${formatDuration(filmLength(project))} · ${formatNumber(blob.size / 1048576, { maximumFractionDigits: 1 })} MB · MP4</p>
        <button type="button" class="pill primary nostr-action" data-action="nostr"><img src="/nostr-icon.png" alt="" width="20" height="20"><span data-nostr-label>${t('nostr.action')}</span></button>
        <div class="result-actions">
          ${shareable ? `<button type="button" class="pill" data-action="share">${icon('share')}${t('result.share')}</button>` : ''}
          <button type="button" class="pill" data-action="save">${icon('download')}${t('result.save')}</button>
        </div>
        <button type="button" class="text-button" data-action="new">${t('result.new')}</button>
      </footer>
    </section>`);
    app.replaceChildren(root);
    const video = root.querySelector('video');
    video.src = url;
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    video.onclick = () => { if (video.muted) video.muted = false; else video.paused ? video.play() : video.pause(); };
    root.onclick = async event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'edit') editor.show();
      if (action === 'save') { const a = Object.assign(document.createElement('a'), { href: url, download: file.name }); a.click(); toast(t('result.saving')); }
      if (action === 'share') navigator.share({ files: [file] }).catch(error => { if (error.name !== 'AbortError') toast(t('result.shareFailed')); });
      if (action === 'nostr') {
        const button = event.target.closest('button');
        if (button.getAttribute('aria-disabled') === 'true') return;
        const current = root;
        button.setAttribute('aria-disabled', 'true');
        try {
          const { openNostrSheet } = await import('./nostr/sheet.js');
          if (root !== current || document.querySelector('dialog[open]')) return;
          nostrState ??= { identifier: crypto.randomUUID() };
          const wasPlaying = !video.paused;
          video.pause();
          openNostrSheet({
            file, video, state: nostrState,
            onPublished: () => { button.querySelector('[data-nostr-label]').textContent = t('nostr.published'); },
            onClose: () => { if (wasPlaying && root === current) video.play().catch(() => {}); },
          });
        } catch {
          toast(t('nostr.unavailable'));
        } finally {
          button.removeAttribute('aria-disabled');
        }
      }
      if (action === 'new' && await confirmSheet({ title: t('result.newTitle'), text: t('result.newText'), confirm: t('result.new') })) { resetProject(); camera.show(); }
    };
    root.querySelector('[data-action="nostr"]').focus();
  }
  return {
    show,
    close() {
      if (!root) return;
      root.querySelector('video').removeAttribute('src');
      URL.revokeObjectURL(url);
      root = null;
    },
  };
})();

// ── Lifecycle ────────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (!camera.active) return;
  document.hidden ? camera.suspend() : camera.resume();
});
window.addEventListener('beforeunload', event => { if (project.segments.length || camera.busy) { event.preventDefault(); event.returnValue = ''; } });

// Android's edge swipe and back button would leave the app and drop the session. While there is something to
// lose, one history entry absorbs them and they step back inside the app instead. The entry is re-added on the
// next touch because Chromium skips history entries that were added without a user gesture.
let guarded = false;
function guardBack() {
  if (guarded || (screen === 'camera' && !project.segments.length)) return;
  history.pushState({ clip: true }, '');
  guarded = true;
}
addEventListener('pointerdown', guardBack, true);
addEventListener('keydown', guardBack, true);
addEventListener('popstate', () => {
  guarded = false;
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close('');
    return;
  }
  const panelScrim = app.querySelector('.panel-scrim');
  if (panelScrim) return panelScrim.click();
  if (app.querySelector('.exporting')) return;
  if (screen === 'result') editor.show();
  else if (screen === 'editor') camera.show();
});
camera.show();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
