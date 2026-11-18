import { segmentLength } from './project.js';
import { createRenderer, fitCanvas } from './looks.js';
import { audioContext, resumeAudio } from './audio.js';
import { decodeTimeline } from './media.js';

// A paused <video> needs a moment to start (measured ~0.1–0.2 s in the iOS simulator, more on devices). So
// before a cut the next clip's element starts playing early, at its normal speed, timed so it reaches its
// in-point right at the cut; the cut then only switches visibility. Changing the rate at the cut instead
// (slow preroll) measured slower than a cold start in WebKit. The start delay is learned while playing.
// Clips that continue the same file without a gap keep the same element.
const LEAD = 0.8;
// Sound is restarted when it drifts further than this from the picture.
const DRIFT = 0.08;
const continues = (a, b) => a.sourceId === b.sourceId && a.speed === b.speed && Math.abs(b.start - a.end) < 0.05;

// Plays the timeline across several source files and paints it through the look shader. Each source gets
// one hidden, always muted <video>, plus a spare when the timeline jumps within the same file.
// Sound comes from decoded buffers in Web Audio, following the picture: routing the <video> elements
// themselves through Web Audio made iOS stall playback, and iOS ignores element volume, so the mix
// (original vs. music) could not be previewed any other way. unlock() must run inside a user gesture.
export function createPlayer(stage, sources, { onTime = () => {}, onSegment = () => {}, onPlayState = () => {} } = {}) {
  const pool = new Map();
  const canvas = Object.assign(document.createElement('canvas'), { className: 'player-canvas' });
  stage.prepend(canvas);
  const renderer = createRenderer(canvas);
  const context = audioContext(), originalGain = context.createGain(), musicGain = context.createGain();
  originalGain.connect(context.destination);
  musicGain.connect(context.destination);
  const resize = new ResizeObserver(() => paint());
  resize.observe(stage);
  const decoding = new Map(), decoded = new Map(), voices = { original: null, music: null };
  let segments = [], index = 0, playing = false, frame = 0, current = null, prepared = null, shown = null, override = null;
  let musicKey = null, musicStart = 0, parkTimer = 0, lastVideoTime = -1, lastMove = 0, latency = 0.15;

  function paint() {
    if (!shown) return;
    fitCanvas(canvas);
    const segment = segments[index], source = sources.get(shown.dataset.source);
    renderer.draw(shown, { width: shown.videoWidth, height: shown.videoHeight, fit: source.fit, mirror: source.mirror, look: override?.look ?? segment?.look, strength: override?.strength ?? segment?.strength, exposure: override?.exposure ?? segment?.exposure, time: shown.currentTime });
  }
  function create(sourceId) {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = video.defaultMuted = true;
    video.preload = 'auto';
    video.className = 'player-video';
    video.dataset.source = sourceId;
    video.src = sources.get(sourceId).url;
    for (const type of ['loadeddata', 'seeked']) video.addEventListener(type, () => { if (video === shown) paint(); });
    if (video.requestVideoFrameCallback) {
      const onFrame = () => { if (video === shown) paint(); if (video.isConnected) video.requestVideoFrameCallback(onFrame); };
      video.requestVideoFrameCallback(onFrame);
    }
    stage.prepend(video);
    pool.set(sourceId, [...(pool.get(sourceId) ?? []), video]);
    return video;
  }
  const videoFor = (sourceId, avoid = null) => (pool.get(sourceId) ?? []).find(video => video !== avoid) ?? create(sourceId);
  const allVideos = () => [...pool.values()].flat();
  const offsetOf = i => segments.slice(0, i).reduce((n, s) => n + segmentLength(s), 0);
  function show(video) {
    shown = video;
    paint();
  }

  // ── Sound ──
  // Clip sound must line up with the video timeline (see decodeTimeline); music is a plain song from 0.
  function decode(key, load) {
    if (decoding.has(key)) return;
    decoding.set(key, load().then(buffer => decoded.set(key, buffer), () => decoded.set(key, null)));
  }
  function stopVoice(slot) {
    const voice = voices[slot];
    if (!voice) return;
    try { voice.node.stop(); } catch { /* already stopped */ }
    voice.node.disconnect();
    voices[slot] = null;
  }
  // Keeps one buffer source playing `key` at `position` (seconds in the buffer) until `until`.
  function voice(slot, key, position, rate, until, output) {
    const buffer = decoded.get(key), playingVoice = voices[slot];
    if (!buffer || position >= Math.min(until, buffer.duration)) return stopVoice(slot);
    if (playingVoice?.key === key && playingVoice.rate === rate && Math.abs(playingVoice.position + (context.currentTime - playingVoice.at) * rate - position) < DRIFT) return;
    stopVoice(slot);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = rate; // pitch follows speed, as in the export
    node.connect(output);
    node.start(0, position);
    node.stop(context.currentTime + (Math.min(until, buffer.duration) - position) / rate);
    voices[slot] = { key, node, rate, position, at: context.currentTime };
  }
  // The picture leads: sound runs only while the visible video actually advances, so a stalled video
  // never leaves its sound running ahead.
  function syncAudio() {
    const now = performance.now();
    if (current && current.currentTime !== lastVideoTime) { lastVideoTime = current.currentTime; lastMove = now; }
    if (!playing || !current || current.paused || now - lastMove > 120 || context.state !== 'running') {
      stopVoice('original');
      stopVoice('music');
      return;
    }
    const segment = segments[index];
    voice('original', segment.sourceId, current.currentTime, segment.speed, segment.end, originalGain);
    if (musicKey) voice('music', musicKey, musicStart + time(), 1, Infinity, musicGain);
    else stopVoice('music');
  }

  // ── Picture ──
  function cancelPrepared() {
    if (prepared && prepared.video !== current) prepared.video.pause();
    prepared = null;
  }
  // The clip after `i` when reaching it needs a different element (not a seamless continuation), else null.
  function cutAfter(i) {
    const nextIndex = (i + 1) % segments.length, next = segments[nextIndex];
    return segments.length > 1 && continues(segments[i], next) ? null : { index: nextIndex, segment: next };
  }
  // Where the next clip's element must start so it reaches its in-point after `remaining` seconds,
  // allowing for the time it takes to get going. Negative means: too early, it would start before 0.
  const prerollFrom = (segment, remaining) => segment.start - (remaining - latency) * segment.speed;
  function prepare(i, from) {
    const segment = segments[i], video = videoFor(segment.sourceId, current);
    video.playbackRate = segment.speed;
    if (Math.abs(video.currentTime - from) > 0.1) video.currentTime = from; // normally already there, see enter()
    video.play().catch(() => {});
    prepared = { index: i, video, from: video.currentTime, at: performance.now(), speed: segment.speed };
  }
  function learnLatency() {
    if (!prepared || prepared.learned || prepared.video.currentTime < prepared.from + 0.02) return;
    const sample = (performance.now() - prepared.at) / 1000 - (prepared.video.currentTime - prepared.from) / prepared.speed;
    latency = Math.min(0.6, Math.max(0.05, latency * 0.7 + sample * 0.3));
    prepared.learned = true;
  }
  // ready: an element prepare() already started near sourceTime.
  function enter(i, sourceTime, ready = null) {
    const segment = segments[i];
    const video = ready ?? (current?.dataset.source === segment.sourceId ? current : videoFor(segment.sourceId));
    if (prepared?.video !== video) cancelPrepared();
    prepared = null;
    if (current && current !== video) current.pause();
    current = video;
    index = i;
    video.defaultPlaybackRate = video.playbackRate = segment.speed;
    if (Math.abs(video.currentTime - sourceTime) > (ready ? 0.25 : 0.04)) video.currentTime = sourceTime;
    show(video);
    if (playing) video.play().catch(() => pause());
    onSegment(segment.id);
    // Park the next clip's element at its preroll point so the preroll later only has to start playback.
    // Seeking a hidden element makes iOS stutter the visible one, so while paused this happens right away
    // (then pressing play starts clean) and during playback only once the new clip runs.
    clearTimeout(parkTimer);
    const park = () => {
      const cut = cutAfter(index);
      if (!cut || prepared) return;
      const parked = videoFor(cut.segment.sourceId, current);
      if (parked.paused) parked.currentTime = Math.max(0, prerollFrom(cut.segment, LEAD));
    };
    if (playing) parkTimer = setTimeout(park, 300);
    else park();
  }
  function time() {
    const segment = segments[index];
    if (!segment || !current) return 0;
    return offsetOf(index) + Math.max(0, Math.min(segment.end, current.currentTime) - segment.start) / segment.speed;
  }
  function tick() {
    const segment = segments[index], video = current, cut = cutAfter(index), nextIndex = (index + 1) % segments.length;
    const remaining = (segment.end - video.currentTime) / segment.speed;
    if (cut && remaining < LEAD && prepared?.index !== cut.index) {
      const from = prerollFrom(cut.segment, remaining);
      if (from >= 0) prepare(cut.index, from); // clips starting near 0 begin later, just before the cut
    }
    learnLatency();
    if (video.currentTime >= segment.end - 0.02 || video.ended) {
      if (!cut) { index = nextIndex; onSegment(segments[nextIndex].id); }
      else enter(cut.index, cut.segment.start, prepared?.index === cut.index ? prepared.video : null);
    }
    if (!current.requestVideoFrameCallback) paint();
    syncAudio();
    onTime(time());
    frame = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(frame);
    cancelPrepared();
    for (const video of allVideos()) video.pause();
    syncAudio();
    onPlayState(false);
  }
  function seek(filmTime) {
    if (!segments.length) return;
    cancelPrepared();
    let offset = 0;
    for (let i = 0; i < segments.length; i++) {
      const length = segmentLength(segments[i]);
      if (filmTime < offset + length || i === segments.length - 1) {
        enter(i, segments[i].start + Math.max(0, Math.min(length, filmTime - offset)) * segments[i].speed);
        break;
      }
      offset += length;
    }
    onTime(time());
  }
  return {
    get playing() { return playing; },
    get shown() { return shown; },
    time,
    load(next) {
      const at = time();
      cancelPrepared();
      segments = next;
      if (!segments.length) return pause();
      // Create every element up front, including spares for jumps within one file.
      segments.forEach((segment, i) => {
        const source = sources.get(segment.sourceId), first = videoFor(segment.sourceId), following = segments[(i + 1) % segments.length];
        if (following.sourceId === segment.sourceId && !continues(segment, following)) videoFor(segment.sourceId, first);
        if (source.hasAudio) decode(segment.sourceId, () => decodeTimeline(source.blob, context));
      });
      index = Math.min(index, segments.length - 1);
      seek(at);
    },
    seek,
    seekSegment(id) { const i = segments.findIndex(s => s.id === id); if (i >= 0) { cancelPrepared(); enter(i, segments[i].start); onTime(time()); } },
    // Shows any frame of a source while trimming, outside the current cut.
    peek(sourceId, sourceTime) {
      if (playing) pause();
      const video = current?.dataset.source === sourceId ? current : videoFor(sourceId);
      video.currentTime = sourceTime;
      show(video);
    },
    // Live look while the filter panel is open; null returns to the clip's own look.
    preview(look) { override = look; paint(); },
    // audio: the project's mix; track: { url, blob } of the chosen music or null.
    setAudio(audio, track) {
      originalGain.gain.value = audio.original;
      musicGain.gain.value = audio.music;
      const key = track ? `music:${track.url}` : null;
      // Called on every editor refresh; only a different song or section restarts the music.
      if (key !== musicKey || audio.musicStart !== musicStart) stopVoice('music');
      musicStart = audio.musicStart;
      musicKey = key;
      if (track) decode(musicKey, async () => context.decodeAudioData(await track.blob.arrayBuffer()));
      syncAudio();
    },
    play() {
      if (!segments.length) return;
      const segment = segments[index], video = current ?? videoFor(segment.sourceId);
      const at = video.currentTime >= segment.end - 0.05 || video.currentTime < segment.start ? segment.start : video.currentTime;
      if (shown !== video || current !== video || at !== video.currentTime) enter(index, at);
      playing = true;
      lastMove = 0;
      current.play().catch(() => pause());
      frame = requestAnimationFrame(tick);
      onPlayState(true);
    },
    pause,
    // Muted videos may play without a gesture; only the sound needs the tap.
    unlock() { resumeAudio(); },
    destroy() {
      pause();
      clearTimeout(parkTimer);
      resize.disconnect();
      for (const video of allVideos()) { video.removeAttribute('src'); video.load(); video.remove(); }
      pool.clear();
      originalGain.disconnect();
      musicGain.disconnect();
      renderer.destroy();
      canvas.remove();
    },
  };
}
