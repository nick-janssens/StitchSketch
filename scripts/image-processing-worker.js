self.onmessage = event => {
  const { id, size, detail, strength } = event.data;
  const pixels = new Uint8ClampedArray(event.data.pixels);
  const gray = new Uint8Array(size * size);
  const horizontal = new Uint8Array(size * size);
  const blurred = new Uint8Array(size * size);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    gray[p] = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) | 0;
  }

  const radius = Math.max(1, 5 - Math.round(detail / 2));
  for (let y = 0; y < size; y++) {
    let sum = 0;
    let count = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx >= 0 && dx < size) { sum += gray[y * size + dx]; count++; }
    }
    for (let x = 0; x < size; x++) {
      horizontal[y * size + x] = sum / count;
      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) { sum -= gray[y * size + removeX]; count--; }
      if (addX < size) { sum += gray[y * size + addX]; count++; }
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      if (dy >= 0 && dy < size) { sum += horizontal[dy * size + x]; count++; }
    }
    for (let y = 0; y < size; y++) {
      blurred[y * size + x] = sum / count;
      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) { sum -= horizontal[removeY * size + x]; count--; }
      if (addY < size) { sum += horizontal[addY * size + x]; count++; }
    }
  }

  const threshold = 208 - detail * 9;
  const lineStrength = strength / 10;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      const o = p * 4;
      let gx = 0;
      let gy = 0;
      if (x > 0 && x < size - 1 && y > 0 && y < size - 1) {
        gx = -blurred[p - size - 1] + blurred[p - size + 1] - 2 * blurred[p - 1] + 2 * blurred[p + 1] - blurred[p + size - 1] + blurred[p + size + 1];
        gy = -blurred[p - size - 1] - 2 * blurred[p - size] - blurred[p - size + 1] + blurred[p + size - 1] + 2 * blurred[p + size] + blurred[p + size + 1];
      }
      const magnitude = Math.hypot(gx, gy);
      const shade = Math.max(0, Math.min(255, 255 - (magnitude - threshold) * lineStrength * 1.75));
      pixels[o] = pixels[o + 1] = pixels[o + 2] = shade;
      pixels[o + 3] = 255;
    }
  }

  self.postMessage({ id, pixels: pixels.buffer }, [pixels.buffer]);
};
