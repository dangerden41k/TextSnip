'use strict';
// QR codes and 1D barcodes (EAN, Code 128/39, ...) decoded offline with @zxing/library.
const {
  MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType, BarcodeFormat,
} = require('@zxing/library');

const hints = new Map();
hints.set(DecodeHintType.TRY_HARDER, true);
const reader = new MultiFormatReader();
reader.setHints(hints);

// gray: Uint8Array W*H (0..255). Returns [{format, text}] (empty if nothing found).
function decode(gray, width, height) {
  const lum = new Uint8ClampedArray(width * height);
  lum.set(gray);
  const found = [];
  // Try the picture as is, then inverted (light-on-dark codes).
  for (const invert of [false, true]) {
    const data = invert ? lum.map((v) => 255 - v) : lum;
    try {
      const res = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(data, width, height))));
      found.push({ format: BarcodeFormat[res.getBarcodeFormat()], text: res.getText() });
      break;
    } catch (e) { /* NotFound: try next */ }
  }
  return found;
}

module.exports = { decode };
