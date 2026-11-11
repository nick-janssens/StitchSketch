const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const DEFAULT_ORIGINS = [
  'https://nick-janssens.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766'
];
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const BASE_PROMPT = [
  'Turn the supplied photograph into a faithful, minimalist hand-drawn contour portrait designed as a practical hand-embroidery pattern. Treat the photo as the source of truth and simplify its forms rather than redesigning the scene.',
  'Keep the exact number of visible people, whether one person or several, and preserve their recognizable appearance, relative positions, framing, pose, interaction and expression. Retain clearly visible features, hairstyles, clothing, hands and body silhouettes. Include glasses or other accessories only when they are visibly present in the photo; do not invent details that cannot be seen.',
  'Keep all people and their meaningful contact points in the composition. Show only a little background, preferably none. Do not add or remove people or objects, crop or rearrange the subjects, or invent facial features, clothing or body parts.',
  'Draw on a pure white background using clean, smooth, flowing black contours with consistent line weight. Use a small, deliberate set of mostly long connected curves: prioritize each person’s outer silhouette, essential face profile and visible eyes, nose and mouth, hair outline with only a few characteristic strands, major clothing edges, and important overlaps between people.',
  'Keep lines separated and easy to follow at a finished embroidery size of about 10 to 20 centimetres. Draw each important visual boundary once. If glasses are visible, represent each lens with one simple outline and at most a short bridge; never add inner and outer double rims, duplicate parallel strokes, lens reflections or tiny hinge details. Omit surface texture, photographic edges, shadows, shading, gray, gradients, color, fills, hatching, tiny isolated marks, dense parallel hair lines and minor folds or background detail.'
].join(' ');

function originList(env) {
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...extra])];
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = origin && originList(env).includes(origin) ? origin : '';
  const headers = new Headers({
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff'
  });
  if (allowed) headers.set('Access-Control-Allow-Origin', allowed);
  return headers;
}

function jsonResponse(request, env, data, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isStartOfFrame) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function validateDimensions(value, label) {
  const dimension = Number(value);
  if (!Number.isInteger(dimension) || dimension < 256 || dimension > 1920 || dimension % 16 !== 0) {
    throw fail(`Invalid ${label}; model dimensions must be 256–1920 pixels and a multiple of 16.`);
  }
  return dimension;
}

function authorized(request, env) {
  const expected = env.APP_ACCESS_KEY;
  const supplied = request.headers.get('Authorization') || '';
  if (!expected || supplied !== `Bearer ${expected}`) return false;
  return true;
}

async function generate(request, env, headers) {
  if (!env.AI || typeof env.AI.run !== 'function') throw fail('Workers AI binding is missing. Add a Workers AI binding named AI.', 503);
  if (request.headers.get('content-length') && Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES + 30000) {
    throw fail('The prepared photo is too large. Try a smaller image.', 413);
  }

  let incoming;
  try { incoming = await request.formData(); }
  catch (_) { throw fail('Request was not valid multipart form data.'); }
  const image = incoming.get('image');
  if (!image || typeof image.arrayBuffer !== 'function') throw fail('Choose a photo before generating.');
  if (image.size <= 0 || image.size > MAX_UPLOAD_BYTES) throw fail('Prepared photo must be smaller than 4 MB.');
  if (image.type !== 'image/jpeg') throw fail('The app should send a locally prepared JPEG reference image.');

  const imageBytes = new Uint8Array(await image.arrayBuffer());
  const imageSize = jpegDimensions(imageBytes);
  if (!imageSize) throw fail('Could not read the prepared JPEG reference image.');
  if (imageSize.width >= 512 || imageSize.height >= 512) throw fail('Reference image must be smaller than 512 × 512 pixels.');

  const width = validateDimensions(incoming.get('width'), 'width');
  const height = validateDimensions(incoming.get('height'), 'height');
  const requestedMax = Number(incoming.get('maxDimension'));
  if (![512, 768, 1024].includes(requestedMax) || Math.max(width, height) > 1920) throw fail('Choose a supported output size: 512, 768 or 1024 pixels.');

  const modelInput = new FormData();
  const extra = String(incoming.get('extraPrompt') || '').trim().slice(0, 400);
  const prompt = extra ? `${BASE_PROMPT} Additional user preference: ${extra}` : BASE_PROMPT;
  modelInput.append('prompt', prompt);
  modelInput.append('input_image_0', new Blob([imageBytes], { type: 'image/jpeg' }), 'reference.jpg');
  modelInput.append('width', String(width));
  modelInput.append('height', String(height));
  const serialized = new Response(modelInput);
  const output = await env.AI.run(MODEL, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get('content-type')
    }
  });

  if (!output || typeof output.image !== 'string' || !output.image) {
    const detail = output && (output.error || output.message);
    throw fail(detail ? `Model error: ${String(detail).slice(0, 280)}` : 'FLUX.2 returned no image. Check Worker logs and Workers AI quota.', 502);
  }
  const base64 = output.image.replace(/^data:image\/png;base64,/i, '').replace(/\s/g, '');
  let binary;
  try { binary = atob(base64); }
  catch (_) { throw fail('FLUX.2 returned an image that could not be decoded.', 502); }
  const png = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) png[index] = binary.charCodeAt(index);
  headers.set('Content-Type', 'image/png');
  headers.set('Content-Length', String(png.byteLength));
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Model', MODEL);
  return new Response(png, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && !originList(env).includes(origin)) return jsonResponse(request, env, { error: 'This website origin is not allowed by the Worker.' }, 403);

    if (request.method === 'OPTIONS') {
      if (origin && !originList(env).includes(origin)) return new Response(null, { status: 403, headers });
      return new Response(null, { status: 204, headers });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      if (!authorized(request, env)) return jsonResponse(request, env, { error: 'Access code is missing or incorrect.' }, 401);
      return jsonResponse(request, env, { ok: true, model: MODEL });
    }
    if (url.pathname !== '/generate') return jsonResponse(request, env, { error: 'Use /health or /generate.' }, 404);
    if (request.method !== 'POST') return jsonResponse(request, env, { error: 'Use POST to generate an image.' }, 405);
    if (!origin || !originList(env).includes(origin)) return jsonResponse(request, env, { error: 'A permitted browser origin is required.' }, 403);
    if (!authorized(request, env)) return jsonResponse(request, env, { error: 'Access code is missing or incorrect.' }, 401);

    try {
      return await generate(request, env, headers);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 502;
      const message = status >= 500 && !error.status ? 'Generation failed inside Workers AI. Check the Cloudflare Worker logs and daily AI quota.' : (error.message || 'Generation failed.');
      return jsonResponse(request, env, { error: message }, status);
    }
  }
};
