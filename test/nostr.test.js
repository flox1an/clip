import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyEvent } from 'applesauce-core/helpers/event';
import { PrivateKeySigner } from 'applesauce-signers';
import { EMPTY, of } from 'rxjs';
import { buildVideoEvent, createRemoteSigner, discoverAccount, parseVideoTags, publishVideo, signVideoEvent, uploadVideo } from '../src/nostr/index.js';

test('NIP-71 event is built and signed from the Blossom upload', async t => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const serverEvent = (created_at, ...servers) => signer.signEvent({
    kind: 10063, created_at, content: '', tags: servers.map(url => ['server', url]),
  });
  const relays = await signer.signEvent({
    kind: 10002, created_at: 1, content: '', tags: [['r', 'wss://read.example', 'read'], ['r', 'wss://write.example', 'write']],
  });
  const oldList = await serverEvent(1, 'https://old.example');
  const newList = await serverEvent(2, 'https://first.example', 'https://second.example/', 'https://third.example');
  const requested = [];
  const pool = {
    request: (urls, { kinds }) => {
      requested.push({ urls, kinds });
      return kinds.includes(10002) ? of(relays, oldList) : of(newList);
    },
    publish: () => assert.fail('Account discovery must not publish'),
  };
  const signal = new AbortController().signal;
  const account = { signer, pubkey, ...await discoverAccount(pool, pubkey, signal) };
  assert.deepEqual(account.servers, ['https://first.example', 'https://second.example', 'https://third.example']);
  assert.deepEqual(account.inbox, ['wss://read.example/']);
  assert.deepEqual(account.outbox, ['wss://write.example/']);
  assert.deepEqual(requested[0].kinds, [10002]);
  assert.deepEqual(requested[1], { urls: account.outbox, kinds: [0, 10063] });

  const file = new Blob(['video'], { type: 'video/mp4' });
  const attempted = [];
  const progress = [];
  const stages = [];
  const failures = [];
  globalThis.XMLHttpRequest = class {
    upload = {};
    headers = {};

    open(method, url) {
      assert.equal(method, 'PUT');
      this.responseURL = url;
    }

    setRequestHeader(name, value) { this.headers[name] = value; }

    send(body) {
      const url = this.responseURL;
      attempted.push(url);
      const auth = JSON.parse(Buffer.from(this.headers.Authorization.slice(6), 'base64url'));
      assert.equal(body.byteLength, file.size);
      assert.equal(createHash('sha256').update(Buffer.from(body)).digest('hex'), this.headers['X-SHA-256']);
      // A device clock ahead of real time must not date the ticket in the future.
      assert.ok(auth.created_at <= Math.floor(Date.now() / 1000));
      assert.equal(auth.kind, 24242);
      assert.equal(auth.pubkey, pubkey);
      assert.deepEqual(auth.tags.find(([name]) => name === 'x'), ['x', this.headers['X-SHA-256']]);
      assert.deepEqual(auth.tags.filter(([tag]) => tag === 'server'), [
        ['server', 'first.example'], ['server', 'second.example'], ['server', 'third.example'],
      ]);
      queueMicrotask(() => {
        this.upload.onprogress({ loaded: 2 });
        this.status = url.includes('first.example') ? 503 : 201;
        this.response = this.status === 201
          ? JSON.stringify({ url: url.replace('/upload', '/video.mp4'), sha256: this.headers['X-SHA-256'], size: file.size })
          : 'server unavailable';
        this.onload();
      });
    }
  };
  t.after(() => { delete globalThis.XMLHttpRequest; });

  const video = await uploadVideo(file, null, account.servers, signer, pubkey, signal, (...sample) => progress.push(sample), {
    onStage: (phase, stage) => {
      assert.equal(attempted.length, 0);
      stages.push([phase, stage]);
    },
    onFailure: (phase, server, error) => failures.push([phase, server, error.code, error.status]),
  });
  assert.deepEqual(stages, [['video', 'prepare'], ['video', 'approve']]);
  assert.deepEqual(failures, [['video', 'https://first.example', 'uploadHttp', 503]]);
  await assert.rejects(uploadVideo(file, null, account.servers, {
    signEvent() { throw new Error('Denied'); },
  }, pubkey, signal), { code: 'approvalFailed' });
  assert.deepEqual(progress[0], ['video', 0, file.size * 3]);
  assert.ok(progress.some(([, loaded, total]) => loaded > 0 && loaded < total));
  assert.deepEqual(progress.at(-1), ['video', file.size * 2, file.size * 2]);
  assert.deepEqual(attempted, ['https://first.example/upload', 'https://second.example/upload', 'https://third.example/upload']);
  const input = { identifier: 'clip-1', title: ' Test ', description: 'Description', tags: parseVideoTags('#Video, video clips'), video, width: 720, height: 1280, duration: 2.4 };
  const ordinary = buildVideoEvent({ ...input, timestamp: 10 });
  assert.ok(!ordinary.tags.some(([name]) => ['content-warning', 'expiration'].includes(name)));
  assert.ok(buildVideoEvent({ ...input, contentWarning: ' ' }).tags.some(tag => tag.length === 1 && tag[0] === 'content-warning'));
  const draft = buildVideoEvent({ ...input, timestamp: 10, contentWarning: ' Strobing lights ', expiresIn: 86400 });
  assert.ok(draft.tags.some(([name, reason]) => name === 'content-warning' && reason === 'Strobing lights'));
  assert.ok(draft.tags.some(([name, value]) => name === 'expiration' && value === '86410'));
  assert.equal(draft.kind, 34236);
  const [, ...imeta] = draft.tags.find(([name]) => name === 'imeta');
  assert.ok(imeta.includes('duration 2.4'));
  assert.ok(imeta.includes('url https://second.example/video.mp4'));
  assert.deepEqual(imeta.filter(tag => tag.startsWith('fallback ')), ['fallback https://third.example/video.mp4']);
  assert.deepEqual(draft.tags.find(([name]) => name === 'client'), ['client', 'clip']);
  assert.deepEqual(draft.tags.filter(([name]) => name === 't'), [['t', 'video'], ['t', 'clips']]);
  const signed = await signVideoEvent(draft, account, signal);
  assert.equal(signed.pubkey, pubkey);
  assert.equal(signed.kind, 34236);
  assert.equal(signed.content, draft.content);
  assert.deepEqual(signed.tags, draft.tags);
  assert.ok(verifyEvent(JSON.parse(JSON.stringify(signed))));
});

test('Blossom upload retries once when the browser drops the connection itself', async t => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const file = new Blob(['video'], { type: 'video/mp4' });
  let attempts = 0;
  globalThis.XMLHttpRequest = class {
    upload = {};
    headers = {};

    open(method, url) { this.responseURL = url; }

    setRequestHeader(name, value) { this.headers[name] = value; }

    send(body) {
      attempts += 1;
      const auth = JSON.parse(Buffer.from(this.headers.Authorization.slice(6), 'base64url'));
      queueMicrotask(() => {
        if (attempts === 1) { this.onabort(); return; }
        this.status = 201;
        this.response = JSON.stringify({
          url: 'https://blossom.example/video.mp4',
          sha256: auth.tags.find(([name]) => name === 'x')[1],
          size: body.byteLength,
        });
        this.onload();
      });
    }
  };
  t.after(() => { delete globalThis.XMLHttpRequest; });

  const video = await uploadVideo(file, null, ['https://blossom.example'], signer, pubkey, new AbortController().signal);
  assert.equal(attempts, 2);
  assert.equal(video.url, 'https://blossom.example/video.mp4');
  assert.equal(video.size, file.size);
});

test('Blossom rejections keep the reason the server sent', async t => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const file = new Blob(['video'], { type: 'video/mp4' });
  const failures = [];
  globalThis.XMLHttpRequest = class {
    upload = {};
    headers = {};

    open(method, url) { this.responseURL = url; }

    setRequestHeader(name, value) { this.headers[name] = value; }

    send() {
      queueMicrotask(() => {
        this.status = 401;
        this.response = 'invalid x tag';
        this.onload();
      });
    }
  };
  t.after(() => { delete globalThis.XMLHttpRequest; });

  await assert.rejects(uploadVideo(file, null, ['https://blossom.example'], signer, pubkey, new AbortController().signal, () => {}, {
    onFailure: (phase, server, error) => failures.push([phase, server, error.code, error.status, error.detail, error.sent, error.total]),
  }), { message: 'No Blossom server accepted the video' });
  assert.deepEqual(failures, [['video', 'https://blossom.example', 'uploadHttp', 401, 'invalid x tag', 0, file.size]]);
});

test('Publishing counts only accepting relays and links to NosTube', async () => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const draft = buildVideoEvent({
    identifier: 'demo', title: 'Demo', description: '', tags: [],
    video: { url: 'https://blossom.example/video.mp4', sha256: 'a'.repeat(64), size: 10, type: 'video/mp4' },
    width: 1080, height: 1920, duration: 5,
  });
  const event = await signVideoEvent(draft, { signer, pubkey }, new AbortController().signal);
  const sent = [];
  const pool = {
    publish: async (relays, published) => {
      sent.push([relays, published]);
      return [{ ok: false, from: 'wss://write.example/', message: 'blocked: spam' }, { ok: true, from: 'wss://relay.nostu.be/' }];
    },
  };

  const result = await publishVideo(pool, event, ['wss://write.example/'], new AbortController().signal);
  assert.deepEqual(sent, [[['wss://write.example/', 'wss://relay.nostu.be'], event]]);
  assert.equal(result.relays, 1);
  assert.match(result.link, /^https:\/\/nostu\.be\/v\/nevent1/);
});

test('Publishing fails when no relay accepts the event', async () => {
  const pool = { publish: async () => [{ ok: false, from: 'wss://write.example/', message: 'blocked: spam' }] };
  await assert.rejects(
    publishVideo(pool, { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), kind: 34236 }, ['wss://write.example/'], new AbortController().signal),
    { code: 'publishFailed', detail: 'blocked: spam' },
  );
});

test('Nostr Connect only accepts a pairing response with the URI secret', async () => {
  const remote = new PrivateKeySigner();
  const pair = createRemoteSigner({ subscription: () => EMPTY, publish: async () => [] });
  const [receiver, sender] = await Promise.all([pair.signer.getPublicKey(), remote.getPublicKey()]);
  const reply = async result => remote.signEvent({
    kind: 24133, created_at: 1, tags: [['p', receiver]],
    content: await remote.nip44.encrypt(receiver, JSON.stringify({ result })),
  });
  await pair.handleEvent(await reply('ack'));
  assert.equal(pair.remote, undefined);
  await pair.handleEvent(await reply(pair.connectSecret));
  assert.equal(pair.remote, sender);

  const restored = createRemoteSigner({ subscription: () => EMPTY }, null, () => {}, {
    pubkey: sender, connection: pair.getNbunksec(),
  });
  assert.equal(restored.clientPubkey, receiver);
  assert.equal(restored.remote, sender);
  assert.equal(await restored.getPublicKey(), sender);
  assert.equal(restored.isConnected, true);
});

test('Nostr Connect continues after the first relay accepts and reports total failure', async () => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const request = await signer.signEvent({ kind: 24133, created_at: 1, tags: [['p', pubkey]], content: '' });
  const relays = ['wss://stall.example', 'wss://healthy.example'];
  const attempted = [];
  const pair = createRemoteSigner({
    subscription: () => EMPTY,
    publish: ([relay]) => {
      attempted.push(relay);
      return relay === relays[0] ? new Promise(() => {}) : Promise.resolve([{ ok: true, from: relay }]);
    },
  });
  assert.equal((await pair.publishMethod(relays, request)).from, relays[1]);
  assert.deepEqual(attempted, relays);
  const unavailable = createRemoteSigner({ subscription: () => EMPTY, publish: async () => [{ ok: false }] });
  await assert.rejects(unavailable.publishMethod(relays, request), { code: 'signerRelayUnavailable' });
});
