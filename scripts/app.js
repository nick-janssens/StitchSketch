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
const controls = {detail: $('#detail'), strength: $('#strength'), zoom: $('#zoom'), x: $('#pan-x'), y: $('#pan-y')};
let image = null, timer = 0, toastTimer = 0, renderId = 0, analysisCache = null;
const saveLabel = save.querySelector('span');

function message(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}

function updateOutputs() {
  for (const [key, element] of Object.entries(controls)) {
    const output = document.querySelector('output[for="' + element.id + '"]');
    output.value = key === 'zoom' ? element.value + '%' : element.value;
  }
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

function redraw() {
  if (!image) return;
  clearTimeout(timer);
  const currentRender = ++renderId;
  busy.hidden = false;
  save.disabled = true;
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
      save.disabled = false;
      saveLabel.textContent = 'Save drawing to Photos';
      status.textContent = 'Preview ready';
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

function setReady() {
  empty.hidden = true;
  comparison.hidden = false;
  save.disabled = true;
  saveLabel.textContent = 'Preparing drawing…';
  reset.disabled = false;
  status.textContent = 'Preparing preview…';
  for (const key of ['zoom', 'x', 'y']) controls[key].disabled = false;
  $('#crop-controls').setAttribute('aria-disabled', 'false');
}

input.addEventListener('change', () => {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    message('Please choose an image file.');
    return;
  }
  if (image) URL.revokeObjectURL(image.src);
  analysisCache = null;
  image = new Image();
  image.onload = () => {
    $('#upload-label').textContent = file.name.length > 24 ? file.name.slice(0, 21) + '…' : file.name;
    controls.zoom.value = 100;
    controls.x.value = 0;
    controls.y.value = 0;
    updateOutputs();
    setReady();
    redraw();
  };
  image.onerror = () => message('This photo could not be opened. Try a JPG or PNG copy.');
  image.src = URL.createObjectURL(file);
});

for (const element of Object.values(controls)) {
  element.addEventListener('input', () => {
    updateOutputs();
    redraw();
  });
}
styleSelect.addEventListener('change', redraw);
removeBackground.addEventListener('change', redraw);

save.addEventListener('click', async () => {
  if (!image) return;
  try {
    await saveDrawing(canvas, message);
  } catch (error) {
    if (error.name !== 'AbortError') message(error.message || 'Could not save the drawing.');
  }
});

reset.addEventListener('click', () => {
  clearTimeout(timer);
  renderId++;
  if (image) URL.revokeObjectURL(image.src);
  image = null;
  analysisCache = null;
  input.value = '';
  $('#upload-label').textContent = 'Choose a photo';
  comparison.hidden = true;
  empty.hidden = false;
  busy.hidden = true;
  save.disabled = true;
  saveLabel.textContent = 'Save drawing to Photos';
  reset.disabled = true;
  status.textContent = 'A portrait will appear here';
  for (const key of ['zoom', 'x', 'y']) controls[key].disabled = true;
  $('#crop-controls').setAttribute('aria-disabled', 'true');
});

updateOutputs();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register(new URL('../service-worker.js', import.meta.url)).catch(() => {}));
}
