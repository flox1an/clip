// Browser media layer, intentionally independent of UI.
const QUALITY = { width: { ideal: 1920 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } }; // equal ideals keep the native (portrait) orientation
const AUDIO = { echoCancellation: true, noiseSuppression: true };

// Android cameras can still be busy for a moment after the previous stream stopped.
// Chromium only exposes zoom when it is requested; Safari reports zoom without it and does not know `pan`.
async function request(video) {
  const constraints = { video: { ...video, ...QUALITY, ...(navigator.mediaDevices.getSupportedConstraints?.().pan && { zoom: true }) }, audio: AUDIO };
  try { return await navigator.mediaDevices.getUserMedia(constraints); }
  catch (error) {
    if (error.name !== 'NotReadableError' && error.name !== 'AbortError') throw error;
    await new Promise(resolve => setTimeout(resolve, 400));
    return navigator.mediaDevices.getUserMedia(constraints);
  }
}

// An ideal facingMode is only a hint that some Android browsers outweigh with resolution, so ask for it exactly,
// fall back to the hint, and when that still lands on avoidDeviceId (the camera being switched away from)
// step to the next camera by device id.
export async function openCamera(facingMode = 'user', { avoidDeviceId } = {}) {
  if (!globalThis.isSecureContext) throw new Error('Camera access requires HTTPS or localhost.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported by this browser.');
  let stream;
  try { stream = await request({ facingMode: { exact: facingMode } }); }
  catch (error) {
    if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
    stream = await request({ facingMode: { ideal: facingMode } });
  }
  const deviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
  if (avoidDeviceId && deviceId === avoidDeviceId) {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput' && device.deviceId);
    const next = cameras[(cameras.findIndex(device => device.deviceId === deviceId) + 1) % cameras.length];
    if (next && next.deviceId !== deviceId) {
      stopStream(stream);
      stream = await request({ deviceId: { exact: next.deviceId } });
    }
  }
  return stream;
}

export function stopStream(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

// The stream stays open after stop() so the next take can start immediately; the caller releases it.
export function createRecorder(stream, { stopTimeoutMs = 15000 } = {}) {
  if (typeof MediaRecorder === 'undefined') throw new Error('Video recording is not supported by this browser.');
  const preferred = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = preferred.find(type => MediaRecorder.isTypeSupported(type));
  const options = { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000, ...(mimeType && { mimeType }) };
  const recorder = new MediaRecorder(stream, options);
  const chunks = [];
  recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
  return {
    start() { recorder.start(1000); },
    stop() {
      return new Promise((resolve, reject) => {
        if (recorder.state === 'inactive') return reject(new Error('Recorder is not recording.'));
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          recorder.removeEventListener('stop', onStop);
          recorder.removeEventListener('error', onError);
          if (error) return reject(error);
          const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
          blob.size ? resolve(blob) : reject(new Error('No video was recorded.'));
        };
        const onStop = () => finish();
        const onError = event => finish(event.error || new Error('Recording failed.'));
        const timeout = setTimeout(() => finish(new Error('Recording did not finish in time.')), stopTimeoutMs);
        recorder.addEventListener('stop', onStop);
        recorder.addEventListener('error', onError);
        try { recorder.stop(); } catch (error) { finish(error); }
      });
    },
  };
}
