import { expect, it } from 'vitest';
import { decodePgs, renderPgs } from './PgsDecoder.ts';

// Final display from the direct-block probe: two ODS fragments, no later clear.
// Remuxing this input to SUP lost its stored Matroska BlockDuration.
const finalDisplay = Buffer.from(
  '160013014000b4100004800000010000000000640096' +
    '17000a01000064009600080002' +
    '14000c0000001080800001eb8080ff' +
    '150015000000800000180008000201010101010101010000' +
    '15000e0000004001010101010101010000' +
    '800000',
  'hex',
);

it('preserves the stored final duration that the SUP handoff discarded', () => {
  const cues = decodePgs([
    {
      timestampNs: 7_250_000_000n,
      durationNs: 1_625_000_000n,
      data: finalDisplay,
    },
  ]);
  expect(cues.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
    { startMs: 7250, endMs: 8875 },
  ]);
});

it('keeps the missing-duration counterpart unresolved', () => {
  const cues = decodePgs([
    { timestampNs: 7_250_000_000n, durationNs: null, data: finalDisplay },
  ]);
  expect(cues.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
    { startMs: 7250, endMs: null },
  ]);
});

function displaySet(milliseconds: number, clear = false) {
  const segment = (kind: number, hex: string) => {
    const data = Buffer.from(hex, 'hex');
    const header = Buffer.alloc(3);
    header[0] = kind;
    header.writeUInt16BE(data.length, 1);
    return Buffer.concat([header, data]);
  };
  // A three-pixel white object at (10,20), then transparent/gray at (11,20).
  const picture = clear
    ? '0014002800000080000000'
    : '001400280000008000000200000000000a001400010000000b0014';
  return {
    timestampNs: BigInt(milliseconds) * 1_000_000n,
    durationNs: null,
    data: Buffer.concat([
      segment(0x16, picture),
      ...(clear
        ? []
        : [
            segment(0x14, '0000001080800001eb8080ff027e8080ff'),
            segment(0x15, '000000c0000009000300010083010000'),
            segment(0x15, '000100c000000a00020001008100020000'),
          ]),
      segment(0x80, ''),
    ]),
  };
}

it('retains text under transparent overlapping objects through fade merging', () => {
  // Plain row copying erases the second white pixel. This is the concrete
  // counterexample to replacing the previous Skia source-over operation with copy.
  const blocks = [0, 1000, 2000].flatMap((start) => [
    displaySet(start),
    displaySet(start + 100),
    displaySet(start + 200, true),
  ]);
  const cues = decodePgs(blocks);
  expect(cues.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
    [0, 200],
    [1000, 1200],
    [2000, 2200],
  ]);
  for (const cue of cues) {
    expect(renderPgs(cue)).toEqual({
      width: 3,
      height: 1,
      pixels: Buffer.from([
        255, 255, 255, 255, 255, 255, 255, 255, 128, 128, 128, 255,
      ]),
    });
  }
});

it('decodes a palette with no colors as a blank cue instead of failing the track', () => {
  // Seen at the end of a real Blu-ray PGS track: a display whose palette
  // segment carries only its ID and version.
  const segment = (kind: number, hex: string) => {
    const data = Buffer.from(hex, 'hex');
    return Buffer.concat([Buffer.from([kind, 0, data.length]), data]);
  };
  const blank = {
    timestampNs: 0n,
    durationNs: 1_000_000_000n,
    data: Buffer.concat([
      segment(0x16, '001400280000008000000100000000000a0014'),
      segment(0x14, '0000'),
      segment(0x15, '000000c0000009000300010083010000'),
      segment(0x80, ''),
    ]),
  };
  const [cue] = decodePgs([blank]);
  expect(cue?.palettes).toEqual([Buffer.alloc(0)]);
  const { pixels } = renderPgs(cue!);
  expect(pixels.every((value) => value === 0)).toBe(true);
});

it("keeps a palette's colors when an update in the same epoch lists none", () => {
  // FFmpeg's decoder updates only the entries a palette segment lists. White
  // text is defined on palette 0, the next display sends palette 0 with no
  // entries, and the one after reuses it: all three must stay visible, or
  // OCR silently skips those captions.
  const segment = (kind: number, hex: string) => {
    const data = Buffer.from(hex, 'hex');
    return Buffer.concat([Buffer.from([kind, 0, data.length]), data]);
  };
  // State 0x80 starts an epoch (palettes and objects reset); 0x00 is normal.
  // Size 20x40, composition 0, the state, no palette-only update, palette 0,
  // and the two objects of the fade fixture above.
  const composition = (state: string) =>
    `00140028000000${state}000002` + '00000000000a0014' + '00010000000b0014';
  const display = (ms: number, ...segments: Buffer[]) => ({
    timestampNs: BigInt(ms) * 1_000_000n,
    durationNs: null,
    data: Buffer.concat([...segments, segment(0x80, '')]),
  });
  const blocks = [
    display(
      0,
      segment(0x16, composition('80')),
      segment(0x14, '0000001080800001eb8080ff027e8080ff'),
      segment(0x15, '000000c0000009000300010083010000'),
      segment(0x15, '000100c000000a00020001008100020000'),
    ),
    display(1000, segment(0x16, composition('00')), segment(0x14, '0001')),
    display(2000, segment(0x16, composition('00'))),
    // No objects: clears the screen.
    display(3000, segment(0x16, '0014002800000000000000')),
  ];
  const cues = decodePgs(blocks).filter((cue) => cue.placements.length > 0);
  expect(cues.length).toBeGreaterThan(0);
  expect(cues[0]?.startMs).toBe(0);
  expect(cues.at(-1)?.endMs).toBe(3000);
  for (const cue of cues) {
    expect(renderPgs(cue).pixels).toEqual(
      Buffer.from([255, 255, 255, 255, 255, 255, 255, 255, 128, 128, 128, 255]),
    );
  }
});

it('a palette first defined with no colors after an epoch reset stays transparent', () => {
  const segment = (kind: number, hex: string) => {
    const data = Buffer.from(hex, 'hex');
    return Buffer.concat([Buffer.from([kind, 0, data.length]), data]);
  };
  const withColors = {
    timestampNs: 0n,
    durationNs: null,
    data: Buffer.concat([
      segment(0x16, '001400280000008000000100000000000a0014'),
      segment(0x14, '0000001080800001eb8080ff'),
      segment(0x15, '000000c0000009000300010083010000'),
      segment(0x80, ''),
    ]),
  };
  // A new epoch resets palette 0, so its empty definition has nothing to keep.
  const resetEmpty = {
    timestampNs: 1_000_000_000n,
    durationNs: 1_000_000_000n,
    data: Buffer.concat([
      segment(0x16, '001400280000018000000100000000000a0014'),
      segment(0x14, '0000'),
      segment(0x15, '000000c0000009000300010083010000'),
      segment(0x80, ''),
    ]),
  };
  const cues = decodePgs([withColors, resetEmpty]);
  const last = cues.at(-1)!;
  expect(last.startMs).toBe(1000);
  expect(renderPgs(last).pixels.every((value) => value === 0)).toBe(true);
});
