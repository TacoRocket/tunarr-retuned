// Must stay first. Zod only compiles schemas constructed after this loads.
import 'zod/compile';

import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SettingsDBFactory } from '../../db/SettingsDBFactory.ts';
import { globalOptions, setGlobalOptions } from '../../globals.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { OcrWorker } from './OcrWorker.ts';
import { readGlobalArgs } from './workerArgs.ts';

/**
 * Entry point for the pool's dedicated OCR worker.
 *
 * PGS OCR reads a Matroska file, decodes its subtitle bitmaps, runs the
 * `tesseract` and `flock` binaries and writes SRT files under the cache folder
 * named in the request. It touches no database, scheduler or search server.
 * So this entry sets the global options from the same argv as every worker,
 * loads settings only to configure logging the way the server does, and
 * starts OcrWorker.
 *
 * If that throws before the worker reports ready, it logs once and hands the
 * thread to the CLI entry the parent runs, which boots exactly as before.
 */

type OcrWorkerData = {
  // The parent's CLI entry. Present when the parent started this entry.
  fallbackEntry?: string;
};

function startOcr() {
  setGlobalOptions(readGlobalArgs());
  // The parent created the settings file before starting any worker.
  LoggerFactory.initialize(new SettingsDBFactory(globalOptions()).get());
  new OcrWorker().start();
}

async function main() {
  if (isMainThread || !parentPort) {
    console.error('This module is only meant to be run as a worker thread.');
    process.exit(1);
  }
  const data = workerData as OcrWorkerData;
  try {
    startOcr();
  } catch (error) {
    if (!data.fallbackEntry) throw error;
    console.warn(
      'OCR worker could not start on its own; falling back to the full server boot. This is a bug in ocrWorkerEntry.',
      error,
    );
    await import(pathToFileURL(data.fallbackEntry).href);
  }
}

// Not top-level await: the bundle is CommonJS.
main().catch((error: unknown) => {
  console.error('OCR worker failed to start', error);
  process.exit(1);
});
