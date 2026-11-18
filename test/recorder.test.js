import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder, openCamera } from '../src/recorder.js';

class FakeRecorder extends EventTarget {
  static isTypeSupported() { return true; }
  constructor() { super(); this.state = 'inactive'; this.mimeType = 'video/mp4'; FakeRecorder.instance = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
  complete() {
    const data = new Event('dataavailable');
    data.data = new Blob(['video']);
    this.dispatchEvent(data);
    this.dispatchEvent(new Event('stop'));
  }
}
globalThis.MediaRecorder = FakeRecorder;
function setup() {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] };
  const recorder = createRecorder(stream, { stopTimeoutMs: 20 });
  recorder.start();
  return { recorder, stopped: () => stopped };
}
test('stop waits for final data and keeps the camera open for the next take', async () => {
  const { recorder, stopped } = setup();
  const result = recorder.stop();
  FakeRecorder.instance.complete();
  assert.equal(await (await result).text(), 'video');
  assert.equal(stopped(), 0);
});
test('missing stop event fails instead of hanging or claiming success', async () => {
  const { recorder } = setup();
  await assert.rejects(recorder.stop(), /did not finish/);
});
test('stop exceptions reject', async () => {
  const { recorder } = setup();
  FakeRecorder.instance.stop = () => { throw new Error('stop failed'); };
  await assert.rejects(recorder.stop(), /stop failed/);
});

// Cameras: front 'f', back 'b'. getUserMedia is scripted per test.
function fakeDevices(pick) {
  const calls = [];
  const stream = deviceId => ({ getTracks: () => [], getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }] });
  globalThis.isSecureContext = true;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async ({ video }) => { calls.push(video); return stream(pick(video)); },
    enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: 'f' }, { kind: 'videoinput', deviceId: 'b' }],
  } });
  return calls;
}
const overconstrained = () => { throw Object.assign(new Error('no'), { name: 'OverconstrainedError' }); };

test('switching asks for the other camera exactly', async () => {
  const calls = fakeDevices(video => (video.facingMode?.exact === 'environment' ? 'b' : 'f'));
  const stream = await openCamera('environment', { avoidDeviceId: 'f' });
  assert.equal(stream.getVideoTracks()[0].getSettings().deviceId, 'b');
  assert.deepEqual(calls.map(v => v.facingMode), [{ exact: 'environment' }]);
});
test('a browser that ignores facing mode still switches by device id', async () => {
  const calls = fakeDevices(video => (video.facingMode?.exact ? overconstrained() : video.deviceId?.exact ?? 'f'));
  const stream = await openCamera('environment', { avoidDeviceId: 'f' });
  assert.equal(stream.getVideoTracks()[0].getSettings().deviceId, 'b');
  assert.deepEqual(calls.at(-1).deviceId, { exact: 'b' });
});
