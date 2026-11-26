// Cube dissolve: snapshot an element, split it into cubes, scatter / assemble them.
(() => {
  const CUBE = 9;
  const DPR = Math.min(devicePixelRatio || 1, 2);
  const ease = (p) => p * p * (3 - 2 * p);

  async function snap(el) {
    const id = 's' + Math.random().toString(36).slice(2);
    el.dataset.snap = id;
    try {
      return await html2canvas(el, {
        backgroundColor: null, scale: DPR, logging: false,
        onclone: (doc) => doc.querySelector(`[data-snap="${id}"]`).classList.add('on', 'snap'),
      });
    } finally { delete el.dataset.snap; }
  }

  // mode "out": element turns into cubes that fly away. "in": cubes fly back and assemble.
  function play(shot, rect, mode, dur) {
    const px = Math.max(4, Math.round(CUBE * DPR));
    const cols = Math.ceil(shot.width / px), rows = Math.ceil(shot.height / px);
    const data = shot.getContext('2d').getImageData(0, 0, shot.width, shot.height).data;
    const solid = (x, y) => data[((Math.min(shot.height - 1, y)) * shot.width + Math.min(shot.width - 1, x)) * 4 + 3] > 6;
    const cubes = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * px, y = r * px, h = px >> 1;
        if (!(solid(x + h, y + h) || solid(x + 1, y + 1) || solid(x + px - 2, y + px - 2) || solid(x + 1, y + px - 2) || solid(x + px - 2, y + 1))) continue;
        cubes.push({
          x, y, d: Math.random() * 0.5 + (c / cols) * 0.3,
          vx: (20 + Math.random() * 110) * DPR, vy: (-60 + Math.random() * 90) * DPR,
        });
      }
    }
    const cv = document.createElement('canvas');
    cv.width = shot.width; cv.height = shot.height;
    Object.assign(cv.style, {
      position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px', pointerEvents: 'none', zIndex: 60,
    });
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');

    return new Promise((resolve) => {
      const t0 = performance.now();
      let finished = false;
      const end = () => { if (finished) return; finished = true; cv.remove(); resolve(); };
      const draw = (now) => {
        if (finished) return;
        const raw = Math.min(1, (now - t0) / dur);
        const t = mode === 'in' ? 1 - raw : raw;
        ctx.clearRect(0, 0, cv.width, cv.height);
        for (const c of cubes) {
          const p = Math.max(0, Math.min(1, (t - c.d * 0.6) / 0.4)), e = ease(p);
          if (e >= 1) continue;
          const sz = px * (1 - 0.65 * e);
          ctx.globalAlpha = 1 - e;
          ctx.drawImage(shot, c.x, c.y, px, px, c.x + e * c.vx + (px - sz) / 2, c.y + e * c.vy + (px - sz) / 2, sz, sz);
        }
        ctx.globalAlpha = 1;
        if (raw < 1) requestAnimationFrame(draw); else end();
      };
      draw(t0);
      setTimeout(end, dur + 2000); // never hang if the window is hidden
    });
  }

  window.Fx = { snap, play };
})();
