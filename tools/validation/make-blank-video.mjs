// Tiny deterministic VP8/WebM fixture. A uniform RGB(35,35,35) frame encoded
// locally for this project, no people, footage, network or encoder dependency.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const vp8 = Buffer.from('UBMAnQEqQAHwAD5tNplJpCMioSAoAIANiWlu4XdhG0AJ7APfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32yYgAD+/9x1AAAAAAAAAAAAAA==', 'base64');
const bytes = value => typeof value === 'string' ? Buffer.from(value) : value;
function size(n) {
  for (let width = 1; width <= 8; width++) {
    if (BigInt(n) < (1n << BigInt(7 * width)) - 1n) {
      let value = (1n << BigInt(7 * width)) | BigInt(n);
      const out = Buffer.alloc(width);
      for (let i = width - 1; i >= 0; i--) { out[i] = Number(value & 255n); value >>= 8n; }
      return out;
    }
  }
  throw new Error('Oversized EBML element');
}
const element = (tag, value) => Buffer.concat([Buffer.from(tag, 'hex'), size(bytes(value).length), bytes(value)]);
const group = (tag, ...elements) => element(tag, Buffer.concat(elements));
function uint(tag, value) {
  let hex = value.toString(16); if (hex.length % 2) hex = `0${hex}`;
  return element(tag, Buffer.from(hex, 'hex'));
}
const header = group('1A45DFA3', uint('4286', 1), uint('42F7', 1), uint('42F2', 4), uint('42F3', 8), element('4282', 'webm'), uint('4287', 4), uint('4285', 2));
const duration = Buffer.alloc(8); duration.writeDoubleBE(2000);
const info = group('1549A966', uint('2AD7B1', 1000000), element('4489', duration), element('4D80', 'synthetic-test'), element('5741', 'synthetic-test'));
const tracks = group('1654AE6B', group('AE', uint('D7', 1), uint('73C5', 1), uint('83', 1), element('86', 'V_VP8'), uint('23E383', 100000000), group('E0', uint('B0', 320), uint('BA', 240))));
const blocks = Array.from({ length: 20 }, (_, i) => {
  const prefix = Buffer.from([0x81, 0, 0, 0x80]); prefix.writeInt16BE(i * 100, 1);
  return element('A3', Buffer.concat([prefix, vp8]));
});
const video = Buffer.concat([header, group('18538067', info, tracks, group('1F43B675', uint('E7', 0), ...blocks))]);
const annotation = JSON.parse(await readFile('docs/validation/examples/synthetic.annotation.json', 'utf8'));
annotation.clipId = 'synthetic-blank'; annotation.participantGroupId = 'synthetic-no-person';
annotation.video = { sha256: createHash('sha256').update(video).digest('hex'), durationMs: 2000 };
annotation.attempts = []; annotation.view = 'unknown'; annotation.conditions = ['synthetic-blank-frame-no-person'];
annotation.permission.reference = 'Locally generated uniform blank VP8 frames; no people or personal materials';
await mkdir('validation-private', { recursive: true });
await writeFile('validation-private/synthetic-blank.webm', video, { flag: 'wx' });
await writeFile('validation-private/synthetic-blank.annotation.json', JSON.stringify(annotation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...annotation.video, output: 'validation-private/synthetic-blank.webm', material: 'synthetic' }, null, 2));
