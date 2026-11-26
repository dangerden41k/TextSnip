(() => {
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const hint = document.getElementById('hint');
  const ACC = '#9d90ff';
  let img, dim, k, r, W, H, upscale = 2.5;
  let sel = null, start = null, finished = false;

  ov.onShot(({ bgra, width, height, upscale: u }) => {
    upscale = u || 2.5;
    // raw BGRA from the main process -> RGBA canvas (no image decoding, so this is fast)
    const u8 = new Uint8ClampedArray(bgra.byteLength);
    u8.set(bgra);
    const u32 = new Uint32Array(u8.buffer);
    for (let i = 0; i < u32.length; i++) {
      const v = u32[i];
      u32[i] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
    }
    img = document.createElement('canvas');
    img.width = width; img.height = height;
    img.getContext('2d').putImageData(new ImageData(u8, width, height), 0, 0);
    sel = null; start = null; finished = false;
    hint.classList.remove('off');
    init();
    requestAnimationFrame(() => ov.ready()); // main shows this window once the frame is painted
  });

  // Main hides this window after a capture: release the screenshot pixels so they do not linger in memory.
  ov.onWipe(() => {
    if (img) { img.width = 1; img.height = 1; }
    sel = null; start = null;
    ctx.clearRect(0, 0, cv.width, cv.height);
    cv.width = 1; cv.height = 1;
  });

  function init() {
    W = innerWidth; H = innerHeight;
    r = devicePixelRatio || 1;
    cv.width = Math.round(W * r); cv.height = Math.round(H * r);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    k = img.width / W; // source px per css px
    dim = document.createElement('canvas');
    dim.width = cv.width; dim.height = cv.height;
    const d = dim.getContext('2d');
    d.drawImage(img, 0, 0, cv.width, cv.height);
    d.fillStyle = 'rgba(10,9,12,.58)';
    d.fillRect(0, 0, cv.width, cv.height);
    draw();
  }

  function base() {
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.drawImage(dim, 0, 0, W, H);
  }

  function draw() {
    base();
    if (!sel) return;
    ctx.drawImage(img, sel.x * k, sel.y * k, sel.w * k, sel.h * k, sel.x, sel.y, sel.w, sel.h);
    ctx.strokeStyle = ACC; ctx.lineWidth = 1.5;
    ctx.strokeRect(sel.x + .5, sel.y + .5, sel.w, sel.h);
    ctx.fillStyle = ACC;
    for (const [hx, hy] of [[sel.x, sel.y], [sel.x + sel.w, sel.y], [sel.x, sel.y + sel.h], [sel.x + sel.w, sel.y + sel.h]]) {
      ctx.fillRect(hx - 3, hy - 3, 7, 7);
    }
    const label = `${Math.round(sel.w * k)} × ${Math.round(sel.h * k)}`;
    ctx.font = '600 12px "Segoe UI",system-ui,sans-serif';
    const tw = ctx.measureText(label).width + 16;
    const ly = sel.y > 30 ? sel.y - 28 : sel.y + sel.h + 8;
    ctx.fillStyle = ACC; ctx.fillRect(sel.x, ly, tw, 22);
    ctx.fillStyle = '#15121f'; ctx.fillText(label, sel.x + 8, ly + 15);
  }

  addEventListener('mousedown', (e) => {
    if (finished) return;
    if (e.button === 2) return ov.cancel();
    start = { x: e.clientX, y: e.clientY };
    sel = { x: start.x, y: start.y, w: 0, h: 0 };
    hint.classList.add('off');
  });
  addEventListener('mousemove', (e) => {
    if (!start || finished) return;
    sel = {
      x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY),
      w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y),
    };
    draw();
  });
  addEventListener('mouseup', () => {
    if (!start || finished) return;
    start = null;
    if (sel.w < 6 || sel.h < 6) { sel = null; hint.classList.remove('off'); draw(); return; }
    finish();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') ov.cancel(); });
  addEventListener('contextmenu', (e) => { e.preventDefault(); ov.cancel(); });

  // Crop -> upscale -> grayscale -> auto-invert dark themes -> stretch contrast.
  function prepare(src) {
    const maxDim = 3600;
    const s = Math.max(1, Math.min(upscale, maxDim / Math.max(src.width, src.height)));
    const c = document.createElement('canvas');
    const pad = Math.max(12, Math.round(7 * s)); // white margin: text touching the edge is read badly
    const iw = Math.round(src.width * s), ih = Math.round(src.height * s);
    c.width = iw + 2 * pad; c.height = ih + 2 * pad;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, src.width, src.height, pad, pad, iw, ih);
    const id = g.getImageData(pad, pad, iw, ih), p = id.data;
    const hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) {
      const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0;
      p[i] = y; hist[y]++; sum += y;
    }
    const n = p.length / 4, invert = sum / n < 110;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < p.length; i += 4) {
      let v = Math.max(0, Math.min(255, ((p[i] - lo) * 255) / span));
      if (invert) v = 255 - v;
      p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
    }
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.putImageData(id, pad, pad);
    return c;
  }

  function finish() {
    finished = true;
    const crop = document.createElement('canvas');
    crop.width = Math.round(sel.w * k); crop.height = Math.round(sel.h * k);
    crop.getContext('2d').drawImage(img, sel.x * k, sel.y * k, sel.w * k, sel.h * k, 0, 0, crop.width, crop.height);
    ov.selected(prepare(crop).toDataURL('image/png'));
    dissolve();
  }

  // The selected region breaks into cubes and drifts away while OCR runs.
  function dissolve() {
    const S = 9, cubes = [];
    for (let gy = 0; gy < sel.h; gy += S) {
      for (let gx = 0; gx < sel.w; gx += S) {
        cubes.push({
          gx, gy, d: Math.random() * 0.45 + (gx / sel.w) * 0.25,
          vx: 30 + Math.random() * 90, vy: -20 - Math.random() * 80,
        });
      }
    }
    const t0 = performance.now(), dur = 620;
    const ease = (p) => p * p * (3 - 2 * p);
    (function frame(now) {
      const t = Math.min(1, (now - t0) / dur);
      base();
      for (const c of cubes) {
        const p = Math.max(0, Math.min(1, (t - c.d * 0.6) / 0.4)), e = ease(p);
        const sz = Math.min(S, sel.w - c.gx, sel.h - c.gy) * (1 - 0.65 * e);
        if (sz <= 0.3) continue;
        ctx.globalAlpha = 1 - e;
        ctx.drawImage(img, (sel.x + c.gx) * k, (sel.y + c.gy) * k, S * k, S * k,
          sel.x + c.gx + e * c.vx + (S - sz) / 2, sel.y + c.gy + e * c.vy + (S - sz) / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      if (t < 1) requestAnimationFrame(frame); else ov.close();
    })(t0);
    setTimeout(() => ov.close(), 1600); // safety net
  }
})();
