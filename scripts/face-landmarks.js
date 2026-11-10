let landmarkerPromise = null;

async function createLandmarker() {
  const {FilesetResolver, FaceLandmarker} = await import('../assets/mediapipe/vision_bundle.mjs');
  const wasm = await FilesetResolver.forVisionTasks(new URL('../assets/mediapipe/wasm/', import.meta.url).href);
  const landmarker = await FaceLandmarker.createFromOptions(wasm, {
    baseOptions: {
      modelAssetPath: new URL('../assets/mediapipe/face_landmarker.task', import.meta.url).href,
      delegate: 'CPU'
    },
    runningMode: 'IMAGE',
    numFaces: 5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });
  return {landmarker, FaceLandmarker};
}

function edgeKey(a, b) {
  return a < b ? a + ':' + b : b + ':' + a;
}

function connectionPaths(connections, landmarks, width, height, kind) {
  if (!connections || !connections.length) return [];
  const graph = new Map();
  for (const connection of connections) {
    const start = Array.isArray(connection) ? connection[0] : connection.start;
    const end = Array.isArray(connection) ? connection[1] : connection.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start === end ||
        !landmarks[start] || !landmarks[end]) continue;
    if (!graph.has(start)) graph.set(start, []);
    if (!graph.has(end)) graph.set(end, []);
    graph.get(start).push(end);
    graph.get(end).push(start);
  }

  const visited = new Set();
  const output = [];
  const walk = (start, first) => {
    const ids = [start];
    let previous = start;
    let current = first;
    for (let guard = 0; guard < connections.length + 2; guard++) {
      const key = edgeKey(previous, current);
      if (visited.has(key)) break;
      visited.add(key);
      ids.push(current);
      if (current === start) break;
      const links = graph.get(current) || [];
      if (links.length !== 2) break;
      const next = links.find(id => id !== previous && !visited.has(edgeKey(current, id)));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    if (ids.length < 3) return;
    output.push({
      kind,
      points: ids.map(id => ({x: landmarks[id].x * width, y: landmarks[id].y * height}))
    });
  };

  for (const [id, links] of graph) {
    if (links.length === 2) continue;
    for (const next of links) if (!visited.has(edgeKey(id, next))) walk(id, next);
  }
  for (const [id, links] of graph) {
    for (const next of links) if (!visited.has(edgeKey(id, next))) walk(id, next);
  }
  return output;
}

export async function detectFacePaths(source) {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch(error => {
      landmarkerPromise = null;
      throw error;
    });
  }
  const {landmarker, FaceLandmarker} = await landmarkerPromise;
  const result = landmarker.detect(source);
  const paths = [];
  const regions = [];
  const groups = [
    ['face', FaceLandmarker.FACE_LANDMARKS_FACE_OVAL],
    ['brow', FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW],
    ['brow', FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW],
    ['eye', FaceLandmarker.FACE_LANDMARKS_LEFT_EYE],
    ['eye', FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE],
    ['lip', FaceLandmarker.FACE_LANDMARKS_LIPS],
    ['iris', FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS],
    ['iris', FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS]
  ];

  for (const landmarks of result.faceLandmarks || []) {
    if (!landmarks || landmarks.length < 200) continue;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const point of landmarks) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const faceWidth = (maxX - minX) * source.width;
    const faceHeight = (maxY - minY) * source.height;
    if (faceWidth < 20 || faceHeight < 20) continue;
    const pad = Math.max(2, faceWidth * 0.035);
    regions.push({
      x: minX * source.width - pad,
      y: minY * source.height - pad,
      width: faceWidth + pad * 2,
      height: faceHeight + pad * 2
    });

    for (const [kind, connections] of groups) {
      paths.push(...connectionPaths(connections, landmarks, source.width, source.height, kind));
    }
    for (const indices of [[168, 6, 197, 195, 5, 4, 1], [98, 97, 2, 326, 327]]) {
      if (indices.every(index => landmarks[index])) {
        paths.push({
          kind: 'nose',
          points: indices.map(index => ({
            x: landmarks[index].x * source.width,
            y: landmarks[index].y * source.height
          }))
        });
      }
    }
  }
  return {paths, regions};
}
