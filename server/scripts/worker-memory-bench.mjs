#!/usr/bin/env node
/**
 * Per-worker memory and startup A/B for scheduling worker threads.
 *
 * Runs against a BUILT app (bundle.cjs and, on branches that have it,
 * tunarr-worker.cjs), so it measures what a container actually runs. Plain
 * JavaScript with no dependencies beyond Node and the app's own
 * better-sqlite3, so it runs unchanged inside the Docker image.
 *
 *   full  bundle.cjs start-worker   (how every worker boots on main)
 *   lean  tunarr-worker.cjs          (the scheduling worker entry, if present)
 *
 * Each trial is a fresh process that spawns exactly one worker the way
 * TunarrSubprocessService does in a bundled build, so one trial cannot inherit
 * another's heap or allocator state. Modes alternate (ABBA) to spread drift.
 *
 * Reported per mode, median [min..max] over the trials:
 *   ready      new Worker() -> the worker's 'started' event
 *   idle       process RSS with the worker ready and idle, minus RSS before spawn
 *   afterTask  the same after the tasks ran
 *   task1      first time-slot task (cold), task postMessage -> reply
 *   taskWarm   median of the remaining tasks
 * On Linux RSS is also split into anonymous and file-backed pages
 * (/proc/self/status), because SQLite's mmap shows up as file-backed.
 * Every reply's lineup is hashed; all trials of all modes must match.
 *
 * In the container (the image's own node, no other tools needed):
 *   docker run --rm --entrypoint node \
 *     -v "$PWD/server/scripts/worker-memory-bench.mjs:/bench.mjs:ro" \
 *     <image> /bench.mjs
 * Locally, after `pnpm bundle`:
 *   node scripts/worker-memory-bench.mjs --app-dir dist
 *
 * Options: --app-dir (default /tunarr/app) --trials 5 --programs 3000
 *   --days 45 --slots-per-day 48 --tasks 4 --modes full,lean --json
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';

const { values } = parseArgs({
  options: {
    'app-dir': { type: 'string', default: '/tunarr/app' },
    trials: { type: 'string', default: '5' },
    programs: { type: 'string', default: '3000' },
    days: { type: 'string', default: '45' },
    'slots-per-day': { type: 'string', default: '48' },
    tasks: { type: 'string', default: '4' },
    modes: { type: 'string', default: 'full,lean' },
    json: { type: 'boolean', default: false },
    // Internal: run one trial and print one JSON line.
    trial: { type: 'string' },
    work: { type: 'string' },
  },
  allowPositionals: true,
});

const APP_DIR = path.resolve(values['app-dir']);
const BUNDLE = path.join(APP_DIR, 'bundle.cjs');
const LEAN = path.join(APP_DIR, 'tunarr-worker.cjs');
const READY_TIMEOUT_MS = 120_000;
const TASK_TIMEOUT_MS = 600_000;
// How long a worker sits after 'started' (and after its tasks) before RSS is
// read, so lazy initialisation and GC have happened.
const SETTLE_MS = 3_000;

function memory() {
  const out = { rss: process.memoryUsage().rss };
  try {
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    for (const key of ['RssAnon', 'RssFile', 'RssShmem']) {
      const m = status.match(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm'));
      if (m) out[key] = Number(m[1]) * 1024;
    }
  } catch {
    // Not Linux: total RSS only.
  }
  return out;
}

function diff(a, b) {
  const out = {};
  for (const k of Object.keys(a)) if (k in b) out[k] = a[k] - b[k];
  return out;
}

// ---------------------------------------------------------------- one trial

/**
 * Answers Meilisearch's health check. Before every schedule the worker waits
 * for /health on the search port the server gave it (with retries that run
 * for minutes), and custom-show slots make no other search call. Anything else
 * is counted and refused, so a schedule that starts depending on search shows
 * up in the report instead of silently timing out.
 */
async function startSearchStub() {
  const stub = { other: 0 };
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"available"}');
      return;
    }
    stub.other++;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  stub.port = server.address().port;
  stub.close = () => server.close();
  return stub;
}

async function runTrial(mode, workDir) {
  const search = await startSearchStub();
  const fixture = JSON.parse(
    fs.readFileSync(path.join(workDir, 'fixture.json'), 'utf8'),
  );
  const dbDir = path.join(workDir, 'db');
  globalThis.gc?.();
  await delay(200);
  const before = memory();

  const entry = mode === 'lean' ? LEAN : BUNDLE;
  const serverOptions = {
    database: dbDir,
    databaseDirectory: dbDir,
    verbose: 0,
    port: 8000,
    searchPort: search.port,
  };
  const t0 = performance.now();
  const worker = new Worker(entry, {
    // Exactly what workerArgv() passes when log_level is unset.
    argv: ['--hide_banner', 'start-worker', '--database', dbDir],
    workerData:
      mode === 'lean'
        ? { serverOptions, fallbackEntry: BUNDLE }
        : { serverOptions },
    execArgv: [],
    stdout: true,
    stderr: true,
  });
  let output = '';
  // BENCH_DEBUG=1 echoes the worker's own log, for a trial that stalls.
  const capture = (d) => {
    output += d;
    if (process.env.BENCH_DEBUG) process.stderr.write(d);
  };
  worker.stdout.on('data', capture);
  worker.stderr.on('data', capture);

  const pending = new Map();
  let readyResolve;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    worker.once('error', reject);
    worker.once('exit', (code) =>
      reject(new Error(`worker exited ${code}: ${output.slice(-2000)}`)),
    );
  });
  worker.on('message', (msg) => {
    if (msg?.type === 'event' && msg.eventType === 'started') readyResolve();
    if (msg?.type === 'success' || msg?.type === 'error') {
      pending.get(msg.requestId)?.(msg);
      pending.delete(msg.requestId);
    }
  });
  await Promise.race([
    ready,
    delay(READY_TIMEOUT_MS).then(() => {
      throw new Error(`not ready after ${READY_TIMEOUT_MS} ms`);
    }),
  ]);
  const readyMs = performance.now() - t0;
  await delay(SETTLE_MS);
  const idle = memory();
  const heapIdle = (await worker.getHeapStatistics?.())?.used_heap_size;

  const taskMs = [];
  const hashes = new Set();
  let nonFlex = 0;
  for (let i = 0; i < fixture.tasks; i++) {
    const requestId = randomUUID();
    const reply = new Promise((resolve) => pending.set(requestId, resolve));
    const start = performance.now();
    worker.postMessage({
      type: 'time-slots',
      requestId,
      request: fixture.request,
    });
    const msg = await Promise.race([
      reply,
      delay(TASK_TIMEOUT_MS).then(() => ({
        type: 'error',
        message: 'timeout',
      })),
    ]);
    taskMs.push(performance.now() - start);
    if (msg.type !== 'success') throw new Error(`task failed: ${msg.message}`);
    const lineup = msg.data.result.lineup;
    nonFlex = lineup.filter((item) => item.type !== 'flex').length;
    hashes.add(
      createHash('sha256').update(JSON.stringify(lineup)).digest('hex'),
    );
  }
  await delay(SETTLE_MS);
  const after = memory();
  const heapAfter = (await worker.getHeapStatistics?.())?.used_heap_size;
  await worker.terminate();
  search.close();

  return {
    mode,
    readyMs,
    idle: diff(idle, before),
    afterTask: diff(after, before),
    heapIdle,
    heapAfter,
    task1Ms: taskMs[0],
    taskWarmMs: median(taskMs.slice(1)),
    nonFlex,
    hashes: [...hashes],
    otherSearchRequests: search.other,
    fellBack: /falling back to the full server boot/.test(output),
  };
}

// ------------------------------------------------------------------ fixture

async function bootstrapDatabase(dbDir) {
  fs.mkdirSync(dbDir, { recursive: true });
  // Any CLI command runs the bootstrap middleware, which creates and migrates
  // the database; this one then lists migrations. The CLI keeps the process
  // alive afterwards (settings watcher, logger), so once its output has gone
  // quiet with the database in place it is stopped rather than waited on.
  const child = spawn(
    process.execPath,
    [BUNDLE, '--hide_banner', '--database', dbDir, 'db', 'migration', 'list'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  let lastOutput = Date.now();
  const onData = (d) => {
    output += d;
    lastOutput = Date.now();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  let exited = false;
  child.once('exit', () => (exited = true));
  const deadline = Date.now() + 180_000;
  while (!exited && Date.now() < deadline) {
    await delay(250);
    const quiet = Date.now() - lastOutput > 3_000;
    if (quiet && output.length > 0 && fs.existsSync(path.join(dbDir, 'db.db')))
      break;
  }
  if (!exited) child.kill('SIGTERM');
  if (!fs.existsSync(path.join(dbDir, 'db.db'))) {
    throw new Error(`bootstrap did not create db.db:\n${output.slice(-3000)}`);
  }
}

function insert(db, table, row) {
  // Fail with a readable message if the schema grew a required column.
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  for (const c of cols) {
    if (c.notnull && c.dflt_value === null && !c.pk && !(c.name in row)) {
      throw new Error(`fixture is missing required column ${table}.${c.name}`);
    }
  }
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
  ).run(...keys.map((k) => row[k]));
}

/**
 * Seeds one media source, one library, the programs and one custom show
 * holding them all, then writes the time-slot request every trial sends.
 * The media source and library rows matter: materialization skips programs
 * without them and the schedule comes back as one flex block.
 */
async function seedFixture(workDir) {
  const dbDir = path.join(workDir, 'db');
  await bootstrapDatabase(dbDir);
  const Sqlite = createRequire(path.join(APP_DIR, 'package.json'))(
    'better-sqlite3',
  );
  const db = new Sqlite(path.join(dbDir, 'db.db'));
  db.pragma('foreign_keys = ON');
  const now = Date.now();
  const mediaSourceId = randomUUID();
  const sourceName = `bench-source-${mediaSourceId}`;
  const libraryId = randomUUID();
  const customShowId = randomUUID();
  const programCount = Number(values.programs);
  const programIds = [];
  db.transaction(() => {
    insert(db, 'media_source', {
      uuid: mediaSourceId,
      access_token: 'bench-token',
      index: 0,
      name: sourceName,
      type: 'plex',
      uri: 'http://localhost:32400',
      created_at: now,
      updated_at: now,
    });
    insert(db, 'media_source_library', {
      uuid: libraryId,
      name: 'Bench Movies',
      media_type: 'movies',
      media_source_id: mediaSourceId,
      external_key: '1',
      enabled: 1,
    });
    insert(db, 'custom_show', {
      uuid: customShowId,
      name: 'Bench Show',
      created_at: now,
      updated_at: now,
    });
    for (let i = 0; i < programCount; i++) {
      const uuid = randomUUID();
      programIds.push(uuid);
      insert(db, 'program', {
        uuid,
        created_at: now,
        updated_at: now,
        title: `Bench Movie ${i}`,
        duration: 30 * 60_000 + (i % 7) * 60_000,
        type: 'movie',
        source_type: 'plex',
        external_key: `ext-${uuid}`,
        external_source_id: sourceName,
        media_source_id: mediaSourceId,
        library_id: libraryId,
        canonical_id: `plex|${mediaSourceId}|ext-${uuid}`,
        state: 'ok',
        year: 2020,
        summary: 'bench',
      });
      insert(db, 'custom_show_content', {
        content_uuid: uuid,
        custom_show_uuid: customShowId,
        index: i,
      });
    }
  })();
  db.close();

  const slotsPerDay = Number(values['slots-per-day']);
  const dayMs = 24 * 60 * 60 * 1000;
  const request = {
    type: 'programs',
    programIds,
    seed: [11, 22, 33, 44],
    startTime: Date.UTC(2026, 0, 5),
    schedule: {
      type: 'time',
      flexPreference: 'distribute',
      latenessMs: 0,
      maxDays: Number(values.days),
      padMs: 1,
      period: 'day',
      timeZoneOffset: 0,
      slots: Array.from({ length: slotsPerDay }, (_, i) => ({
        type: 'custom-show',
        customShowId,
        startTime: Math.floor((dayMs / slotsPerDay) * i),
        order: 'shuffle',
        direction: 'asc',
        id: randomUUID(),
      })),
    },
  };
  fs.writeFileSync(
    path.join(workDir, 'fixture.json'),
    JSON.stringify({ request, tasks: Number(values.tasks) }),
  );
}

// ---------------------------------------------------------------- reporting

function median(xs) {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stat(xs, unit) {
  const fmt = (v) =>
    unit === 'MB' ? (v / 2 ** 20).toFixed(1) : Math.round(v).toString();
  const clean = xs.filter((x) => typeof x === 'number');
  if (clean.length === 0) return 'n/a';
  return `${fmt(median(clean))} [${fmt(Math.min(...clean))}..${fmt(Math.max(...clean))}] ${unit === 'MB' ? 'MiB' : 'ms'}`;
}

async function main() {
  if (values.trial) {
    const result = await runTrial(values.trial, values.work);
    console.log(`RESULT ${JSON.stringify(result)}`);
    // The losing sides of the timeout races are still pending timers.
    process.exit(0);
  }
  if (!fs.existsSync(BUNDLE)) throw new Error(`no bundle at ${BUNDLE}`);
  const modes = values.modes.split(',').filter((m) => {
    if (m === 'lean' && !fs.existsSync(LEAN)) {
      console.log(`lean: ${LEAN} not present in this build; skipping`);
      return false;
    }
    return true;
  });
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tunarr-worker-bench-'),
  );
  try {
    console.log(
      `node ${process.version} ${process.platform}/${process.arch}, ${os.cpus().length} CPUs, app ${APP_DIR}`,
    );
    for (const f of [BUNDLE, LEAN])
      if (fs.existsSync(f))
        console.log(
          `  ${path.basename(f)}: ${(fs.statSync(f).size / 2 ** 20).toFixed(2)} MiB`,
        );
    console.log(
      `seeding ${values.programs} programs; task = ${values['slots-per-day']} slots/day x ${values.days} days, ${values.tasks} tasks per worker`,
    );
    await seedFixture(workDir);

    const results = [];
    const self = fileURLToPath(import.meta.url);
    const trials = Number(values.trials);
    for (let t = 0; t < trials; t++) {
      const order = t % 2 === 0 ? modes : [...modes].reverse();
      for (const mode of order) {
        const res = spawnSync(
          process.execPath,
          [
            '--expose-gc',
            self,
            '--trial',
            mode,
            '--work',
            workDir,
            '--app-dir',
            APP_DIR,
          ],
          { encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 2 ** 20 },
        );
        const line = res.stdout
          .split('\n')
          .find((l) => l.startsWith('RESULT '));
        if (!line) {
          throw new Error(
            `trial ${t} ${mode} failed (exit ${res.status}):\n${res.stdout.slice(-3000)}\n${res.stderr.slice(-3000)}`,
          );
        }
        const r = JSON.parse(line.slice('RESULT '.length));
        results.push(r);
        console.log(
          `  trial ${t + 1}/${trials} ${mode.padEnd(4)} ready ${Math.round(r.readyMs)} ms, idle ${(r.idle.rss / 2 ** 20).toFixed(1)} MiB, after ${(r.afterTask.rss / 2 ** 20).toFixed(1)} MiB, task1 ${Math.round(r.task1Ms)} ms${r.fellBack ? '  ** FELL BACK TO FULL BOOT **' : ''}`,
        );
      }
    }

    console.log('\nper worker, median [min..max] over', trials, 'trials');
    for (const mode of modes) {
      const rs = results.filter((r) => r.mode === mode);
      console.log(`\n${mode}`);
      console.log(
        `  ready           ${stat(
          rs.map((r) => r.readyMs),
          'ms',
        )}`,
      );
      for (const k of ['rss', 'RssAnon', 'RssFile']) {
        if (rs[0].idle[k] === undefined) continue;
        console.log(
          `  idle ${k.padEnd(10)} ${stat(
            rs.map((r) => r.idle[k]),
            'MB',
          )}`,
        );
        console.log(
          `  after ${k.padEnd(9)} ${stat(
            rs.map((r) => r.afterTask[k]),
            'MB',
          )}`,
        );
      }
      console.log(
        `  heap idle       ${stat(
          rs.map((r) => r.heapIdle),
          'MB',
        )}`,
      );
      console.log(
        `  heap after      ${stat(
          rs.map((r) => r.heapAfter),
          'MB',
        )}`,
      );
      console.log(
        `  task1 (cold)    ${stat(
          rs.map((r) => r.task1Ms),
          'ms',
        )}`,
      );
      console.log(
        `  task warm       ${stat(
          rs.map((r) => r.taskWarmMs),
          'ms',
        )}`,
      );
      console.log(
        `  scheduled items ${rs[0].nonFlex} non-flex; fell back: ${rs.filter((r) => r.fellBack).length}/${rs.length}; non-health search calls: ${rs.reduce((a, r) => a + r.otherSearchRequests, 0)}`,
      );
    }
    const hashes = new Set(results.flatMap((r) => r.hashes));
    console.log(
      `\nlineup identical across all trials and modes: ${hashes.size === 1 ? 'yes' : `NO (${hashes.size} distinct)`}`,
    );
    if (values.json) console.log(`JSON ${JSON.stringify(results)}`);
    if (hashes.size !== 1 || results.some((r) => r.fellBack))
      process.exitCode = 1;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
