import type { ChannelStreamMode } from '@tunarr/types';
import { describe, expect, test } from 'vitest';
import { concatSessionTypeFor, routesToEtvNext } from './EtvNextRouting.ts';

describe('routesToEtvNext', () => {
  const allModes: ChannelStreamMode[] = [
    'hls',
    'hls_slower',
    'mpegts',
    'hls_direct',
    'hls_direct_v2',
  ];

  const routableModes: ChannelStreamMode[] = ['hls', 'hls_direct_v2', 'mpegts'];

  // Both of these are on their way out, and hls_direct remuxes without
  // transcoding, which the worker cannot do.
  const unroutableModes: ChannelStreamMode[] = ['hls_direct', 'hls_slower'];

  test.each(allModes)(
    'leaves %s alone when the channel has not opted in',
    (mode) => {
      expect(routesToEtvNext(mode, false)).toBe(false);
    },
  );

  test.each(routableModes)('routes %s when the channel opts in', (mode) => {
    expect(routesToEtvNext(mode, true)).toBe(true);
  });

  // A channel cannot opt into a mode the worker has no way to serve.
  test.each(unroutableModes)(
    'keeps %s on Tunarr even when the channel opts in',
    (mode) => {
      expect(routesToEtvNext(mode, true)).toBe(false);
    },
  );
});

// The continuous MPEG-TS stream tuner-style clients get re-reads the worker's
// HLS with FFmpeg, which decodes every fMP4 program after the first against
// the first program's header.
describe('concatSessionTypeFor', () => {
  test('an fMP4 channel reads its MPEG-TS copy, not the HLS session', () => {
    for (const streamMode of ['hls', 'hls_direct_v2'] as const) {
      expect(
        concatSessionTypeFor(streamMode, {
          useEtvNext: true,
          streamMode,
          hlsSegmentType: 'fmp4',
        }),
      ).toBe('etv_next_mpegts_concat');
    }
  });

  // The common case keeps the one session it shares with HLS viewers.
  test('an MPEG-TS channel keeps the shared worker session', () => {
    expect(
      concatSessionTypeFor('hls', {
        useEtvNext: true,
        streamMode: 'hls',
        hlsSegmentType: 'mpegts',
      }),
    ).toBe('etv_next_concat');
  });

  // MPEG-TS stream mode already keeps its worker on MPEG-TS segments.
  test('an MPEG-TS stream mode channel keeps the shared worker session', () => {
    expect(
      concatSessionTypeFor('mpegts', {
        useEtvNext: true,
        streamMode: 'mpegts',
        hlsSegmentType: 'fmp4',
      }),
    ).toBe('etv_next_concat');
  });

  // The channel was switched while a worker kept running. The tuner stream
  // must read a worker that writes MPEG-TS, whatever the setting now says.
  test('a running fMP4 worker sends a new tuner to the MPEG-TS copy after a switch to MPEG-TS', () => {
    expect(
      concatSessionTypeFor(
        'hls',
        { useEtvNext: true, streamMode: 'hls', hlsSegmentType: 'mpegts' },
        { writesFmp4Segments: true, stoppingOrStopped: false },
      ),
    ).toBe('etv_next_mpegts_concat');
  });

  test('a running MPEG-TS worker keeps a new tuner on it after a switch to fMP4', () => {
    expect(
      concatSessionTypeFor(
        'hls',
        { useEtvNext: true, streamMode: 'hls', hlsSegmentType: 'fmp4' },
        { writesFmp4Segments: false, stoppingOrStopped: false },
      ),
    ).toBe('etv_next_concat');
  });

  // A stopping worker is on its way out; the next one follows the setting.
  test('a stopping worker leaves the decision to the saved setting', () => {
    expect(
      concatSessionTypeFor(
        'hls',
        { useEtvNext: true, streamMode: 'hls', hlsSegmentType: 'fmp4' },
        { writesFmp4Segments: false, stoppingOrStopped: true },
      ),
    ).toBe('etv_next_mpegts_concat');
  });

  test('a channel off the worker keeps its own concat mode', () => {
    expect(
      concatSessionTypeFor('mpegts', {
        useEtvNext: false,
        streamMode: 'hls',
        hlsSegmentType: 'fmp4',
      }),
    ).toBe('mpegts_concat');
  });
});
