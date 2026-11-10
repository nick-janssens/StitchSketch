const STYLE = {
  minimalist: {percentile: 95, minimum: 70, minLength: 28, simplify: 2.5, maxPaths: 22, faceEdges: false},
  classic: {percentile: 91, minimum: 56, minLength: 17, simplify: 1.7, maxPaths: 110, faceEdges: false},
  detailed: {percentile: 86, minimum: 44, minLength: 10, simplify: 1.15, maxPaths: 210, faceEdges: false}
};

function luminance(pixels, size) {
  const gray = new Uint8Array(size * size);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    gray[p] = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) | 0;
  }
  return gray;
}

function bilateralSmooth(gray, size, detail, styleName) {
  const styleShift = styleName === 'minimalist' ? 6 : 0;
  const sigma = Math.max(34, Math.min(64, 61 - (detail - 1) * 1.7 + styleShift));
  const rangeWeight = new Float32Array(256);
  for (let d = 0; d < 256; d++) rangeWeight[d] = Math.exp(-(d * d) / (2 * sigma * sigma));
  const spatialWeight = [];
  const radius = 2;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) spatialWeight.push(Math.exp(-(dx * dx + dy * dy) / 8));
  }
  const output = new Uint8Array(gray.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x, center = gray[index];
      let sum = 0, weightSum = 0, weightIndex = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const py = y + dy;
        for (let dx = -radius; dx <= radius; dx++, weightIndex++) {
          const px = x + dx;
          if (px < 0 || px >= size || py < 0 || py >= size) continue;
          const sample = gray[py * size + px];
          const weight = spatialWeight[weightIndex] * rangeWeight[Math.abs(sample - center)];
          sum += sample * weight;
          weightSum += weight;
        }
      }
      output[index] = sum / weightSum;
    }
  }
  return output;
}

function makeForeground(source, width, height, size) {
  if (!source) return null;
  const upscaled = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = y * (height - 1) / (size - 1), y0 = Math.floor(fy), y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < size; x++) {
      const fx = x * (width - 1) / (size - 1), x0 = Math.floor(fx), x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const a = source[y0 * width + x0] * (1 - wx) + source[y0 * width + x1] * wx;
      const b = source[y1 * width + x0] * (1 - wx) + source[y1 * width + x1] * wx;
      upscaled[y * size + x] = a * (1 - wy) + b * wy;
    }
  }
  const weights = [1, 4, 6, 4, 1];
  const temp = new Float32Array(upscaled.length), output = new Float32Array(upscaled.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += upscaled[y * size + Math.max(0, Math.min(size - 1, x + k))] * weights[k + 2];
      temp[y * size + x] = sum / 16;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += temp[Math.max(0, Math.min(size - 1, y + k)) * size + x] * weights[k + 2];
      output[y * size + x] = sum / 16;
    }
  }
  return output;
}

function gradients(gray, foreground, size) {
  const n = size * size, magnitude = new Float32Array(n), thinned = new Float32Array(n);
  const gxValues = new Float32Array(n), gyValues = new Float32Array(n);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const p = y * size + x;
      const gx = -gray[p - size - 1] + gray[p - size + 1] - 2 * gray[p - 1] + 2 * gray[p + 1] - gray[p + size - 1] + gray[p + size + 1];
      const gy = -gray[p - size - 1] - 2 * gray[p - size] - gray[p - size + 1] + gray[p + size - 1] + 2 * gray[p + size] + gray[p + size + 1];
      gxValues[p] = gx;
      gyValues[p] = gy;
      magnitude[p] = Math.hypot(gx, gy);
    }
  }
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const p = y * size + x, gx = gxValues[p], gy = gyValues[p], ax = Math.abs(gx), ay = Math.abs(gy);
      let a, b;
      if (ay * 2.414 <= ax) {
        a = p - 1;
        b = p + 1;
      } else if (ax * 2.414 <= ay) {
        a = p - size;
        b = p + size;
      } else if (gx * gy > 0) {
        a = p - size - 1;
        b = p + size + 1;
      } else {
        a = p - size + 1;
        b = p + size - 1;
      }
      if (magnitude[p] >= magnitude[a] && magnitude[p] >= magnitude[b] &&
          (!foreground || foreground[p] >= 0.48)) thinned[p] = magnitude[p];
    }
  }
  return thinned;
}

function percentileThreshold(magnitudes, foreground, percentile) {
  const histogram = new Uint32Array(2048);
  let total = 0;
  for (let i = 0; i < magnitudes.length; i++) {
    if (foreground && foreground[i] < 0.82) continue;
    const value = magnitudes[i] | 0;
    if (value < 18) continue;
    histogram[Math.min(2047, value)]++;
    total++;
  }
  if (!total) return 64;
  const skip = Math.floor(total * (1 - percentile / 100));
  let accumulated = 0;
  for (let i = histogram.length - 1; i >= 0; i--) {
    accumulated += histogram[i];
    if (accumulated > skip) return i;
  }
  return 64;
}

function buildFaceRegionMask(regions, size) {
  const mask = new Uint8Array(size * size);
  for (const region of regions || []) {
    const x0 = Math.max(0, Math.floor(region.x)), y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(size, Math.ceil(region.x + region.width)), y1 = Math.min(size, Math.ceil(region.y + region.height));
    for (let y = y0; y < y1; y++) mask.fill(1, y * size + x0, y * size + x1);
  }
  return mask;
}

function hysteresis(magnitudes, foreground, faceMask, style, detail, size) {
  const n = size * size, edges = new Uint8Array(n), queue = new Int32Array(n);
  const percentile = Math.max(78, Math.min(98, style.percentile - (detail - 5) * 0.9));
  const high = Math.max(style.minimum, percentileThreshold(magnitudes, foreground, percentile) * 0.88);
  const low = high * 0.42;
  let tail = 0;
  const usable = p => {
    if (foreground && foreground[p] < 0.82) return false;
    if (faceMask && faceMask[p] && !style.faceEdges) return false;
    return true;
  };
  for (let p = 0; p < n; p++) {
    if (magnitudes[p] >= high && usable(p)) {
      edges[p] = 1;
      queue[tail++] = p;
    }
  }
  let head = 0;
  while (head < tail) {
    const p = queue[head++], x = p % size, y = (p / size) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= size) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= size) continue;
        const q = ny * size + nx;
        if (!edges[q] && magnitudes[q] >= low && usable(q)) {
          edges[q] = 1;
          queue[tail++] = q;
        }
      }
    }
  }
  return edges;
}

function edgeNeighbors(index, edgeMap, size) {
  const x = index % size, y = (index / size) | 0, output = [];
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= size) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= size) continue;
      const next = ny * size + nx;
      if (edgeMap[next]) output.push({index: next, direction: (dy + 1) * 3 + dx + 1});
    }
  }
  return output;
}

function traceEdgePaths(edgeMap, magnitudes, size) {
  const n = size * size, degree = new Uint8Array(n), visited = new Uint8Array(n * 9), paths = [];
  for (let p = 0; p < n; p++) if (edgeMap[p]) degree[p] = edgeNeighbors(p, edgeMap, size).length;
  const mark = (a, b, direction) => {
    const dx = (b % size) - (a % size), dy = ((b / size) | 0) - ((a / size) | 0);
    const reverse = (1 - dy) * 3 + (1 - dx);
    visited[a * 9 + direction] = 1;
    visited[b * 9 + reverse] = 1;
  };
  const walk = (start, first) => {
    const points = [{x: start % size, y: (start / size) | 0}];
    let previous = start, current = first.index;
    mark(start, current, first.direction);
    for (let guard = 0; guard < n; guard++) {
      points.push({x: current % size, y: (current / size) | 0});
      if (degree[current] !== 2) break;
      const options = edgeNeighbors(current, edgeMap, size).filter(item =>
        item.index !== previous && !visited[current * 9 + item.direction]);
      if (!options.length) break;
      const next = options[0];
      mark(current, next.index, next.direction);
      previous = current;
      current = next.index;
      if (current === start) {
        points.push({x: current % size, y: (current / size) | 0});
        break;
      }
    }
    let strength = 0;
    for (const point of points) strength += magnitudes[(point.y | 0) * size + (point.x | 0)];
    paths.push({points, strength: strength / Math.max(1, points.length)});
  };

  for (let p = 0; p < n; p++) {
    if (!edgeMap[p] || degree[p] === 2) continue;
    for (const next of edgeNeighbors(p, edgeMap, size)) {
      if (!visited[p * 9 + next.direction]) walk(p, next);
    }
  }
  for (let p = 0; p < n; p++) {
    if (!edgeMap[p] || !degree[p]) continue;
    const next = edgeNeighbors(p, edgeMap, size).find(item => !visited[p * 9 + item.direction]);
    if (next) walk(p, next);
  }
  return paths;
}

function pointLineDistanceSquared(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (!dx && !dy) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const x = start.x + t * dx, y = start.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]], limit = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop();
    let maximum = limit, index = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = pointLineDistanceSquared(points[i], points[start], points[end]);
      if (distance > maximum) {
        maximum = distance;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((point, index) => keep[index]);
}

function smooth(points, passes) {
  let current = points;
  for (let pass = 0; pass < passes && current.length > 4; pass++) {
    const next = [current[0]];
    for (let i = 1; i < current.length - 1; i++) {
      next.push({
        x: (current[i - 1].x + 2 * current[i].x + current[i + 1].x) / 4,
        y: (current[i - 1].y + 2 * current[i].y + current[i + 1].y) / 4
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

function joinNearbyPaths(input, minimumLength) {
  let paths = input.filter(path => path.points.length >= 3 && pathLength(path.points) >= minimumLength * 0.45);
  for (let mergeCount = 0; mergeCount < 80; mergeCount++) {
    let joined = false;
    outer: for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const a = paths[i], b = paths[j];
        for (let aEnd = 0; aEnd < 2; aEnd++) {
          const aPoint = a.points[aEnd ? a.points.length - 1 : 0];
          const aInner = a.points[aEnd ? a.points.length - 2 : 1];
          const aTangent = {x: aPoint.x - aInner.x, y: aPoint.y - aInner.y};
          for (let bEnd = 0; bEnd < 2; bEnd++) {
            const bPoint = b.points[bEnd ? b.points.length - 1 : 0];
            const bInner = b.points[bEnd ? b.points.length - 2 : 1];
            const gapX = bPoint.x - aPoint.x, gapY = bPoint.y - aPoint.y;
            const gap = Math.hypot(gapX, gapY);
            if (gap < 0.5 || gap > 4.5) continue;
            const ux = gapX / gap, uy = gapY / gap;
            const aDx = aEnd ? aTangent.x : -aTangent.x, aDy = aEnd ? aTangent.y : -aTangent.y;
            const bDx = bInner.x - bPoint.x;
            const bDy = bInner.y - bPoint.y;
            const aLength = Math.hypot(aDx, aDy) || 1, bLength = Math.hypot(bDx, bDy) || 1;
            if ((aDx * ux + aDy * uy) / aLength < 0.35 || (bDx * ux + bDy * uy) / bLength < 0.35) continue;
            const left = aEnd ? a.points : a.points.slice().reverse();
            const right = bEnd ? b.points.slice().reverse() : b.points;
            const points = left.concat(right);
            const strength = (a.strength * a.points.length + b.strength * b.points.length) / (a.points.length + b.points.length);
            paths[i] = {points, strength};
            paths.splice(j, 1);
            joined = true;
            break outer;
          }
        }
      }
    }
    if (!joined) break;
  }
  return paths;
}

function samplePoints(points, count) {
  if (points.length <= count) return points;
  const samples = [];
  for (let i = 0; i < count; i++) samples.push(points[Math.round(i * (points.length - 1) / (count - 1))]);
  return samples;
}

function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return {minX, minY, maxX, maxY};
}

function redundantPath(candidate, accepted) {
  const aBounds = candidate.bounds, bBounds = accepted.bounds, margin = 3;
  if (aBounds.maxX < bBounds.minX - margin || bBounds.maxX < aBounds.minX - margin ||
      aBounds.maxY < bBounds.minY - margin || bBounds.maxY < aBounds.minY - margin) return false;
  const a = samplePoints(candidate.points, 16), b = samplePoints(accepted.points, 32);
  let close = 0;
  const closed = Math.hypot(b[0].x - b[b.length - 1].x, b[0].y - b[b.length - 1].y) < 0.1;
  const segmentCount = Math.max(1, b.length - 1 + (closed ? 1 : 0));
  for (const point of a) {
    let nearest = Infinity;
    for (let i = 0; i < segmentCount; i++) {
      const next = b[(i + 1) % b.length];
      nearest = Math.min(nearest, pointLineDistanceSquared(point, b[i], next));
    }
    if (nearest <= 3.1 * 3.1) close++;
  }
  return close >= a.length * 0.82;
}

function traceSegments(segments) {
  const vertexMap = new Map(), points = [], links = [], edges = [];
  const vertex = point => {
    const key = Math.round(point.x * 1000) + ':' + Math.round(point.y * 1000);
    if (vertexMap.has(key)) return vertexMap.get(key);
    const id = points.length;
    vertexMap.set(key, id);
    points.push(point);
    links.push([]);
    return id;
  };
  for (const segment of segments) {
    const a = vertex(segment[0]), b = vertex(segment[1]);
    if (a === b) continue;
    const id = edges.length;
    edges.push([a, b]);
    links[a].push(id);
    links[b].push(id);
  }
  const used = new Uint8Array(edges.length), paths = [];
  const walk = (start, firstEdge) => {
    const ids = [start];
    let current = start, edge = firstEdge;
    for (let guard = 0; guard <= edges.length; guard++) {
      if (used[edge]) break;
      used[edge] = 1;
      const pair = edges[edge], next = pair[0] === current ? pair[1] : pair[0];
      ids.push(next);
      if (next === start || links[next].length !== 2) break;
      const following = links[next].find(index => !used[index]);
      if (following === undefined) break;
      current = next;
      edge = following;
    }
    if (ids.length > 2) paths.push(ids.map(id => points[id]));
  };
  for (let id = 0; id < points.length; id++) {
    if (links[id].length === 2) continue;
    for (const edge of links[id]) if (!used[edge]) walk(id, edge);
  }
  for (let edge = 0; edge < edges.length; edge++) if (!used[edge]) walk(edges[edge][0], edge);
  return paths;
}

function maskContours(mask, size) {
  if (!mask) return [];
  const segments = [];
  const crossing = (v1, v2, x1, y1, x2, y2) => {
    const t = Math.max(0, Math.min(1, (0.5 - v1) / (v2 - v1 || 1)));
    return {x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t};
  };
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const p = y * size + x, tl = mask[p], tr = mask[p + 1], br = mask[p + size + 1], bl = mask[p + size];
      const code = (tl >= 0.5 ? 1 : 0) | (tr >= 0.5 ? 2 : 0) | (br >= 0.5 ? 4 : 0) | (bl >= 0.5 ? 8 : 0);
      if (!code || code === 15) continue;
      const edges = [
        crossing(tl, tr, x, y, x + 1, y),
        crossing(tr, br, x + 1, y, x + 1, y + 1),
        crossing(bl, br, x, y + 1, x + 1, y + 1),
        crossing(tl, bl, x, y, x, y + 1)
      ];
      let pairs;
      switch (code) {
        case 1: case 14: pairs = [[3, 0]]; break;
        case 2: case 13: pairs = [[0, 1]]; break;
        case 3: case 12: pairs = [[3, 1]]; break;
        case 4: case 11: pairs = [[1, 2]]; break;
        case 5: pairs = (tl + tr + br + bl) / 4 >= 0.5 ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]]; break;
        case 6: case 9: pairs = [[0, 2]]; break;
        case 7: case 8: pairs = [[3, 2]]; break;
        case 10: pairs = (tl + tr + br + bl) / 4 >= 0.5 ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]]; break;
      }
      for (const [a, b] of pairs || []) segments.push([edges[a], edges[b]]);
    }
  }
  return traceSegments(segments);
}

function selectRasterPaths(rawPaths, style, detail) {
  const minLength = style.minLength * (1.52 - detail * 0.055);
  const selected = rawPaths.filter(path => path.points.length >= 3 &&
    pathLength(path.points) >= minLength && path.strength >= style.minimum * 0.42);
  selected.sort((a, b) => b.points.length * b.strength - a.points.length * a.strength);
  const limit = Math.max(8, Math.round(style.maxPaths * (0.75 + detail * 0.05)));
  const distinct = [];
  for (const path of selected) {
    const candidate = {points: path.points, bounds: bounds(path.points)};
    if (distinct.some(accepted => redundantPath(candidate, accepted))) continue;
    distinct.push(candidate);
    if (distinct.length >= limit) break;
  }
  return distinct;
}

function render(event) {
  const {id, size, detail, style: styleName} = event.data;
  const style = STYLE[styleName] || STYLE.classic;
  const pixels = new Uint8ClampedArray(event.data.pixels);
  const gray = bilateralSmooth(luminance(pixels, size), size, detail, styleName);
  const foreground = makeForeground(event.data.foregroundMask ? new Float32Array(event.data.foregroundMask) : null,
    event.data.maskWidth || size, event.data.maskHeight || size, size);
  const faceMask = buildFaceRegionMask(event.data.faceRegions, size);
  const magnitudes = gradients(gray, foreground, size);
  const edges = hysteresis(magnitudes, foreground, faceMask, style, detail, size);
  const traced = traceEdgePaths(edges, magnitudes, size);
  const connected = joinNearbyPaths(traced, style.minLength);
  const rasterPaths = selectRasterPaths(connected, style, detail);
  const silhouettePaths = maskContours(foreground, size);
  const outputPaths = [];

  const minimumSilhouette = styleName === 'minimalist' ? 34 : styleName === 'classic' ? 26 : 20;
  let silhouettes = silhouettePaths
    .map(points => ({points, length: pathLength(points)}))
    .filter(path => path.length >= minimumSilhouette)
    .sort((a, b) => b.length - a.length);
  if (styleName === 'minimalist') silhouettes = silhouettes.slice(0, 8);
  for (const path of silhouettes) outputPaths.push(simplify(smooth(path.points, 2), style.simplify + 0.8));

  const allowedKinds = styleName === 'detailed'
    ? new Set(['face', 'brow', 'eye', 'lip', 'nose', 'iris'])
    : new Set(['face', 'brow', 'eye', 'lip', 'nose']);
  for (const feature of event.data.facePaths || []) {
    const length = pathLength(feature.points);
    const minimumFeatureLength = feature.kind === 'face' ? 20 :
      feature.kind === 'eye' ? 10 : feature.kind === 'iris' ? 18 : 8;
    if (!allowedKinds.has(feature.kind) || length < minimumFeatureLength) continue;
    outputPaths.push(simplify(smooth(feature.points, 1), style.simplify * 0.55));
  }
  for (const path of rasterPaths) outputPaths.push(simplify(smooth(path.points, 2), style.simplify));
  self.postMessage({id, paths: outputPaths});
}

self.onmessage = event => {
  try {
    render(event);
  } catch (error) {
    self.postMessage({id: event.data.id, error: error && error.message ? error.message : 'Could not trace this image.'});
  }
};
