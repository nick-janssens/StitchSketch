import {createCroppedCanvas, drawOutline, drawOriginal} from './image-processing.js';
import {segmentPerson} from './segmentation.js';
import {detectFacePaths} from './face-landmarks.js';
import {saveDrawing} from './export.js';

const $ = selector => document.querySelector(selector);
const input = $('#photo-input'), canvas = $('#result-canvas'), originalCanvas = $('#original-canvas');
const comparison = $('#comparison'), empty = $('#empty-state'), busy = $('#busy');
const busyLabel = busy.querySelector('span:last-child'), status = $('#preview-status');
const save = $('#save-button'), reset = $('#reset-button'), toast = $('#toast');
const removeBackground = $('#remove-background'), styleSelect = $('#drawing-style');
const modelSelect = $('#model-select'), modelNote = $('#model-note');
const aiOptions = $('#ai-options'), localOptions = $('#local-options');
const aiConsent = $('#ai-consent'), aiExtraInstructions = $('#ai-extra-instructions');
const aiGenerate = $('#generate-button'), aiAccessCode = $('#ai-access-code');
const aiConnection = $('#ai-connection'), aiConnectionStatus = $('#ai-connection-status');
const privacyStatus = $('#privacy-status').querySelector('span');
const photoPrivacyNote = $('#photo-privacy-note');
const controls = {detail: $('#detail'), strength: $('#strength'), zoom: $('#zoom'), x: $('#pan-x'), y: $('#pan-y')};
const saveLabel = save.querySelector('span');
const AI_WORKER_URL = 'https://old-morning-4019.janssens-nick.workers.dev';
const AI_SETTINGS_KEY = 'stitchsketch-flux-worker-settings-v1';
const MODEL_IDS = {
  flux4b: '@cf/black-forest-labs/flux-2-klein-4b',
  flux9b: '@cf/black-forest-labs/flux-2-klein-9b'
};
let image = null, timer = 0, toastTimer = 0, renderId = 0, analysisCache = null;
let aiBusy = false, activeRequest = null, hasResult = false;

function message(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

function updateOutputs() {
  for (const element of Object.values(controls)) {
    const output = document.querySelector('output[for="' + element.id + '"]');
    if (output) output.value = element.id === 'zoom' ? element.value + '%' : element.value;
  }
}

function isRemoteModel() {
  return modelSelect.value !== 'local';
}

function selectedModelId() {
  return MODEL_IDS[modelSelect.value] || MODEL_IDS.flux4b;
}

function readSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function savedAccessCode() {
  const saved = readSavedSettings();
  return typeof saved.key === 'string' ? saved.key : '';
}

function loadAISettings() {
  const key = savedAccessCode();
  aiAccessCode.value = key;
  if (key) {
    aiConnectionStatus.textContent = 'Access code found in this browser, including codes saved by the FLUX test.';
    aiConnection.open = false;
  } else {
    aiConnectionStatus.textContent = 'Enter the Worker access code once to enable AI drawing.';
    aiConnection.open = true;
  }
}

function saveAISettings() {
  const key = aiAccessCode.value.trim();
  if (!key) {
    aiConnectionStatus.textContent = 'Enter the Worker access code first.';
    aiConnectionStatus.className = 'ai-connection-status error';
    return;
  }
  try {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({url: AI_WORKER_URL, key}));
    aiConnectionStatus.textContent = 'Access code saved in this browser.';
    aiConnectionStatus.className = 'ai-connection-status success';
    aiConnection.open = false;
  } catch (_) {
    aiConnectionStatus.textContent = 'This browser could not save the access code. Keep it in the box while using the app.';
    aiConnectionStatus.className = 'ai-connection-status error';
  }
}

function refreshButtons() {
  aiGenerate.disabled = !image || !image.naturalWidth || !aiConsent.checked || aiBusy;
  save.disabled = !hasResult || aiBusy;
}
function cancelRemoteRequest() {
  activeRequest?.abort();
  activeRequest = null;
  aiBusy = false;
  modelSelect.disabled = false;
  aiConsent.disabled = false;
}

function setPrivacyCopy() {
  const remote = isRemoteModel();
  if (!remote) {
    privacyStatus.textContent = 'On-device · works offline';
    photoPrivacyNote.textContent = 'Photos stay on this device';
    modelNote.textContent = 'The existing line-drawing pipeline runs locally and works offline after the app is cached. Detail, line strength and background removal apply in this mode.';
    return;
  }
  privacyStatus.textContent = 'AI drawing · internet required';
  photoPrivacyNote.textContent = 'AI sends the cropped photo to Cloudflare after consent';
  modelNote.textContent = modelSelect.value === 'flux9b'
    ? 'Experimental comparison: Cloudflare describes Klein 9B as higher quality than 4B. Output is fixed at 512 × 512; 9B uses much more quota, and paid-plan usage beyond the free allowance can be billed.'
    : 'FLUX.2 Klein 4B is the default AI option. Output is fixed at 512 × 512. The cropped photo is sent to Cloudflare only after you agree and choose Generate.';
}

function clearResult() {
  canvas.width = 600;
  canvas.height = 600;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  hasResult = false;
  refreshButtons();
}

function getAnalysis(source, cropKey, includeMask) {
  if (!analysisCache || analysisCache.key !== cropKey) {
    analysisCache = {key: cropKey, mask: null, faceData: null, maskPromise: null, facePromise: null};
  }
  const entry = analysisCache;
  const jobs = [];
  if (!entry.faceData && !entry.facePromise) {
    entry.facePromise = detectFacePaths(source)
      .then(data => { entry.faceData = data; })
      .catch(error => {
        entry.faceError = error;
        entry.faceData = {paths: [], regions: []};
      })
      .finally(() => { entry.facePromise = null; });
  }
  if (!entry.faceData) jobs.push(entry.facePromise);
  if (includeMask && !entry.mask && !entry.maskPromise) {
    entry.maskPromise = segmentPerson(source)
      .then(mask => { entry.mask = mask; })
      .finally(() => { entry.maskPromise = null; });
  }
  if (includeMask && !entry.mask) jobs.push(entry.maskPromise);
  return Promise.all(jobs).then(() => entry);
}

function showRemotePreview() {
  if (!image) return;
  const crop = {zoom: +controls.zoom.value, x: +controls.x.value, y: +controls.y.value};
  const source = createCroppedCanvas(image, crop);
  drawOriginal(source, originalCanvas);
  clearResult();
  busy.hidden = true;
  if (!aiConsent.checked) {
    status.textContent = 'Review the upload notice, then agree to generate with AI.';
  } else {
    status.textContent = 'Framing ready · choose Generate AI drawing.';
  }
  saveLabel.textContent = 'Save drawing to Photos';
  refreshButtons();
}

async function redraw() {
  if (!image) return;
  clearTimeout(timer);
  const currentRender = ++renderId;
  if (isRemoteModel()) {
    showRemotePreview();
    return;
  }
  busy.hidden = false;
  save.disabled = true;
  hasResult = false;
  saveLabel.textContent = 'Preparing drawing…';
  status.textContent = 'Tracing portrait contours…';
  busyLabel.textContent = 'Finding face features and smoothing contours…';
  timer = setTimeout(async () => {
    try {
      const crop = {zoom: +controls.zoom.value, x: +controls.x.value, y: +controls.y.value};
      const source = createCroppedCanvas(image, crop);
      drawOriginal(source, originalCanvas);
      const cropKey = [crop.zoom, crop.x, crop.y].join(':');
      const analysis = await getAnalysis(source, cropKey, removeBackground.checked);
      if (currentRender !== renderId) return;
      await drawOutline(source, canvas, {
        detail: +controls.detail.value,
        strength: +controls.strength.value,
        style: styleSelect.value
      }, analysis.mask, analysis.faceData);
      if (currentRender !== renderId) return;
      busy.hidden = true;
      hasResult = true;
      save.disabled = false;
      saveLabel.textContent = 'Save drawing to Photos';
      status.textContent = 'Preview ready · on-device';
      if (analysis.faceError && !analysis.faceWarningShown) {
        analysis.faceWarningShown = true;
        message('Face guidance could not load. The drawing uses smoothed contours instead.');
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (currentRender === renderId) {
        busy.hidden = true;
        status.textContent = 'Could not make a preview';
        saveLabel.textContent = 'Try another photo';
        message(error.message || 'Could not draw this image.');
      }
    }
  }, 100);
}

function prepareAIReference(source) {
  return new Promise((resolve, reject) => {
    const reference = document.createElement('canvas');
    reference.width = 480;
    reference.height = 480;
    const context = reference.getContext('2d', {alpha: false});
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 480, 480);
    context.drawImage(source, 0, 0, 480, 480);
    reference.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not prepare the photo for AI processing.'));
    }, 'image/jpeg', 0.9);
  });
}

function loadImageBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const result = new Image();
    result.onload = () => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    result.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The AI service returned an image that could not be opened.'));
    };
    result.src = url;
  });
}

async function responseError(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const data = await response.json().catch(() => ({}));
    return data.error || `AI generation failed (${response.status}).`;
  }
  return `AI generation failed (${response.status}). Check your connection and Worker logs.`;
}

async function generateAI() {
  if (!image || aiBusy) return;
  if (!aiConsent.checked) {
    message('Agree to the photo upload notice before generating with AI.');
    return;
  }
  const key = aiAccessCode.value.trim() || savedAccessCode();
  if (!key) {
    aiConnection.open = true;
    aiConnectionStatus.textContent = 'Enter the Worker access code to continue.';
    aiConnectionStatus.className = 'ai-connection-status error';
    message('Enter the AI Worker access code first.');
    return;
  }

  const currentRender = ++renderId;
  const controller = new AbortController();
  activeRequest = controller;
  clearResult();
  aiBusy = true;
  refreshButtons();
  modelSelect.disabled = true;
  aiConsent.disabled = true;
  for (const keyName of ['zoom', 'x', 'y']) controls[keyName].disabled = true;
  $('#crop-controls').setAttribute('aria-disabled', 'true');
  busy.hidden = false;
  busyLabel.textContent = 'Preparing the crop and generating with Cloudflare AI…';
  status.textContent = `Generating with FLUX.2 Klein ${modelSelect.value === 'flux9b' ? '9B' : '4B'}…`;
  saveLabel.textContent = 'Preparing drawing…';
  const startedAt = performance.now();

  try {
    const crop = {zoom: +controls.zoom.value, x: +controls.x.value, y: +controls.y.value};
    const source = createCroppedCanvas(image, crop);
    drawOriginal(source, originalCanvas);
    const reference = await prepareAIReference(source);
    if (currentRender !== renderId) return;
    const form = new FormData();
    form.append('image', reference, 'reference.jpg');
    form.append('width', '512');
    form.append('height', '512');
    form.append('maxDimension', '512');
    form.append('extraPrompt', aiExtraInstructions.value.trim().slice(0, 400));
    const modelId = selectedModelId();
    form.append('model', modelId);
    if (modelId === MODEL_IDS.flux9b) {
      const healthResponse = await fetch(`${AI_WORKER_URL}/health`, {
        headers: {Authorization: `Bearer ${key}`},
        signal: controller.signal
      });
      if (!healthResponse.ok) throw new Error(await responseError(healthResponse));
      if (!(healthResponse.headers.get('content-type') || '').includes('application/json')) {
        throw new Error('Could not verify Klein 9B support. Check the internet connection and deploy the updated Worker.');
      }
      const health = await healthResponse.json();
      if (!Array.isArray(health.models) || !health.models.includes(modelId)) {
        throw new Error('Klein 9B is not enabled on the deployed Worker yet. Deploy the updated flux2-klein-test/worker.js, then try again.');
      }
    }
    const response = await fetch(`${AI_WORKER_URL}/generate`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${key}`},
      body: form,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(await responseError(response));
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('The Worker returned a response that was not an image.');
    const result = await loadImageBlob(blob);
    if (currentRender !== renderId) return;
    canvas.width = result.naturalWidth;
    canvas.height = result.naturalHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(result, 0, 0);
    hasResult = true;
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    status.textContent = `Preview ready · FLUX.2 Klein ${modelSelect.value === 'flux9b' ? '9B' : '4B'} · ${seconds}s`;
    saveLabel.textContent = 'Save drawing to Photos';
  } catch (error) {
    if (error.name !== 'AbortError' && currentRender === renderId) {
      status.textContent = 'Could not make an AI preview';
      saveLabel.textContent = 'Save drawing to Photos';
      message(error.message || 'AI drawing failed. Please try again.');
    }
  } finally {
    if (activeRequest === controller) activeRequest = null;
    if (currentRender === renderId) {
      aiBusy = false;
      busy.hidden = true;
      modelSelect.disabled = false;
          aiConsent.disabled = false;
      for (const keyName of ['zoom', 'x', 'y']) controls[keyName].disabled = !image;
      $('#crop-controls').setAttribute('aria-disabled', image ? 'false' : 'true');
      refreshButtons();
    }
  }
}

function setReady() {
  empty.hidden = true;
  comparison.hidden = false;
  save.disabled = true;
  hasResult = false;
  saveLabel.textContent = 'Preparing drawing…';
  reset.disabled = false;
  status.textContent = 'Preparing preview…';
  for (const key of ['zoom', 'x', 'y']) controls[key].disabled = false;
  $('#crop-controls').setAttribute('aria-disabled', 'false');
  redraw();
}

function updateModelUI() {
  const remote = isRemoteModel();
  aiOptions.hidden = !remote;
  localOptions.hidden = remote;
  setPrivacyCopy();
  if (image) redraw();
  refreshButtons();
}

input.addEventListener('change', () => {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    message('Please choose an image file.');
    return;
  }
  clearTimeout(timer);
  renderId++;
  cancelRemoteRequest();
  for (const keyName of ['zoom', 'x', 'y']) controls[keyName].disabled = true;
  $( '#crop-controls' ).setAttribute('aria-disabled', 'true');
  if (image) URL.revokeObjectURL(image.src);
  analysisCache = null;
  clearResult();
  comparison.hidden = true;
  empty.hidden = false;
  reset.disabled = true;
  busy.hidden = true;
  status.textContent = 'Loading photo…';
  const nextImage = new Image();
  image = nextImage;
  nextImage.onload = () => {
    if (image !== nextImage) return;
    $('#upload-label').textContent = file.name.length > 24 ? file.name.slice(0, 21) + '…' : file.name;
    controls.zoom.value = 100;
    controls.x.value = 0;
    controls.y.value = 0;
    updateOutputs();
    setReady();
  };
  nextImage.onerror = () => { status.textContent = 'Could not open photo'; message('This photo could not be opened. Try a JPG or PNG copy.'); };
  nextImage.src = URL.createObjectURL(file);
});

for (const element of Object.values(controls)) {
  element.addEventListener('input', () => {
    updateOutputs();
    redraw();
  });
}
styleSelect.addEventListener('change', redraw);
removeBackground.addEventListener('change', redraw);
modelSelect.addEventListener('change', updateModelUI);
aiConsent.addEventListener('change', () => {
  if (image && isRemoteModel()) showRemotePreview();
  refreshButtons();
});

$('#save-ai-settings').addEventListener('click', saveAISettings);
aiAccessCode.addEventListener('input', () => {
  aiConnectionStatus.textContent = 'Unsaved access code.';
  aiConnectionStatus.className = 'ai-connection-status';
});
aiGenerate.addEventListener('click', generateAI);

save.addEventListener('click', async () => {
  if (!hasResult) return;
  try {
    await saveDrawing(canvas, message);
  } catch (error) {
    if (error.name !== 'AbortError') message(error.message || 'Could not save the drawing.');
  }
});

reset.addEventListener('click', () => {
  clearTimeout(timer);
  renderId++;
  cancelRemoteRequest();
  if (image) URL.revokeObjectURL(image.src);
  image = null;
  analysisCache = null;
  input.value = '';
  $('#upload-label').textContent = 'Choose a photo';
  comparison.hidden = true;
  empty.hidden = false;
  busy.hidden = true;
  clearResult();
  saveLabel.textContent = 'Save drawing to Photos';
  reset.disabled = true;
  status.textContent = 'A portrait will appear here';
  for (const key of ['zoom', 'x', 'y']) controls[key].disabled = true;
  $('#crop-controls').setAttribute('aria-disabled', 'true');
  refreshButtons();
});

$('#photo-input').addEventListener('change', () => refreshButtons());
$('#save-ai-settings').addEventListener('click', () => refreshButtons());
updateOutputs();
loadAISettings();
updateModelUI();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register(new URL('../service-worker.js', import.meta.url)).catch(() => {}));
}