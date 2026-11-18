import { Input, ALL_FORMATS, BlobSource, CanvasSink, AudioBufferSink } from 'mediabunny';

// Reads what the editor and export need; computeDuration also works for recorder WebM without duration metadata.
export async function probe(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('Keine Videospur.');
    const [duration, width, height, audio] = await Promise.all([input.computeDuration(), video.getDisplayWidth(), video.getDisplayHeight(), input.getPrimaryAudioTrack()]);
    if (!(duration > 0)) throw new Error('Keine Dauer.');
    return { duration, width, height, hasAudio: Boolean(audio) };
  } finally {
    input.dispose();
  }
}

// Evenly spaced JPEG frames across the whole source, for the clip strip and trim bar.
export async function thumbnails(blob, duration, count = 10, height = 160) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return [];
    const sink = new CanvasSink(track, { width: Math.round(height * 9 / 16), height, fit: 'cover' });
    const times = Array.from({ length: count }, (_, i) => (i + 0.5) * duration / count);
    const frames = [];
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (frame) frames.push(await new Promise(resolve => frame.canvas.toBlob(b => resolve(b && URL.createObjectURL(b)), 'image/jpeg', 0.7)));
    }
    return frames.filter(Boolean);
  } catch {
    return []; // Thumbnails are decoration; the editor works without them.
  } finally {
    input.dispose();
  }
}

// The file's sound as one AudioBuffer whose sample 0 is media time 0, so buffer positions equal video
// positions. decodeAudioData alone ignores where the audio track starts (recorders often start it a bit
// after the video, and AAC adds priming), which drifts sound against picture. Returns null without sound.
export async function decodeTimeline(blob, context) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const [first, end, decodable] = await Promise.all([track.getFirstTimestamp(), input.computeDuration(), track.canDecode()]);
    // Browsers without WebCodecs audio decode the whole file and get it shifted to where the track starts.
    const whole = decodable ? null : await context.decodeAudioData(await blob.arrayBuffer());
    const rate = whole?.sampleRate ?? await track.getSampleRate(), channels = whole?.numberOfChannels ?? await track.getNumberOfChannels();
    const out = context.createBuffer(channels, Math.max(1, Math.ceil(end * rate)), rate);
    const place = (buffer, at) => {
      let from = 0, to = Math.round(at * rate);
      if (to < 0) { from = -to; to = 0; } // priming before media time 0
      for (let c = 0; c < channels; c++) {
        const data = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(from, from + out.length - to);
        if (data.length > 0) out.copyToChannel(data, c, to);
      }
    };
    if (whole) place(whole, first);
    else for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) place(buffer, timestamp);
    return out;
  } finally {
    input.dispose();
  }
}
