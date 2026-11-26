// Quiet pixel dust drifting behind the UI.
(() => {
  const cv = document.getElementById('dust'), ctx = cv.getContext('2d');
  let W, H, parts = [], on = true, raf = 0;
  const color = () => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#9d90ff';

  function resize() {
    const r = devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    cv.width = W * r; cv.height = H * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    parts = Array.from({ length: Math.round((W * H) / 9000) }, () => spawn(true));
  }
  function spawn(any) {
    return {
      x: Math.random() * W, y: any ? Math.random() * H : H + 4,
      s: Math.random() < 0.15 ? 3 : 2, v: 0.08 + Math.random() * 0.22,
      a: 0.08 + Math.random() * 0.3, ph: Math.random() * 6.28,
    };
  }
  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color();
    for (const p of parts) {
      p.y -= p.v; p.x += Math.sin(t / 3000 + p.ph) * 0.08;
      if (p.y < -4) Object.assign(p, spawn(false));
      ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(t / 900 + p.ph));
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;
    raf = on && !document.hidden ? requestAnimationFrame(frame) : 0;
  }
  window.Dust = {
    set(v) { on = v; cv.style.display = v ? '' : 'none'; if (v && !raf) raf = requestAnimationFrame(frame); },
  };
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && on && !raf) raf = requestAnimationFrame(frame); });
  resize();
  raf = requestAnimationFrame(frame);
})();
