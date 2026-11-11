(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { photo: null, sourceUrl: '', resultUrl: '', resultBlob: null, busy: false };
  const elements = {
    file: $('photo-file'), uploadZone: $('upload-zone'), previewGrid: $('preview-grid'),
    original: $('original-preview'), result: $('result-preview'), emptyResult: document.querySelector('.empty-result'),
    sourceDimensions: $('source-dimensions'), outputDimensions: $('output-dimensions'),
    workerUrl: $('worker-url'), accessKey: $('access-key'), saveSettings: $('save-settings'),
    checkConnection: $('check-connection'), connectionStatus: $('connection-status'),
    consent: $('photo-consent'), generate: $('generate-button'), status: $('generation-status'),
    download: $('download-button'), outputSize: $('output-size'), extraPrompt: $('extra-prompt')
  };
  const SETTINGS_KEY = 'stitchsketch-flux-worker-settings-v1';
  const DEFAULT_WORKER_URL = 'https://old-morning-4019.janssens-nick.workers.dev';

  function setStatus(message, kind = '') {
    elements.status.textContent = message;
    elements.status.className = `status-line${kind ? ` ${kind}` : ''}`;
  }

  function setConnectionStatus(message, kind = '') {
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.className = `connection-status${kind ? ` ${kind}` : ''}`;
  }

  function clearResult() {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = '';
    state.resultBlob = null;
    elements.result.removeAttribute('src');
    elements.result.hidden = true;
    elements.emptyResult.hidden = false;
    elements.outputDimensions.textContent = '';
    elements.download.hidden = true;
  }

  function refreshGenerateEnabled() {
    elements.generate.disabled = !state.photo || !elements.consent.checked || state.busy;
  }

  function normalizedWorkerUrl(value) {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error('Use an HTTPS Worker URL. HTTP is allowed only for local testing.');
    }
    return parsed.href.replace(/\/+$/, '');
  }

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      elements.workerUrl.value = saved.url || DEFAULT_WORKER_URL;
      if (saved.key) elements.accessKey.value = saved.key;
    } catch (_) {
      localStorage.removeItem(SETTINGS_KEY);
    }
    if (!elements.workerUrl.value || !elements.accessKey.value) {
      $('connection-settings').open = true;
    }
  }

  function saveSettings() {
    try {
      const url = normalizedWorkerUrl(elements.workerUrl.value);
      const key = elements.accessKey.value.trim();
      if (!key) throw new Error('Enter the app access code.');
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url, key }));
      elements.workerUrl.value = url;
      setConnectionStatus('Connection details saved in this browser.', 'success');
      if (!state.photo) setStatus('Connection saved. Choose a photo to begin.');
    } catch (error) {
      setConnectionStatus(error.message || 'Could not save connection details.', 'error');
    }
  }

  function getSettings() {
    let url;
    try { url = normalizedWorkerUrl(elements.workerUrl.value); }
    catch (error) { throw new Error(error.message || 'Enter a valid Worker URL.'); }
    const key = elements.accessKey.value.trim();
    if (!key) throw new Error('Enter the app access code in Cloudflare Worker connection.');
    return { url, key };
  }

  async function fetchWithAuth(url, key, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${key}` }
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      let detail = `Request failed (${response.status}).`;
      if (contentType.includes('application/json')) {
        try { const body = await response.json(); detail = body.error || body.message || detail; } catch (_) { /* retain status */ }
      } else {
        try { detail = (await response.text()).slice(0, 280) || detail; } catch (_) { /* retain status */ }
      }
      throw new Error(detail);
    }
    return response;
  }

  async function checkConnection() {
    setConnectionStatus('Checking Worker…');
    try {
      const { url, key } = getSettings();
      const response = await fetchWithAuth(`${url}/health`, key, { method: 'GET' });
      const data = await response.json();
      setConnectionStatus(data.model ? `Connected · ${data.model}` : 'Worker is responding.', 'success');
      if (!state.photo) setStatus('Worker connected. Choose a photo to begin.');
    } catch (error) {
      setConnectionStatus(error.message || 'Could not reach the Worker.', 'error');
    }
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser could not open the selected photo. Choose a JPG or PNG.')); };
      img.src = url;
    });
  }

  async function prepareReferenceImage(file) {
    const { img, url } = await loadImage(file);
    const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) { URL.revokeObjectURL(url); throw new Error('Could not prepare the reference photo in this browser.'); }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    URL.revokeObjectURL(url);
    if (!blob) throw new Error('Could not prepare the photo. Try a different image.');
    return { blob, width, height };
  }

  function outputDimensions(width, height, selectedMaximum) {
    let scale = selectedMaximum / Math.max(width, height);
    const shortSide = Math.min(width, height) * scale;
    if (shortSide < 256) scale = 256 / Math.min(width, height);
    if (Math.max(width, height) * scale > 1920) scale = 1920 / Math.max(width, height);
    const outWidth = Math.max(256, Math.min(1920, Math.round((width * scale) / 16) * 16));
    const outHeight = Math.max(256, Math.min(1920, Math.round((height * scale) / 16) * 16));
    return { width: outWidth, height: outHeight };
  }

  async function handlePhoto(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Choose an image file to continue.', 'error');
      return;
    }
    clearResult();
    elements.uploadZone.classList.add('loading');
    setStatus('Preparing a local preview…');
    try {
      const { img, url } = await loadImage(file);
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      state.photo = file;
      state.sourceUrl = url;
      elements.original.src = url;
      elements.sourceDimensions.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      elements.previewGrid.hidden = false;
      elements.uploadZone.classList.remove('loading');
      refreshGenerateEnabled();
      setStatus('Photo ready. Review the upload notice, then generate.');
    } catch (error) {
      elements.uploadZone.classList.remove('loading');
      state.photo = null;
      refreshGenerateEnabled();
      setStatus(error.message || 'Could not open that image.', 'error');
    }
  }

  async function generate() {
    if (!state.photo || state.busy) return;
    if (!elements.consent.checked) return setStatus('Confirm the photo upload notice before generating.', 'error');
    let settings;
    try { settings = getSettings(); }
    catch (error) {
      $('connection-settings').open = true;
      setStatus(error.message, 'error');
      return;
    }
    state.busy = true;
    refreshGenerateEnabled();
    clearResult();
    elements.generate.querySelector('span:first-child').textContent = 'Generating…';
    const startedAt = performance.now();
    setStatus('Preparing a small reference image locally…');
    try {
      const reference = await prepareReferenceImage(state.photo);
      const size = outputDimensions(reference.width, reference.height, Number(elements.outputSize.value));
      const form = new FormData();
      form.append('image', reference.blob, 'reference.jpg');
      form.append('width', String(size.width));
      form.append('height', String(size.height));
      form.append('maxDimension', elements.outputSize.value);
      form.append('extraPrompt', elements.extraPrompt.value.trim().slice(0, 400));
      setStatus('Sending the reference to Cloudflare and generating the drawing…');
      const response = await fetchWithAuth(`${settings.url}/generate`, settings.key, { method: 'POST', body: form });
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('The Worker returned a response that was not an image.');
      state.resultBlob = blob;
      state.resultUrl = URL.createObjectURL(blob);
      elements.result.src = state.resultUrl;
      elements.result.hidden = false;
      elements.emptyResult.hidden = true;
      elements.outputDimensions.textContent = `${size.width} × ${size.height}`;
      elements.download.hidden = false;
      const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
      setStatus(`Drawing generated in ${elapsed} seconds · reference resized to ${reference.width} × ${reference.height}.`, 'success');
    } catch (error) {
      setStatus(error.message || 'Generation failed. Check the Worker URL, connection and access code.', 'error');
    } finally {
      state.busy = false;
      elements.generate.querySelector('span:first-child').textContent = 'Generate drawing';
      refreshGenerateEnabled();
    }
  }

  function downloadResult() {
    if (!state.resultUrl) return;
    const link = document.createElement('a');
    link.href = state.resultUrl;
    link.download = `stitchsketch-flux-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  elements.file.addEventListener('change', (event) => handlePhoto(event.target.files && event.target.files[0]));
  elements.consent.addEventListener('change', refreshGenerateEnabled);
  elements.generate.addEventListener('click', generate);
  elements.download.addEventListener('click', downloadResult);
  elements.saveSettings.addEventListener('click', saveSettings);
  elements.checkConnection.addEventListener('click', checkConnection);
  elements.workerUrl.addEventListener('input', () => setConnectionStatus('Unsaved connection changes.'));
  elements.accessKey.addEventListener('input', () => setConnectionStatus('Unsaved connection changes.'));
  readSettings();
  refreshGenerateEnabled();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
