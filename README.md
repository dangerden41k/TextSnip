# TextSnip

Screenshot-to-text for Windows. Select an area, get the text (Russian + English, QR and barcodes).
Everything runs locally; the only network features are the update check and the optional online translation.

## Recognition

- The image is normalised before OCR (flat margins and dark photo frames removed, polarity fixed, scale adapted to the glyph size) and re-read as other variants when the first result is weak; key lists are read several times and voted per character.
- The 0/O/1/I shape judge only decides inside mixed tokens and code lists; ordinary words are repaired with frequency dictionaries (`src/words.json`).
- Sources: selection, clipboard (button / Ctrl+V) and dropped PNG/JPG files. Optional: copy formats (one line / paragraphs), masking of card numbers, e-mails and tokens, delayed capture.
- Dev tools: `npm test`, `npm run smoke` (real main.js + real OCR), `npm run bench` (see `test/bench.js`).

## Privacy

- OCR, QR and barcode reading never leave your PC.
- **Online translation is off until you allow it.** When used, the text is sent to Google Translate (or MyMemory if Google fails).
- History is encrypted with Windows DPAPI and can be switched off in Settings.
- Recognized text is not shown in notifications unless you enable it.
- The update check asks `api.github.com` for the latest release of this repository.

## Releases and auto-update

1. Bump `version` in `package.json` and commit.
2. Push a tag that matches it: `git tag v1.4.2 && git push origin v1.4.2`.
3. The **Release** workflow builds `TextSnip.exe`, publishes it with `TextSnip.exe.sha256`, and the app offers the update.

The app installs an update only from a GitHub release of the configured `owner/repo` and only after the SHA-256 of the downloaded file matches.
To protect users from a compromised account: enable 2FA, protect `v*` tags in repository rules, and ideally code-sign the exe.
