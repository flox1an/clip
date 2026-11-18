import { ExtensionSigner } from 'applesauce-signers';
import { npubEncode } from 'applesauce-core/helpers/pointers';
import { renderSVG } from 'uqr';
import { buildVideoEvent, createNostrPool, createRemoteSigner, discoverAccount, pairingPermissions, parseVideoTags, publishVideo, signVideoEvent, untilAbort, uploadVideo } from './index.js';
import { probe } from '../media.js';
import { html } from '../ui.js';
import { formatNumber, t } from '../i18n/index.js';
import { formatDuration } from '../trim.js';

const SESSION_KEY = 'clip.nostrSession';

function savedSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (/^[0-9a-f]{64}$/.test(saved?.pubkey) && typeof saved.connection === 'string') return saved;
  } catch {}
  return null;
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function captureFrame(video, canvas) {
  if (video.readyState < 2 || !video.videoHeight) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.height = 480;
  canvas.width = Math.round(canvas.height * video.videoWidth / video.videoHeight);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.hidden = false;
}

export function openNostrSheet({ file, video, state, onPublished = () => {}, onClose }) {
  const dialog = html(`<dialog class="sheet nostr-sheet" aria-labelledby="nostr-title">
    <div class="nostr-scroll">
      <header class="nostr-header">
        <canvas aria-hidden="true" hidden></canvas>
        <div>
          <h2 id="nostr-title" tabindex="-1" autofocus>${t('nostr.action')}</h2>
          <div class="nostr-account" hidden>
            <span class="nostr-avatar" aria-hidden="true"><span></span><img alt="" referrerpolicy="no-referrer" hidden></span>
            <span data-account-name></span>
          </div>
          <p class="nostr-status" role="status" hidden></p>
          <button type="button" class="nostr-change" data-change hidden>${t('nostr.change')}</button>
        </div>
      </header>
      <ul class="nostr-upload-issues" data-upload-issues aria-live="polite" hidden></ul>
      <section class="nostr-signin" data-login hidden>
        <div data-pairing hidden>
          <a class="nostr-qr" data-open-signer aria-label="${t('nostr.openSigner')}">
            <span role="img" aria-label="${t('nostr.qr')}"></span>
          </a>
          <button type="button" class="sheet-cancel" data-copy>${t('nostr.copy')}</button>
          <input data-pair-uri aria-label="${t('nostr.pairLink')}" readonly hidden>
        </div>
        <button type="button" class="sheet-cancel" data-extension hidden>${t('nostr.extension')}</button>
        <button type="button" class="sheet-cancel" data-resume hidden>${t('nostr.resume')}</button>
        <button type="button" class="sheet-cancel" data-disconnect hidden>${t('nostr.disconnect')}</button>
        <details class="nostr-advanced">
          <summary>${t('nostr.advanced')}</summary>
          <form data-bunker>
            <label>${t('nostr.bunker')}<input name="bunker" type="text" placeholder="bunker://…" autocomplete="off" autocapitalize="none" spellcheck="false" required></label>
            <button type="submit" class="sheet-cancel">${t('nostr.connect')}</button>
          </form>
        </details>
      </section>
      <form id="nostr-post-form" data-post hidden>
        <label>${t('nostr.videoTitle')}<input name="title" type="text" maxlength="120" required></label>
        <label>${t('nostr.description')}<textarea name="description" rows="2" maxlength="2000"></textarea></label>
        <div class="nostr-tags">
          <label for="nostr-tag">${t('nostr.tags')}</label>
          <ul class="nostr-tag-list" data-tags aria-label="${t('nostr.tags')}"></ul>
          <div class="nostr-tag-input">
            <input id="nostr-tag" type="text" maxlength="200" placeholder="${t('nostr.tagsHint')}">
            <button type="button" data-add-tag>${t('nostr.addTag')}</button>
          </div>
        </div>
        <div class="nostr-options">
          <label class="nostr-toggle"><input name="hasWarning" type="checkbox">${t('nostr.contentWarning')}</label>
          <label data-warning-reason hidden>${t('nostr.warningReason')}
            <input name="warningReason" type="text" maxlength="120">
          </label>
          <label class="nostr-toggle"><input name="hasExpiration" type="checkbox">${t('nostr.enableExpiration')}</label>
          <label data-expiration-duration hidden>${t('nostr.expiration')}
            <select name="expiresIn">
              <option value="86400">${t('nostr.oneDay')}</option>
              <option value="604800">${t('nostr.oneWeek')}</option>
              <option value="2592000">${t('nostr.thirtyDays')}</option>
              <option value="7776000">${t('nostr.ninetyDays')}</option>
            </select>
          </label>
          <p class="nostr-note" data-expiration-note hidden>${t('nostr.expirationNote')}</p>
        </div>
        <p class="nostr-note">${t('nostr.public')}</p>
      </form>
      <details class="nostr-destinations" hidden>
        <summary>${t('nostr.destinations')} <span data-selected-count></span></summary>
        <fieldset data-blossom>
          <legend>${t('nostr.uploadTargets')}</legend>
          <div data-server-options></div>
        </fieldset>
        <dl>
          <dt>${t('nostr.outbox')}</dt><dd data-outbox></dd>
          <dt>${t('nostr.inbox')}</dt><dd data-inbox></dd>
        </dl>
      </details>
      <section class="nostr-success" data-success hidden>
        <p class="nostr-success-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7.5"/></svg>
        </p>
        <p class="nostr-success-note" data-published-note></p>
        <a class="nostr-success-link" data-view target="_blank" rel="noopener noreferrer">${t('nostr.view')}</a>
      </section>
    </div>
    <footer class="nostr-footer">
      <a class="nostr-link" data-auth target="_blank" rel="noopener noreferrer" hidden>${t('nostr.auth')}</a>
      <div class="nostr-transfer" hidden>
        <div><span id="nostr-transfer-phase"></span><span data-upload-amount></span></div>
        <progress max="100" aria-labelledby="nostr-transfer-phase"></progress>
        <div class="nostr-transfer-note" data-upload-note role="status"></div>
      </div>
      <div class="nostr-footer-actions">
        <button type="button" class="sheet-cancel" data-close>${t('cancel')}</button>
        <button type="submit" form="nostr-post-form" class="sheet-confirm" hidden>${t('nostr.submit')}</button>
      </div>
    </footer>
  </dialog>`);
  const find = selector => dialog.querySelector(selector);
  const heading = find('h2'), status = find('.nostr-status'), login = find('[data-login]');
  const pairing = find('[data-pairing]'), bunkerForm = find('[data-bunker]');
  const signerLink = find('[data-open-signer]'), pairUri = find('[data-pair-uri]');
  const identity = find('.nostr-account'), avatar = find('.nostr-avatar img');
  const post = find('[data-post]'), close = find('[data-close]');
  const auth = find('[data-auth]'), published = find('[data-success]');
  const publishedNote = find('[data-published-note]'), view = find('[data-view]');
  const scroll = find('.nostr-scroll'), submit = find('[form="nostr-post-form"]');
  const { title, description, hasWarning, warningReason, hasExpiration, expiresIn } = post.elements;
  const transfer = find('.nostr-transfer'), progress = transfer.querySelector('progress');
  const transferPhase = find('#nostr-transfer-phase'), transferAmount = find('[data-upload-amount]');
  const transferNote = find('[data-upload-note]');
  const canvas = find('canvas');
  const change = find('[data-change]'), resume = find('[data-resume]'), disconnect = find('[data-disconnect]');
  const extension = find('[data-extension]');
  const destinationsDetails = find('.nostr-destinations');
  const serverOptions = find('[data-server-options]'), selectedCount = find('[data-selected-count]');
  const uploadIssues = find('[data-upload-issues]');
  const tagInput = find('#nostr-tag'), tagList = find('[data-tags]');
  const tags = [...(state.fields?.tags ?? [])];
  title.value = state.fields?.title ?? '';
  description.value = state.fields?.description ?? '';
  hasWarning.checked = state.fields?.contentWarning !== undefined;
  warningReason.value = state.fields?.contentWarning ?? '';
  hasExpiration.checked = state.fields?.expiresIn > 0;
  expiresIn.value = String(state.fields?.expiresIn || 86400);
  hasWarning.onchange = () => {
    find('[data-warning-reason]').hidden = warningReason.disabled = !hasWarning.checked;
  };
  hasExpiration.onchange = () => {
    const inactive = !hasExpiration.checked;
    find('[data-expiration-duration]').hidden = inactive;
    find('[data-expiration-note]').hidden = inactive;
    expiresIn.disabled = inactive;
  };
  hasWarning.onchange();
  hasExpiration.onchange();
  renderTags();
  const controller = new AbortController();
  const { signal } = controller;
  const pool = createNostrPool();
  let remote, account, pairingAttempt, busy = false;
  let saved = savedSession();
  const hasExtension = Boolean(window.nostr?.getPublicKey && window.nostr?.signEvent);

  function renderTags() {
    tagList.replaceChildren(...tags.map((tag, index) => {
      const item = html('<li><span></span><button type="button">×</button></li>');
      item.firstChild.textContent = tag;
      item.lastChild.setAttribute('aria-label', t('nostr.removeTag', { tag }));
      item.lastChild.onclick = () => {
        tags.splice(index, 1);
        renderTags();
        tagInput.focus();
      };
      return item;
    }));
  }

  function addTags() {
    for (const tag of parseVideoTags(tagInput.value)) {
      if (!tags.includes(tag)) tags.push(tag);
    }
    tagInput.value = '';
    renderTags();
  }

  function clearPairing() {
    const attempt = pairingAttempt;
    pairingAttempt = null;
    if (attempt) {
      attempt.controller.abort();
      attempt.signer.close();
    }
  }

  async function startPairing() {
    if (pairingAttempt || signal.aborted) return;
    const controller = new AbortController();
    const signer = createRemoteSigner(pool, null, showAuth);
    const attempt = pairingAttempt = { controller, signer };
    try {
      const uri = signer.getNostrConnectURI({ name: 'Clip', url: location.origin, permissions: pairingPermissions() });
      signerLink.firstElementChild.innerHTML = renderSVG(uri, { border: 4 });
      signerLink.href = pairUri.value = uri;
      pairUri.hidden = true;
      pairing.hidden = false;
      await signer.waitForSigner(controller.signal);
      if (pairingAttempt !== attempt || signal.aborted) return;
      pairingAttempt = null;
      await connect('pair', signer);
    } catch {
      if (pairingAttempt !== attempt || signal.aborted) return;
      clearPairing();
      pairing.hidden = true;
      report('connectFailed');
    }
  }

  function showSigners(message = 'scan') {
    login.hidden = false;
    change.hidden = true;
    extension.hidden = !hasExtension;
    resume.hidden = disconnect.hidden = !saved;
    identity.hidden = true;
    avatar.hidden = true;
    avatar.removeAttribute('src');
    report(message);
    heading.focus();
    startPairing();
  }

  function report(key, vars) {
    status.hidden = !key;
    status.textContent = key ? t(`nostr.${key}`, vars) : '';
  }

  function selectedServers() {
    return Array.from(serverOptions.querySelectorAll('input:checked'), input => input.value);
  }

  function updateDestinations() {
    const servers = selectedServers();
    selectedCount.textContent = t('nostr.selectedServers', { count: servers.length });
    submit.disabled = busy || !servers.length;
  }

  function showDestinations({ pubkey, outbox, inbox, servers }) {
    find('[data-outbox]').textContent = outbox.join('\n') || t('nostr.none');
    find('[data-inbox]').textContent = inbox.join('\n') || t('nostr.none');
    const previous = state.uploadTargets?.pubkey === pubkey ? state.uploadTargets.servers : null;
    const matches = previous?.filter(server => servers.includes(server));
    const checked = previous && (!previous.length || matches.length) ? matches : servers.slice(0, 1);
    serverOptions.replaceChildren(...servers.map(server => {
      const label = html('<label class="nostr-toggle"><input type="checkbox"><span></span></label>');
      const input = label.firstElementChild;
      input.value = server;
      input.checked = checked.includes(server);
      label.lastElementChild.textContent = server;
      input.onchange = () => {
        state.uploadTargets = { pubkey, servers: selectedServers() };
        updateDestinations();
      };
      return label;
    }));
    find('[data-blossom]').hidden = !servers.length;
    find('[data-blossom]').disabled = Boolean(state.published);
    updateDestinations();
    destinationsDetails.hidden = false;
  }

  function clearUploadIssues() {
    uploadIssues.replaceChildren();
    uploadIssues.hidden = true;
  }

  function showUploadFailure(phase, server, error) {
    const code = ['uploadHttp', 'uploadRedirected', 'uploadBadResponse', 'uploadNetwork', 'uploadTimeout', 'uploadInterrupted', 'approvalTimeout', 'approvalFailed', 'signerRelayUnavailable'].includes(error?.code)
      ? error?.code : error?.name === 'TimeoutError' ? 'uploadTimeout' : 'uploadNetwork';
    const item = document.createElement('li');
    // How far the bytes got and what the server said separate a blocked request from a rejected one.
    const sent = error?.total ? ` · ${formatNumber(error.sent / error.total, { style: 'percent', maximumFractionDigits: 0 })}` : '';
    const detail = error?.detail ? ` · ${error.detail.slice(0, 80)}` : '';
    item.textContent = t('nostr.uploadIssue', {
      server: new URL(server).host,
      file: t(phase === 'thumbnail' ? 'nostr.previewImage' : 'nostr.videoFile'),
      reason: t(`nostr.${code}`, { status: error?.status }),
    }) + sent + detail;
    uploadIssues.append(item);
    uploadIssues.hidden = false;
  }

  function showPublished(result) {
    post.hidden = submit.hidden = destinationsDetails.hidden = true;
    find('[data-blossom]').disabled = true;
    scroll.scrollTop = 0;
    publishedNote.textContent = t('nostr.publishedNote', { count: result.relays });
    view.href = result.link;
    published.hidden = false;
    heading.textContent = t('nostr.published');
    close.textContent = t('nostr.done');
    change.hidden = true;
    report();
    heading.focus();
  }

  function showAuth(url) {
    auth.href = url;
    auth.hidden = false;
  }

  function showAccount({ pubkey, profile }) {
    const npub = npubEncode(pubkey);
    const name = profile?.display_name || profile?.name || `${npub.slice(0, 12)}…${npub.slice(-6)}`;
    find('[data-account-name]').textContent = t('nostr.account', { name });
    identity.title = npub;
    identity.hidden = false;
    avatar.hidden = true;
    avatar.removeAttribute('src');
    avatar.previousElementSibling.textContent = Array.from(name.trim())[0]?.toUpperCase() ?? 'N';
    try {
      const url = new URL(profile?.picture);
      if (url.protocol === 'https:' && !url.username && !url.password) avatar.src = url.href;
    } catch {}
    return name;
  }

  avatar.onload = () => { avatar.hidden = false; };
  avatar.onerror = () => { avatar.hidden = true; };

  async function connect(method, input) {
    if (busy || signal.aborted) return;
    busy = true;
    clearPairing();
    login.hidden = true;
    auth.hidden = true;
    report('connecting');
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    try {
      let signer;
      if (method === 'extension') {
        signer = new ExtensionSigner();
      } else if (method === 'pair') {
        remote = signer = input;
      } else {
        remote = signer = createRemoteSigner(pool, input, showAuth, method === 'resume' ? saved : null);
        if (method === 'resume') await remote.open();
        else await untilAbort(remote.connect(undefined, pairingPermissions()), deadline);
      }
      const pubkey = await untilAbort(signer.getPublicKey(), deadline);
      if (method !== 'resume') {
        saved = remote ? { pubkey, connection: remote.getNbunksec() } : null;
        saveSession(saved);
        bunkerForm.elements.bunker.value = '';
      }
      auth.hidden = true;
      report('finding');
      const destinations = await discoverAccount(pool, pubkey, signal);
      account = { signer, pubkey, ...destinations };
      state.destinations = { pubkey, ...destinations };
      showDestinations(account);
      change.hidden = false;
      const name = showAccount(account);
      if (!destinations.servers.length) {
        report(destinations.outbox.length ? 'noServers' : 'noOutbox', { name });
        return;
      }
      post.hidden = submit.hidden = false;
      report();
      heading.focus();
    } catch (error) {
      if (signal.aborted) return;
      await remote?.close();
      remote = null;
      auth.hidden = true;
      showSigners(error?.code === 'signerRelayUnavailable' ? error?.code
        : method === 'extension' ? 'extensionFailed' : 'connectFailed');
    } finally {
      busy = false;
      updateDestinations();
    }
  }

  bunkerForm.onsubmit = event => {
    event.preventDefault();
    const bunker = bunkerForm.elements.bunker.value.trim();
    if (bunker) connect('bunker', bunker);
  };
  extension.onclick = () => connect('extension');
  resume.onclick = () => connect('resume');
  change.onclick = async () => {
    if (busy) return;
    busy = true;
    await remote?.close();
    remote = account = null;
    post.hidden = submit.hidden = published.hidden = destinationsDetails.hidden = true;
    scroll.scrollTop = 0;
    auth.hidden = true;
    state.published = null;
    heading.textContent = t('nostr.action');
    clearUploadIssues();
    close.textContent = t('cancel');
    busy = false;
    showSigners();
  };
  disconnect.onclick = async () => {
    if (busy || !saved) return;
    busy = true;
    clearPairing();
    pairing.hidden = true;
    const session = saved;
    saved = null;
    saveSession(null);
    resume.hidden = disconnect.hidden = true;
    let signer;
    try {
      signer = createRemoteSigner(pool, null, () => {}, session);
      await signer.open();
      await untilAbort(signer.logout(), AbortSignal.any([signal, AbortSignal.timeout(3_000)]));
    } catch {} finally {
      await signer?.close();
      busy = false;
      if (!signal.aborted) showSigners('disconnected');
    }
  };
  find('[data-add-tag]').onclick = () => {
    addTags();
    tagInput.focus();
  };
  tagInput.onkeydown = event => {
    if (event.isComposing || !['Enter', ','].includes(event.key)) return;
    event.preventDefault();
    addTags();
  };
  find('[data-copy]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(pairUri.value);
      report('copied');
    } catch {
      pairUri.hidden = false;
      pairUri.select();
    }
  };

  post.onsubmit = async event => {
    event.preventDefault();
    if (busy || !account) return;
    const servers = selectedServers();
    if (!servers.length) return;
    if (!title.value.trim()) {
      title.setCustomValidity(t('nostr.titleRequired'));
      title.reportValidity();
      return;
    }
    addTags();
    state.fields = {
      title: title.value,
      description: description.value,
      tags: [...tags],
      contentWarning: hasWarning.checked ? warningReason.value : undefined,
      expiresIn: hasExpiration.checked ? Number(expiresIn.value) : 0,
    };
    const fields = [...post.elements, ...tagList.querySelectorAll('button'), change];
    busy = true;
    find('[data-blossom]').disabled = true;
    clearUploadIssues();
    for (const field of fields) field.disabled = true;
    auth.hidden = true;
    let stage = 'upload';
    let phase, sample, lastLoaded;
    function showProgress(nextPhase, loaded, total) {
      if (signal.aborted) return;
      if (phase !== nextPhase || loaded < lastLoaded || total !== sample?.total) {
        phase = nextPhase;
        sample = null;
      }
      lastLoaded = loaded;
      transfer.hidden = false;
      transferPhase.textContent = t(nextPhase === 'thumbnail' ? 'nostr.thumbnailUpload' : 'nostr.videoUpload');
      progress.hidden = false;
      const percent = Math.floor(loaded / total * 100);
      progress.value = percent;
      transferAmount.textContent = formatNumber(percent / 100, { style: 'percent', maximumFractionDigits: 0 });
      const time = performance.now();
      sample ??= { time, loaded, total };
      const elapsed = (time - sample.time) / 1000;
      const rate = (loaded - sample.loaded) / elapsed;
      transferNote.textContent = loaded >= total ? t('nostr.uploadConfirming')
        : loaded === 0 ? t('nostr.uploadConnecting')
          : elapsed >= 1 && rate > 0 ? t('nostr.uploadRemaining', { time: formatDuration(Math.ceil((total - loaded) / rate)) })
            : '';
    }

    function showUploadStage(nextPhase, step) {
      transfer.hidden = false;
      progress.hidden = true;
      transferAmount.textContent = '';
      transferPhase.textContent = t(nextPhase === 'thumbnail' ? 'nostr.thumbnailUpload' : 'nostr.videoUpload');
      transferNote.textContent = t(step === 'approve' ? 'nostr.uploadApproval' : 'nostr.uploadPreparing');
    }

    report();
    try {
      const { signer, pubkey } = account;
      showUploadStage('video', 'prepare');
      const media = state.media ??= await untilAbort(probe(file), AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      signal.throwIfAborted();
      const destinationKey = JSON.stringify([pubkey, servers]);
      if (state.upload?.destinationKey !== destinationKey) {
        const thumbnail = canvas.hidden ? null : await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        const blob = await uploadVideo(file, thumbnail, servers, signer, pubkey, signal, showProgress, {
          onStage: showUploadStage,
          onFailure: showUploadFailure,
        });
        state.upload = { destinationKey, blob };
      }
      transfer.hidden = true;
      stage = 'sign';
      auth.hidden = true;
      report('signing');
      submit.textContent = t('nostr.waitingSignature');
      const draft = buildVideoEvent({ identifier: state.identifier, video: state.upload.blob, ...media, ...state.fields });
      const event = await signVideoEvent(draft, account, signal);
      stage = 'publish';
      report('publishing');
      submit.textContent = t('nostr.waitingPublish');
      // Closing now would leave the post half-sent and a retry would publish it twice.
      close.disabled = true;
      state.published = await publishVideo(pool, event, account.outbox, signal);
      close.disabled = false;
      showPublished(state.published);
      onPublished();
    } catch (error) {
      if (!signal.aborted) {
        const message = ['signerRelayUnavailable', 'approvalTimeout', 'approvalFailed'].includes(error?.code)
          ? error?.code : stage === 'publish' ? 'publishFailed'
            : stage === 'sign' ? (error?.name === 'TimeoutError' ? 'signTimeout' : 'signFailed') : 'uploadFailed';
        report(message);
        if (message === 'publishFailed' && error?.detail) status.textContent += ` ${error.detail.slice(0, 120)}`;
        if (!uploadIssues.hidden) destinationsDetails.open = true;
        scroll.scrollTop = 0;
      }
    } finally {
      busy = false;
      close.disabled = false;
      transfer.hidden = true;
      auth.hidden = true;
      for (const field of fields) field.disabled = false;
      find('[data-blossom]').disabled = Boolean(state.published);
      updateDestinations();
      hasWarning.onchange();
      hasExpiration.onchange();
      submit.textContent = t('nostr.submit');
    }
  };
  title.oninput = () => title.setCustomValidity('');
  close.onclick = () => dialog.close();
  dialog.oncancel = event => {
    if (close.disabled) event.preventDefault();
  };
  dialog.onclose = () => {
    controller.abort();
    clearPairing();
    remote?.close();
    pool.close();
    dialog.remove();
    onClose();
  };

  document.body.append(dialog);
  if (video.readyState >= 2) captureFrame(video, canvas);
  else video.addEventListener('loadeddata', () => captureFrame(video, canvas), { once: true, signal });
  dialog.showModal();
  if (state.published) {
    if (state.destinations) {
      showDestinations(state.destinations);
      showAccount(state.destinations);
    }
    showPublished(state.published);
  }
  else if (saved) connect('resume');
  else if (hasExtension) connect('extension');
  else showSigners();
}
