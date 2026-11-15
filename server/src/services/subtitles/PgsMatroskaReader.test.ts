import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { readPgsBlocks } from './PgsMatroskaReader.ts';
import { UnsupportedMatroskaError } from './SelectiveMatroskaReader.ts';

// Fork: MKVToolNix often stores PGS blocks zlib-compressed. A quarter of the
// English PGS tracks OCR would need in one large library were, and the reader
// used to refuse them all.

function element(id: string, ...parts: Buffer[]) {
  const payload = Buffer.concat(parts);
  let width = 1;
  while (payload.length >= 2 ** (7 * width) - 1) width++;
  const size = Buffer.alloc(width);
  let value = BigInt(payload.length) | (1n << BigInt(7 * width));
  for (let i = width - 1; i >= 0; i--) {
    size[i] = Number(value & 255n);
    value >>= 8n;
  }
  return Buffer.concat([Buffer.from(id, 'hex'), size, payload]);
}
const uint = (value: number) => Buffer.from([value]);

// A PGS "end of display set" segment: enough for the reader, which does not
// decode PGS itself.
const pgsSegment = Buffer.from([
  0x50, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0,
]);

function contentEncodings(algorithm: number) {
  return element(
    '6d80',
    element(
      '6240',
      element('5032', uint(1)),
      element('5033', uint(0)),
      element('5034', element('4254', uint(algorithm))),
    ),
  );
}

function matroska(pgsEncodings: Buffer | null, pgsPayload: Buffer) {
  const video = element(
    'ae',
    element('d7', uint(1)),
    element('83', uint(1)),
    element('86', Buffer.from('V_MPEG4/ISO/AVC')),
  );
  const pgs = element(
    'ae',
    element('d7', uint(2)),
    element('83', uint(17)),
    element('86', Buffer.from('S_HDMV/PGS')),
    ...(pgsEncodings ? [pgsEncodings] : []),
  );
  return Buffer.concat([
    element('1a45dfa3', element('4282', Buffer.from('matroska'))),
    element(
      '18538067',
      element('1549a966', element('2ad7b1', Buffer.from([0x0f, 0x42, 0x40]))),
      element('1654ae6b', video, pgs),
      element(
        '1f43b675',
        element('e7', uint(0)),
        element('a3', Buffer.from([0x81, 0, 0, 0x80]), Buffer.from('VIDEO')),
        element('a3', Buffer.from([0x82, 0, 10, 0x80]), pgsPayload),
      ),
    ),
  ]);
}

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pgs-reader-'));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

async function read(source: Buffer) {
  const input = path.join(directory, 'input.mkv');
  await fs.writeFile(input, source);
  return readPgsBlocks(input, 1);
}

test('an unencoded PGS track is read as stored', async () => {
  const { blocks } = await read(matroska(null, pgsSegment));
  expect(blocks.map((b) => b.data)).toEqual([pgsSegment]);
});

test('a zlib-compressed PGS track is read inflated', async () => {
  const { blocks, payloadBytes } = await read(
    matroska(contentEncodings(0), deflateSync(pgsSegment)),
  );
  expect(blocks.map((b) => b.data)).toEqual([pgsSegment]);
  expect(payloadBytes).toBe(pgsSegment.length);
});

test('other encodings are still refused by name', async () => {
  // 3 = header stripping, which no track in the library used.
  await expect(read(matroska(contentEncodings(3), pgsSegment))).rejects.toThrow(
    new UnsupportedMatroskaError(
      'Conversion supports unencoded or zlib-compressed PGS tracks only',
    ),
  );
});

test('a corrupt compressed block fails with a clear error', async () => {
  await expect(
    read(matroska(contentEncodings(0), Buffer.from('not zlib'))),
  ).rejects.toThrow('Could not decompress a zlib-compressed PGS block');
});
