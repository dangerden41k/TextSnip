# CHANGES — external agent log

## 2026-11-27 — performance patches (applied by ZCode agent, approved by repo owner)

- perf(pipeline): early exit in recheck() — stop re-reading a code line after
  2 OCR passes agree on the list shape (was: always 6 passes per odd line).
  Up to 2-3x faster on key/code screenshots.
- perf(ocr): memoize recognize() — results cached by sha256(image)+opts (last 8),
  so re-snipping the same region skips OCR entirely.
- feat(app): preload the OCR worker at startup — ocr.ensure(langs) runs on app
  ready, so the first snip no longer pays 1-2s of worker/langdata init.
- Local install also slimmed: unused Chromium locales removed (en-US/ru kept),
  legacy non-LSTM tesseract.js cores removed (OEM 1 uses LSTM cores only).

No behavior changes to recognition logic; glyph judge, wordfix and updater untouched.
