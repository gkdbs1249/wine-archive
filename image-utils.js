(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ImageUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ATTEMPTS = [
    ['image/webp', 0.82],
    ['image/webp', 0.68],
    ['image/webp', 0.52],
    ['image/png', undefined],
  ];

  function encodeCanvasForStorage(canvas, maxLength = 900_000) {
    if (!canvas || typeof canvas.toDataURL !== 'function') throw new Error('Canvas is required');
    for (const [type, quality] of ATTEMPTS) {
      const dataUrl = quality === undefined ? canvas.toDataURL(type) : canvas.toDataURL(type, quality);
      if (typeof dataUrl === 'string' && dataUrl.length <= maxLength && /^data:image\/(?:webp|png|jpeg);base64,/i.test(dataUrl)) {
        return dataUrl;
      }
    }
    throw new Error('Could not compress image for storage');
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  }

  function removeConnectedBackground(imageData, threshold = 52) {
    const width = Number(imageData?.width) || 0;
    const height = Number(imageData?.height) || 0;
    const source = imageData?.data;
    if (!width || !height || !source || source.length !== width * height * 4) throw new Error('Valid ImageData is required');
    const data = new Uint8ClampedArray(source);
    const border = [];
    for (let x = 0; x < width; x += 1) border.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y += 1) border.push(y * width, y * width + width - 1);
    const red = [], green = [], blue = [];
    for (const pixel of border) {
      const offset = pixel * 4;
      red.push(data[offset]);
      green.push(data[offset + 1]);
      blue.push(data[offset + 2]);
    }
    const background = [median(red), median(green), median(blue)];
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    const matchesBackground = (pixel) => {
      const offset = pixel * 4;
      const dr = data[offset] - background[0];
      const dg = data[offset + 1] - background[1];
      const db = data[offset + 2] - background[2];
      return Math.sqrt(dr * dr + dg * dg + db * db) <= threshold;
    };
    const enqueue = (pixel) => {
      if (visited[pixel] || !matchesBackground(pixel)) return;
      visited[pixel] = 1;
      queue[tail++] = pixel;
    };
    for (const pixel of border) enqueue(pixel);
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      data[pixel * 4 + 3] = 0;
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }
    return { data, width, height };
  }

  function foregroundBounds(imageData, padding = 4) {
    const width = Number(imageData?.width) || 0;
    const height = Number(imageData?.height) || 0;
    const data = imageData?.data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return { x: 0, y: 0, width, height };
    const safePadding = Math.max(0, Number(padding) || 0);
    const x = Math.max(0, minX - safePadding);
    const y = Math.max(0, minY - safePadding);
    const right = Math.min(width, maxX + 1 + safePadding);
    const bottom = Math.min(height, maxY + 1 + safePadding);
    return { x, y, width: right - x, height: bottom - y };
  }

  function repairBottleMask(imageData, alphaThreshold = 8) {
    const width = Number(imageData?.width) || 0;
    const height = Number(imageData?.height) || 0;
    const source = imageData?.data;
    if (!width || !height || !source || source.length !== width * height * 4) throw new Error('Valid ImageData is required');
    const data = new Uint8ClampedArray(source);
    const rowEdges = [];
    for (let y = 0; y < height; y += 1) {
      let left = width;
      let right = -1;
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
        left = Math.min(left, x);
        right = x;
      }
      rowEdges.push({ left, right });
    }
    const centers = rowEdges
      .slice(Math.floor(height * 0.58), Math.ceil(height * 0.92))
      .filter(({ left, right }) => right >= left && right - left + 1 >= width * 0.15)
      .map(({ left, right }) => (left + right) / 2);
    const center = Math.round(median(centers));
    if (centers.length) {
      for (let y = 0; y < height; y += 1) {
        const { left, right } = rowEdges[y];
        if (left >= center || right <= center) continue;
        const leftRadius = center - left;
        const rightRadius = right - center;
        const nearRadius = Math.min(leftRadius, rightRadius);
        const farRadius = Math.max(leftRadius, rightRadius);
        if (nearRadius < 1 || farRadius / nearRadius < 1.15) continue;
        const radius = Math.max(1, nearRadius);
        const minX = Math.max(0, center - radius);
        const maxX = Math.min(width - 1, center + radius);
        for (let x = 0; x < minX; x += 1) data[(y * width + x) * 4 + 3] = 0;
        for (let x = maxX + 1; x < width; x += 1) data[(y * width + x) * 4 + 3] = 0;
      }
    }

    const exterior = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    const enqueue = (pixel) => {
      if (pixel < 0 || pixel >= width * height || exterior[pixel]) return;
      if (data[pixel * 4 + 3] > alphaThreshold) return;
      exterior[pixel] = 1;
      queue[tail++] = pixel;
    };
    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - width);
      if (y + 1 < height) enqueue(pixel + width);
    }
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (data[pixel * 4 + 3] <= alphaThreshold && !exterior[pixel]) data[pixel * 4 + 3] = 255;
    }
    return { data, width, height };
  }

  function isPlausibleBottleBounds(bounds, canvasWidth, canvasHeight) {
    if (!bounds || !canvasWidth || !canvasHeight) return false;
    const widthRatio = bounds.width / canvasWidth;
    const heightRatio = bounds.height / canvasHeight;
    const aspect = bounds.height / Math.max(1, bounds.width);
    return widthRatio >= 0.12 && widthRatio <= 0.9 && heightRatio >= 0.5 && heightRatio <= 0.99 && aspect >= 2 && aspect <= 9;
  }

  return { encodeCanvasForStorage, removeConnectedBackground, foregroundBounds, isPlausibleBottleBounds, repairBottleMask };
});
