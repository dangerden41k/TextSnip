(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SWATCHES = ['#9d90ff', '#6ea8ff', '#5fd4b0', '#ff9a8b', '#f2c14e'];
  let S, hist = [], stats = { captures: 0, fixed: 0 };
  let cur = 'home', navBusy = false, last = null, tab = 'fixed';

  // ---------- logo ----------
  function drawLogo(g) {
    const cells = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2], [2, 3], [2, 4]];
    g.innerHTML = cells.map(([x, y], i) =>
      `<rect x="${2 + x * 4}" y="${2 + y * 4}" width="3.2" height="3.2" rx=".7" fill="var(--acc)" opacity="${i % 4 === 3 ? 0.65 : 1}"/>`).join('')
      + '<rect x="20.4" y="14.4" width="2.4" height="2.4" rx=".5" fill="var(--acc)" opacity=".45"/>';
  }

  // ---------- helpers ----------
  const pretty = (acc) => (acc || '').split('+').map((k) => ({ Control: 'Ctrl', Super: 'Win' }[k] || k));
  const keysHtml = (acc) => pretty(acc).map((k) => `<i>${esc(k)}</i>`).join('');
  const hkHtml = (acc) => pretty(acc).map((k) => `<kbd>${esc(k)}</kbd>`).join('');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastT;
  function toast(text, kind = '', ms = 2600) {
    const t = $('#toast');
    t.className = kind ? kind : '';
    t.textContent = text;
    requestAnimationFrame(() => t.classList.add('on'));
    clearTimeout(toastT);
    if (kind !== 'busy') toastT = setTimeout(() => t.classList.remove('on'), ms);
  }
  let savedT;
  function flashSaved() {
    const s = $('#saved'); s.classList.add('on');
    clearTimeout(savedT); savedT = setTimeout(() => s.classList.remove('on'), 1400);
  }

  // ---------- settings ----------
  function applyLook() {
    const st = document.documentElement.style, n = parseInt(S.accent.slice(1), 16);
    const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
    st.setProperty('--acc', S.accent);
    st.setProperty('--acc-d', `rgb(${r * 0.52 | 0},${g * 0.52 | 0},${b * 0.52 | 0})`);
    st.setProperty('--acc-a', `rgba(${r},${g},${b},.14)`);
    st.setProperty('--acc-s', `rgba(${r},${g},${b},.45)`);
    Dust.set(S.dust);
  }
  async function save(patch) {
    const res = await api.setSettings(patch);
    S = res.settings;
    applyLook(); renderSettings(); renderHome();
    flashSaved();
    return res;
  }

  function renderSettings() {
    $$('[data-seg]').forEach((seg) => {
      const key = seg.dataset.seg;
      $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === String(S[key])));
    });
    $$('input[type=checkbox][data-key]').forEach((i) => { i.checked = !!S[i.dataset.key]; });
    const up = $('input[data-key=upscale]'); up.value = S.upscale; $('#o-up').textContent = `×${S.upscale}`;
    $$('.hk').forEach((b) => { if (!b.classList.contains('rec')) b.innerHTML = hkHtml(S[b.dataset.hk]); });
    if (document.activeElement !== $('#upd-repo')) $('#upd-repo').value = S.updateRepo || '';
    $('#swatches').innerHTML = SWATCHES.map((c) =>
      `<button data-c="${c}" style="background:${c}" class="${c === S.accent ? 'on' : ''}" aria-label="${c}"></button>`).join('');
  }

  function bindSettings() {
    $$('[data-seg]').forEach((seg) => seg.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const key = seg.dataset.seg;
      await save({ [key]: b.dataset.v }); // wait: S must hold the new value before the text is re-rendered
      if (key === 'mode') refix();
    }));
    $('#seg-mode').addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      await save({ mode: b.dataset.v });
      refix();
    });
    const repo = $('#upd-repo');
    repo.addEventListener('change', () => save({ updateRepo: repo.value.trim() }));
    $('#upd-check').addEventListener('click', () => api.checkUpdate());
    $('#upd-go').addEventListener('click', () => { $('#upd-go').disabled = true; api.installUpdate(); });
    $('#upd-later').addEventListener('click', () => { $('#upd').hidden = true; });
    $$('input[type=checkbox][data-key]').forEach((i) => i.addEventListener('change', () => save({ [i.dataset.key]: i.checked })));
    const up = $('input[data-key=upscale]');
    up.addEventListener('input', () => { $('#o-up').textContent = `×${up.value}`; });
    up.addEventListener('change', () => save({ upscale: Number(up.value) }));
    $('#swatches').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (b) save({ accent: b.dataset.c });
    });
    $$('.hk').forEach((b) => b.addEventListener('click', () => recordHotkey(b)));
  }

  // ---------- hotkey recording ----------
  const KEYMAP = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left',
    ArrowRight: 'Right', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\' };
  function codeToKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^F\d{1,2}$/.test(code)) return code;
    return KEYMAP[code] || null;
  }
  // Win+<key> combos that Windows keeps for itself (RegisterHotKey refuses them)
  const RESERVED = new Set(['L', 'D', 'E', 'R', 'M', 'T', 'I', 'A', 'S', 'X', 'V', 'P', 'K', 'G', 'H', 'U', 'W', 'N', 'B', 'C', 'Z', 'Tab', 'Space', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
    .map((k) => `Super+${k}`));
  function recordHotkey(btn) {
    if (btn.classList.contains('rec')) return;
    const errEl = $('#hk-err'); errEl.hidden = true;
    btn.classList.add('rec'); btn.textContent = 'Нажми сочетание… (Esc — отмена)';
    api.pauseHotkeys(true);
    const done = () => { btn.classList.remove('rec'); removeEventListener('keydown', onKey, true); api.pauseHotkeys(false); renderSettings(); };
    async function onKey(e) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return done();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const key = codeToKey(e.code);
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
      if (!key || (!mods.length && !/^F\d/.test(key))) { btn.textContent = 'Нужен Ctrl, Alt или Shift'; return; }
      const acc = [...mods, key].join('+');
      if (RESERVED.has(acc)) {
        btn.textContent = 'Занято Windows…';
        errEl.textContent = `${pretty(acc).join('+')} зарезервировано самой Windows и не отдаётся программам. Попробуй Win+Shift+${key} или Ctrl+Alt+${key}.`;
        errEl.hidden = false; return;
      }
      removeEventListener('keydown', onKey, true);
      btn.classList.remove('rec');
      api.pauseHotkeys(false);
      const res = await save({ [btn.dataset.hk]: acc });
      const bad = res.errors[btn.dataset.hk];
      if (bad) {
        errEl.textContent = bad === 'dup' ? 'Это сочетание уже занято вторым действием' : 'Сочетание занято другим приложением или не поддерживается';
        errEl.hidden = false;
      }
    }
    addEventListener('keydown', onKey, true);
  }

  // ---------- home / result ----------
  function renderHome() {
    $('#k-cap').innerHTML = keysHtml(S.hotkey);
    $$('#seg-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
    $('#s-cap').textContent = stats.captures.toLocaleString('ru-RU');
    $('#s-fix').textContent = stats.fixed.toLocaleString('ru-RU');
  }

  function diffChips(raw, fixed) {
    if ([...raw].length !== [...fixed].length) return '';
    const m = new Map(); const a = [...raw], b = [...fixed];
    a.forEach((c, i) => { if (c !== b[i]) { const k = `${c} → ${b[i]}`; m.set(k, (m.get(k) || 0) + 1); } });
    return [...m].sort((x, y) => y[1] - x[1]).slice(0, 8)
      .map(([k, n]) => `<span>${esc(k)}${n > 1 ? ` ×${n}` : ''}</span>`).join('');
  }

  let doubts = [];
  const cps = (t) => [...t];

  function renderHl() {
    const bad = new Set(doubts.map((d) => d.pos));
    $('#hl').innerHTML = cps($('#out').value).map((c, i) => (bad.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join('') + '\n';
    $('#hl').scrollTop = $('#out').scrollTop;
  }

  function renderDoubts() {
    const chars = cps($('#out').value);
    const box = $('#doubts');
    if (!doubts.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<span class="lbl">Сомнительные символы — нажми, чтобы поменять</span>' + doubts.map((d, i) =>
      `<button class="doubt" data-i="${i}">…${esc(chars.slice(Math.max(0, d.pos - 3), d.pos).join(''))}<b>${esc(chars[d.pos] ?? '')}</b>${esc(chars.slice(d.pos + 1, d.pos + 4).join(''))}… ⇄ ${esc(d.alt)}</button>`).join('');
  }

  function renderCodes(codes = []) {
    $('#codes').innerHTML = codes.map((c, i) =>
      `<div class="code">${esc(c.format.replace('_', ' '))}<span title="${esc(c.text)}">${esc(c.text)}</span><button data-i="${i}">Копировать</button></div>`).join('');
  }

  function showResult(item) {
    last = item;
    $('#out').value = item.text; $('#raw').value = item.raw; $('#tr').value = '';
    doubts = S.mode === 'raw' ? [] : (item.doubts || []).map((d) => ({ ...d }));
    renderHl(); renderDoubts(); renderCodes(item.codes);
    $('#diff').innerHTML = item.fromCode ? '' : diffChips(item.raw, item.text);
    $('#r-meta').textContent = item.fromCode ? 'Прочитано из кода — символы точные'
      : S.mode === 'raw' ? 'Как распознал Tesseract'
        : item.changes ? `Пересмотрено по форме: ${item.changes}` : 'Все символы подтверждены формой';
  }

  function refix() {
    if (!last) return;
    if (last.fromCode) return;
    const text = S.mode === 'raw' ? last.raw : (last.refined ?? last.raw);
    showResult({ ...last, text, changes: S.mode === 'raw' ? 0 : last.changes });
  }

  function setTab(name) {
    tab = name;
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    $('#w-out').hidden = name !== 'fixed'; $('#raw').hidden = name !== 'raw'; $('#tr').hidden = name !== 'tr';
  }

  async function animateIn(el, dur = 650) {
    if (!S.animations || document.visibilityState !== 'visible') return;
    const shot = await Fx.snap(el);
    const rect = el.getBoundingClientRect();
    el.style.visibility = 'hidden';
    await Fx.play(shot, rect, 'in', dur);
    el.style.visibility = '';
  }

  async function onResult({ item, stats: st }) {
    stats = st; renderHome(); showResult(item);
    if (S.saveHistory) { hist = [item, ...hist.filter((h) => h.id !== item.id)]; renderHistory(); }
    toast(S.autoCopy ? 'Скопировано в буфер' : 'Текст готов');
    if (cur !== 'home') await switchView('home'); else await animateIn($('#result'));
  }

  // ---------- history ----------
  function renderHistory() {
    const box = $('#hlist');
    const q = ($('#hsearch').value || '').trim().toLowerCase();
    const list = q ? hist.filter((h) => `${h.text}\n${h.raw || ''}`.toLowerCase().includes(q)) : hist;
    if (!hist.length) { box.innerHTML = '<p class="empty">Здесь появятся твои снимки</p>'; return; }
    if (!list.length) { box.innerHTML = '<p class="empty">Ничего не найдено</p>'; return; }
    box.innerHTML = list.map((h) => {
      const t = new Date(h.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      return `<div class="h-item" data-id="${esc(h.id)}"><span class="h-time">${t}</span>
        <div class="h-text" data-open>${esc(h.text)}</div>
        <div class="h-act"><button data-copy>Копировать</button><button data-del>Удалить</button></div></div>`;
    }).join('');
  }
  function bindHistory() {
    $('#hlist').addEventListener('click', async (e) => {
      const row = e.target.closest('.h-item'); if (!row) return;
      const item = hist.find((h) => h.id === Number(row.dataset.id));
      if (e.target.matches('[data-copy]')) { api.copy(item.text); toast('Скопировано'); }
      else if (e.target.matches('[data-del]')) { hist = await api.deleteHistory(item.id); renderHistory(); }
      else if (e.target.closest('[data-open]')) { showResult(item); switchView('home'); }
    });
    $('#clear').addEventListener('click', async () => { hist = await api.clearHistory(); renderHistory(); });
    $('#hsearch').addEventListener('input', renderHistory);
  }

  // ---------- view switching with cube dissolve ----------
  async function switchView(name) {
    if (navBusy || name === cur) return;
    navBusy = true;
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
    const oldEl = $('#v-' + cur), newEl = $('#v-' + name);
    try {
      if (!S.animations || document.visibilityState !== 'visible') {
        oldEl.classList.remove('on'); newEl.classList.add('on');
      } else {
        const [a, b] = await Promise.all([Fx.snap(oldEl), Fx.snap(newEl)]);
        const ro = oldEl.getBoundingClientRect();
        oldEl.classList.remove('on'); newEl.classList.add('on'); newEl.style.visibility = 'hidden';
        const rn = newEl.getBoundingClientRect();
        const out = Fx.play(a, ro, 'out', 520);
        const inn = sleep(240).then(() => Fx.play(b, rn, 'in', 720));
        await Promise.all([out, inn]);
        newEl.style.visibility = '';
      }
      cur = name;
    } finally { navBusy = false; }
  }

  // ---------- init ----------
  async function init() {
    drawLogo($('#logo-g')); drawLogo($('#splash-g'));
    const st = await api.state();
    S = st.settings; hist = st.history; stats = st.stats;
    $('#ver').textContent = 'v' + st.version; $('#cur-ver').textContent = st.version;
    applyLook(); bindSettings(); bindHistory(); renderSettings(); renderHome(); renderHistory();

    $$('#nav button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
    $('#go').addEventListener('click', () => api.capture());
    // pictures that are already there: clipboard, Ctrl+V, drag and drop (PNG / JPG)
    const sendFile = async (f) => {
      if (!/^image\/(png|jpeg)$/.test(f.type)) { toast('Поддерживаются PNG и JPG', 'warn'); return; }
      toast('Распознаю…', 'busy');
      await api.ocrImage(await f.arrayBuffer());
    };
    const firstImage = (list) => [...(list || [])].find((f) => /^image\//.test(f.type));
    $('#paste').addEventListener('click', () => api.ocrClipboard());
    document.addEventListener('paste', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement && document.activeElement.tagName)) return;
      const f = firstImage(e.clipboardData && e.clipboardData.files);
      if (f) { e.preventDefault(); sendFile(f); } else api.ocrClipboard();
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { e.preventDefault(); const f = firstImage(e.dataTransfer && e.dataTransfer.files); if (f) sendFile(f); });
    $('#copy').addEventListener('click', () => { api.copy($('#out').value); toast('Скопировано'); });
    $('#wmin').addEventListener('click', () => api.minimize());
    $('#wclose').addEventListener('click', () => api.close());
    $$('.tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#doubts').addEventListener('click', (e) => {
      const b = e.target.closest('.doubt'); if (!b) return;
      const d = doubts[Number(b.dataset.i)], chars = cps($('#out').value);
      chars[d.pos] = d.alt; [d.ch, d.alt] = [d.alt, d.ch]; d.conf = +(1 - d.conf).toFixed(3);
      $('#out').value = chars.join('');
      renderHl(); renderDoubts();
      if (S.autoCopy) { api.copy($('#out').value); toast('Заменено и скопировано'); }
    });
    $('#out').addEventListener('input', () => { doubts = []; renderHl(); renderDoubts(); });
    $('#out').addEventListener('scroll', () => { $('#hl').scrollTop = $('#out').scrollTop; });
    $('#codes').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !last) return;
      api.copy(last.codes[Number(b.dataset.i)].text); toast('Скопировано');
    });
    $('#translate').addEventListener('click', async () => {
      const src = $('#out').value;
      if (!src.trim()) return;
      if (!S.translateOk) {
        if (!confirm('Чтобы перевести, текст будет отправлен в интернет: в Google Translate, а если он недоступен — в MyMemory.\nНе переводи пароли и личные данные.\n\nРазрешить онлайн-перевод? Выключить можно в настройках.')) return;
        await save({ translateOk: true });
      }
      toast('Перевожу…', 'busy');
      const r = await api.translate(src);
      if (!r.ok) { toast(r.error, 'error', 4000); return; }
      $('#tr').value = r.text; setTab('tr'); toast('Готово');
    });
    if (hist[0]) showResult(hist[0]);

    api.on('update', (u) => {
      $('#upd-text').textContent = `Доступна версия ${u.version}` + (u.notes ? ` — ${u.notes.split('\n')[0].slice(0, 80)}` : '');
      $('#upd-go').disabled = false; $('#upd').hidden = false;
    });
    api.on('result', onResult);
    api.on('status', ({ kind, text }) => toast(text, kind, 4200));
    api.on('history', (h) => { hist = h; renderHistory(); });
    api.on('settings', (s) => { S = s; applyLook(); renderSettings(); renderHome(); });

    await document.fonts.ready;
    await sleep(1100);
    const sp = $('#splash');
    if (S.animations) {
      const shot = await Fx.snap(sp);
      const rect = sp.getBoundingClientRect();
      sp.style.visibility = 'hidden';
      await Fx.play(shot, rect, 'out', 1000);
    }
    sp.remove();
  }
  init();
})();
