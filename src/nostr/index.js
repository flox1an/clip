import { kinds, verifyEvent } from 'applesauce-core/helpers/event';
import { getProfileContent } from 'applesauce-core/helpers/profile';
import { neventEncode } from 'applesauce-core/helpers/pointers';
import { RelayPool } from 'applesauce-relay';
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers';
import { EMPTY, catchError, fromEvent, lastValueFrom, reduce, takeUntil } from 'rxjs';

const DISCOVERY = ['wss://relay.primal.net', 'wss://nos.lol', 'wss://purplepag.es', 'wss://relay.nostu.be'];
const PAIRING_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];
// Short videos are watched in NosTube, which reads its own relay.
const VIDEO_RELAY = 'wss://relay.nostu.be';
const AUTH_KIND = 24242;
const SHORT_KIND = 34236;
const VIDEO_KIND = 34235;
// Blossom rejects an approval ticket dated in the future, and phone clocks run ahead by minutes.
const CLOCK_SKEW = 300;
const now = () => Math.floor(Date.now() / 1000);
const unique = values => [...new Set(values)];

function safeUrl(value, protocols) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (protocols.includes(url.protocol) && !url.username && !url.password) return url;
  } catch {}
  return null;
}

const secureRelays = values => unique(values.map(value => safeUrl(value, ['wss:'])?.href).filter(Boolean));

export const createNostrPool = () => new RelayPool();

class PairingSigner extends NostrConnectSigner {
  async handleEvent(event) {
    if (!this.remote) {
      // NIP-46 requires the URI secret. Applesauce also accepts a bare legacy "ack".
      if (!verifyEvent(event)) return;
      try {
        const reply = JSON.parse(await this.signer.nip44.decrypt(event.pubkey, event.content));
        if (reply.result !== this.connectSecret) return;
      } catch { return; }
    }
    return super.handleEvent(event);
  }
}

export function createRemoteSigner(pool, bunker, onAuth, session) {
  let options = { relays: PAIRING_RELAYS };
  if (bunker) {
    if (!bunker.startsWith('bunker://')) throw new Error('Invalid bunker URI');
    options = NostrConnectSigner.parseBunkerURI(bunker);
    options.relays = secureRelays(options.relays);
    if (!options.relays.length) throw new Error('No secure bunker relays');
  }
  if (session) {
    const { remote, relays, clientKey } = NostrConnectSigner.parseNbunksec(session.connection);
    options = { remote, relays: secureRelays(relays), pubkey: session.pubkey, signer: PrivateKeySigner.fromKey(clientKey) };
    if (!options.relays.length) throw new Error('No secure signer relays');
  }
  const Signer = bunker || session ? NostrConnectSigner : PairingSigner;
  const signer = new Signer({
    ...options,
    subscriptionMethod: (relays, filters) => pool.subscription(relays, filters),
    publishMethod: async (relays, event) => {
      if (event.kind !== kinds.NostrConnect) throw new Error('Only NIP-46 messages may be sent to relays');
      try {
        return await Promise.any(relays.map(async relay => {
          const responses = await pool.publish([relay], event, { timeout: 8_000, retries: false });
          const accepted = responses.find(response => response.ok);
          if (!accepted) throw new Error('Relay did not accept the request');
          return accepted;
        }));
      } catch (cause) {
        throw Object.assign(new Error('No signer relay accepted the request', { cause }), { code: 'signerRelayUnavailable' });
      }
    },
    onAuth: async value => {
      const url = safeUrl(value, ['https:']);
      if (!url) throw new Error('Invalid signer authorization URL');
      onAuth(url.href);
    },
  });
  // Reuse the already-authorized client key. The original bunker token may be single-use.
  if (session) signer.isConnected = true;
  return signer;
}

export function pairingPermissions() {
  return NostrConnectSigner.buildSigningPermissions([AUTH_KIND, SHORT_KIND, VIDEO_KIND]);
}

function isNewer(event, previous) {
  return event && (!previous || event.created_at > previous.created_at ||
    (event.created_at === previous.created_at && event.id < previous.id));
}

function latestEvents(pool, relays, pubkey, kinds, signal) {
  signal.throwIfAborted();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(7_000)]);
  return lastValueFrom(pool.request(relays, { authors: [pubkey], kinds }, { timeout: 7_000 })
    .pipe(
      takeUntil(fromEvent(deadline, 'abort')),
      catchError(() => EMPTY),
      reduce((events, event) => {
        if (event.pubkey !== pubkey || !kinds.includes(event.kind) || !verifyEvent(event)) return events;
        if (isNewer(event, events.get(event.kind))) events.set(event.kind, event);
        return events;
      }, new Map()),
    )).then(events => {
      signal.throwIfAborted();
      return events;
    });
}

export async function discoverAccount(pool, pubkey, signal) {
  const relayList = await latestEvents(pool, DISCOVERY, pubkey, [10002], signal);
  const relayTags = (relayList.get(10002)?.tags ?? []).filter(([key]) => key === 'r');
  const relaysFor = type => secureRelays(relayTags.filter(([, , marker]) => !marker || marker === type).map(([, url]) => url));
  const outbox = relaysFor('write');
  const inbox = relaysFor('read');
  const metadata = outbox.length
    ? await latestEvents(pool, outbox, pubkey, [0, 10063], signal)
    : new Map();
  const servers = (metadata.get(10063)?.tags ?? []).filter(([key]) => key === 'server')
    .map(([, value]) => safeUrl(value, ['https:']))
    .filter(Boolean)
    .map(url => url.origin + url.pathname.replace(/\/+$/, ''));
  const profile = metadata.get(0);
  return {
    profile: profile && getProfileContent(profile),
    servers: unique(servers),
    inbox,
    outbox,
  };
}

async function signFor(signer, pubkey, draft) {
  const event = await signer.signEvent({ ...draft, pubkey });
  if (event.pubkey !== pubkey || event.kind !== draft.kind || event.created_at !== draft.created_at ||
      event.content !== draft.content || JSON.stringify(event.tags) !== JSON.stringify(draft.tags)) {
    throw new Error('Unexpected signed event');
  }
  return event;
}

function signWithDeadline(signer, pubkey, draft, signal) {
  return untilAbort(signFor(signer, pubkey, draft), AbortSignal.any([signal, AbortSignal.timeout(90_000)]));
}

export async function untilAbort(promise, signal) {
  let rejectAbort;
  const onAbort = () => rejectAbort(signal.reason);
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  try { return await Promise.race([aborted, promise]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

// The bytes that were hashed are also the request body. A body the server hashes differently is
// rejected with an "invalid x tag" 401, which a Blob body can cause on iOS.
async function hash(blob) {
  const body = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', body);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { sha256, body };
}

class BlossomUploadError extends Error {
  constructor(code, { cause, status, detail } = {}) {
    super(code, { cause });
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

async function uploadToServers(blob, servers, signer, pubkey, signal, onProgress, onStage, onFailure) {
  onStage('prepare');
  const { sha256, body } = await hash(blob);
  const file = { body, type: blob.type, sha256, size: blob.size };
  signal.throwIfAborted();
  const created_at = now() - CLOCK_SKEW;
  onStage('approve');
  let auth;
  try {
    auth = await signWithDeadline(signer, pubkey, {
      kind: AUTH_KIND,
      created_at,
      content: 'Upload Blob',
      tags: [['t', 'upload'], ['expiration', String(created_at + 3600)], ['x', sha256], ...unique(servers.map(server => new URL(server).hostname)).map(host => ['server', host])],
    }, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (error?.code === 'signerRelayUnavailable') throw error;
    throw new BlossomUploadError(error?.name === 'TimeoutError' ? 'approvalTimeout' : 'approvalFailed', { cause: error });
  }
  const bytes = new TextEncoder().encode(JSON.stringify(auth));
  const base64 = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const base64url = base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const sent = new Map(servers.map(server => [server, 0]));
  const update = () => {
    if (signal.aborted || !sent.size) return;
    const loaded = [...sent.values()].reduce((total, bytes) => total + bytes, 0);
    onProgress(loaded, sent.size * file.size);
  };
  update();
  const results = await Promise.allSettled(servers.map(async server => {
    const report = bytes => {
      sent.set(server, Math.min(bytes, file.size));
      update();
    };
    try {
      const result = await putBlob(file, server, base64, base64url, signal, report);
      report(file.size);
      return result;
    } catch (error) {
      error.sent = sent.get(server) ?? 0;
      error.total = file.size;
      sent.delete(server);
      update();
      if (!signal.aborted) onFailure(server, error);
      throw error;
    }
  }));
  signal.throwIfAborted();
  return results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
}

// Safari reports upload progress in coarse bursts and drops slow connections itself, so gaps are
// detection only: the caller retries once instead of failing the upload.
const FIRST_BYTE_MS = 60_000;
const STALL_MS = 30_000;

function sendBlob(url, file, token, signal, report) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let idleTimer, aborting = null, settled = false;
    const onAbort = () => stop();
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      signal.removeEventListener('abort', onAbort);
      settle(value);
    };
    const stop = reason => {
      clearTimeout(idleTimer);
      aborting ??= reason;
      xhr.abort();
    };
    const watch = milliseconds => {
      clearTimeout(idleTimer);
      // A locked screen pauses the transfer. That is not a stall.
      idleTimer = setTimeout(() => globalThis.document?.hidden ? watch(milliseconds) : stop(), milliseconds);
    };
    xhr.upload.onprogress = event => {
      report(event.loaded);
      watch(STALL_MS);
    };
    // Blossom explains rejections in the body ("invalid x tag", "auth event expired"), so it is read as text.
    xhr.onload = () => {
      if (xhr.responseURL !== url) { finish(reject, new BlossomUploadError('uploadRedirected')); return; }
      const text = (xhr.response ?? '').trim();
      let descriptor = null;
      try { descriptor = JSON.parse(text); } catch {}
      finish(resolve, { status: xhr.status, descriptor, detail: text });
    };
    xhr.onerror = () => finish(reject, new BlossomUploadError('uploadNetwork'));
    xhr.onabort = () => finish(reject, signal.reason ?? aborting ?? new BlossomUploadError('uploadInterrupted'));
    xhr.open('PUT', url);
    xhr.responseType = 'text';
    xhr.setRequestHeader('Authorization', `Nostr ${token}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-SHA-256', file.sha256);
    signal.addEventListener('abort', onAbort, { once: true });
    watch(FIRST_BYTE_MS);
    try { xhr.send(file.body); }
    catch (error) { finish(reject, error); }
  });
}

const RETRYABLE = new Set(['uploadNetwork', 'uploadInterrupted', 'uploadTimeout']);

async function putBlob(file, server, base64, base64url, signal, report) {
  const endpoint = new URL(`${server}/upload`).href;
  const send = async token => {
    try { return await sendBlob(endpoint, file, token, signal, report); }
    catch (error) {
      if (signal.aborted || !RETRYABLE.has(error.code)) throw error;
      report(0);
      return await sendBlob(endpoint, file, token, signal, report);
    }
  };
  let response = await send(base64url);
  // Older Blossom implementations, including NosTube's, expect padded Base64.
  if (response.status === 401 && base64 !== base64url) {
    report(0);
    response = await send(base64);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new BlossomUploadError('uploadHttp', { status: response.status, detail: response.detail });
  }
  const { descriptor } = response;
  const url = safeUrl(descriptor?.url, ['https:']);
  if (!url || descriptor.sha256 !== file.sha256 || descriptor.size !== file.size) {
    throw new BlossomUploadError('uploadBadResponse', { detail: response.detail });
  }
  return { url: url.href, sha256: file.sha256, size: file.size, type: file.type, server };
}

export async function uploadVideo(file, thumbnail, servers, signer, pubkey, signal, onProgress = () => {}, {
  onStage = () => {},
  onFailure = () => {},
} = {}) {
  const upload = (blob, targets, phase) => uploadToServers(blob, targets, signer, pubkey, signal,
    (loaded, total) => onProgress(phase, loaded, total),
    stage => onStage(phase, stage),
    (server, error) => onFailure(phase, server, error));
  const uploaded = await upload(file, servers, 'video');
  if (!uploaded.length) throw new Error('No Blossom server accepted the video');
  const [{ server, ...video }, ...mirrors] = uploaded;
  video.fallbacks = unique(mirrors.map(blob => blob.url)).filter(url => url !== video.url);
  if (thumbnail) {
    try {
      const [image] = await upload(thumbnail, [server], 'thumbnail');
      if (image) video.image = image.url;
    } catch (error) {
      signal.throwIfAborted();
      onFailure('thumbnail', server, error);
    }
  }
  return video;
}

export function parseVideoTags(value) {
  return unique(value.split(/[,\s]+/u).map(tag => tag.replace(/^#+/, '').toLowerCase()).filter(Boolean));
}

export function buildVideoEvent({ identifier, title, description, tags, contentWarning, expiresIn, video, width, height, duration, timestamp = now() }) {
  const imeta = ['imeta', `url ${video.url}`, `m ${video.type}`, `x ${video.sha256}`, `size ${video.size}`,
    `dim ${width}x${height}`, `duration ${duration}`];
  if (video.image) imeta.push(`image ${video.image}`);
  for (const url of video.fallbacks ?? []) imeta.push(`fallback ${url}`);
  const warning = contentWarning?.trim();
  return {
    kind: height > width ? SHORT_KIND : VIDEO_KIND,
    created_at: timestamp,
    content: description.trim(),
    tags: [
      ['d', identifier], ['title', title.trim()], ['alt', description.trim() || title.trim()],
      ['published_at', String(timestamp)], ['duration', String(Math.round(duration))],
      imeta, ...tags.map(tag => ['t', tag]),
      ...(warning === undefined ? [] : [warning ? ['content-warning', warning] : ['content-warning']]),
      ...(Number.isSafeInteger(expiresIn) && expiresIn > 0 ? [['expiration', String(timestamp + expiresIn)]] : []),
      ['client', 'clip'],
    ],
  };
}

export async function signVideoEvent(draft, { signer, pubkey }, signal) {
  signal.throwIfAborted();
  return signWithDeadline(signer, pubkey, draft, signal);
}

// One accepting relay is the publication; slower or broken relays must not block a finished post.
export async function publishVideo(pool, event, relays, signal) {
  const targets = unique([...relays, VIDEO_RELAY]);
  signal.throwIfAborted();
  const responses = await untilAbort(
    pool.publish(targets, event, { timeout: 8_000 }),
    AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  );
  const accepted = responses.filter(response => response.ok);
  if (!accepted.length) {
    const detail = unique(responses.map(response => response.message).filter(Boolean)).join(' · ');
    throw Object.assign(new Error('No relay accepted the video event'), { code: 'publishFailed', detail });
  }
  const pointer = neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: accepted.slice(0, 3).map(response => response.from) });
  return { link: `https://nostu.be/v/${pointer}`, relays: accepted.length, event };
}
