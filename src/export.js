import { Input, Output, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat, CanvasSink, CanvasSource, AudioBufferSource, Quality, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec } from 'mediabunny';
import { validateTrim } from './trim.js';
import { segmentLength, DEFAULT_AUDIO } from './project.js';
import { createRenderer } from './looks.js';
import { decodeTimeline } from './media.js';
import { t } from './i18n/index.js';

const FPS = 30, SAMPLE_RATE = 48000, HIGH = new Quality('high');

// Portrait 9:16 at the sharpest short side any source offers, capped at 1080p. Even sizes keep H.264 happy.
export function outputSize(sources) {
  const shortSide = Math.max(0, ...[...sources].map(s => Math.min(s.width || 0, s.height || 0)));
  const width = Math.min(1080, Math.max(720, Math.round(shortSide / 2) * 2));
  return { width, height: Math.round(width * 16 / 9 / 2) * 2 };
}

// segments use the project model; sources is a Map from sourceId to { blob, fit, mirror, hasAudio, width, height }.
// Messages a user can see are localized; programming errors stay in English.
export function validateFilm(segments, sources) {
  if (!Array.isArray(segments) || !segments.length) throw new Error(t('export.empty'));
  if (!(sources instanceof Map)) throw new TypeError('sources must be a Map');
  for (const segment of segments) {
    if (!segment || typeof segment.sourceId !== 'string' || !segment.sourceId) throw new TypeError('Invalid segment source');
    validateTrim(segment.start, segment.end, segment.duration);
    if (!(segment.speed > 0)) throw new RangeError('Invalid speed');
    const blob = sources.get(segment.sourceId)?.blob;
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error(t('export.missing'));
  }
}

const aborted = signal => { if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); };

// Every source is decoded and redrawn onto one portrait canvas, so differing resolutions,
// orientations and codecs all end up in a single MP4. No fallback to an original file.
// audio: the project's mix settings; music: the chosen music file, if any.
export async function exportFilm(segments, sources, { audio = DEFAULT_AUDIO, music = null, onProgress = () => {}, signal } = {}) {
  validateFilm(segments, sources);
  const used = new Map(segments.map(s => [s.sourceId, sources.get(s.sourceId)]));
  const { width, height } = outputSize(used.values());
  const total = segments.reduce((n, s) => n + segmentLength(s), 0);

  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height, quality: HIGH, frameRate: FPS });
  if (!videoCodec) throw new Error(t('export.noVideo'));
  aborted(signal);
  const sound = await mixAudio(segments, used, total, audio, music);
  aborted(signal);
  let audioCodec = null;
  if (sound) {
    audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: HIGH });
    if (!audioCodec) throw new Error(t('export.noAudio'));
  }

  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const renderer = createRenderer(canvas, { preserve: true });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality: HIGH });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioSource = sound && new AudioBufferSource({ codec: audioCodec, quality: HIGH });
  if (audioSource) output.addAudioTrack(audioSource);

  try {
    await output.start();
    let offset = 0;
    for (const segment of segments) {
      const source = used.get(segment.sourceId);
      const input = new Input({ source: new BlobSource(source.blob), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) throw new Error(t('export.clipUnreadable'));
        // Decode no larger than the output needs; the shader does fit, mirror and look.
        const scale = Math.min(1, (source.fit === 'cover' ? Math.max : Math.min)(width / source.width, height / source.height));
        const frameSize = { width: Math.max(2, Math.round(source.width * scale)), height: Math.max(2, Math.round(source.height * scale)) };
        const sink = new CanvasSink(track, { ...frameSize, fit: 'fill', poolSize: 2 });
        const look = { ...frameSize, fit: source.fit, mirror: source.mirror, look: segment.look, strength: segment.strength, exposure: segment.exposure };
        let last = -Infinity;
        for await (const frame of sink.canvases(segment.start, segment.end)) {
          aborted(signal);
          const at = offset + Math.max(0, frame.timestamp - segment.start) / segment.speed;
          // Fast clips would exceed the output frame rate; drop the surplus frames.
          if (at - last < 0.9 / FPS) continue;
          renderer.draw(frame.canvas, { ...look, time: at });
          await videoSource.add(at, Math.max(1 / FPS, frame.duration / segment.speed));
          last = at;
          onProgress(Math.min(0.99, at / total));
        }
      } finally {
        input.dispose();
      }
      offset += segmentLength(segment);
    }
    if (audioSource) await audioSource.add(sound);
    aborted(signal);
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  } finally {
    renderer.destroy();
  }
  if (!target.buffer?.byteLength) throw new Error(t('export.emptyResult'));
  onProgress(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// Lays every clip's sound onto one track, then the music; speed changes pitch along with tempo, as in the preview.
async function mixAudio(segments, sources, total, audio, music) {
  const withMusic = music instanceof Blob && audio.music > 0, withOriginal = audio.original > 0 && [...sources.values()].some(s => s.hasAudio);
  if (!withMusic && !withOriginal) return null;
  const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * SAMPLE_RATE)), SAMPLE_RATE);
  const decode = async (load, message) => { try { return await load(); } catch { throw new Error(message); } };
  const gain = value => { const node = context.createGain(); node.gain.value = value; node.connect(context.destination); return node; };
  if (withOriginal) {
    const decoded = new Map(), original = gain(audio.original);
    for (const [id, source] of sources) if (source.hasAudio) decoded.set(id, await decode(() => decodeTimeline(source.blob, context), t('export.soundUnreadable')));
    let offset = 0;
    for (const segment of segments) {
      const buffer = decoded.get(segment.sourceId), length = segmentLength(segment);
      if (buffer && segment.start < buffer.duration) {
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = segment.speed;
        node.connect(original);
        node.start(offset, segment.start);
        node.stop(offset + length);
      }
      offset += length;
    }
  }
  if (withMusic) {
    const buffer = await decode(async () => context.decodeAudioData(await music.arrayBuffer()), t('export.musicUnreadable'));
    if (audio.musicStart < buffer.duration) {
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(gain(audio.music));
      node.start(0, audio.musicStart);
      node.stop(total);
    }
  }
  return context.startRendering();
}
