import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type * as WorkerThreads from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GlobalOptions } from '../globals.ts';

const threadState = vi.hoisted(() => ({ isMainThread: true }));

vi.mock('node:worker_threads', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkerThreads>()),
  get isMainThread() {
    return threadState.isMainThread;
  },
}));

describe('SettingsDBFactory', () => {
  let dir: string;
  let settingsPath: string;
  let options: GlobalOptions;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-settings-'));
    settingsPath = path.join(dir, 'settings.json');
    options = {
      database: dir,
      databaseDirectory: dir,
      log_level: undefined,
      verbose: 0,
    };
    // The factory caches instances per path and reads isMainThread at import
    // time, so each test needs a fresh copy of the module.
    vi.resetModules();
  });

  afterEach(async () => {
    threadState.isMainThread = true;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const loadFactory = async () =>
    (await import('./SettingsDBFactory.ts')).SettingsDBFactory;

  test('writes startup state on the main thread', async () => {
    const SettingsDBFactory = await loadFactory();

    new SettingsDBFactory(options).get();

    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as {
      migration: { isFreshSettings: boolean };
    };
    expect(written.migration.isFreshSettings).toBe(true);
  });

  test('does not write the settings file from a worker thread', async () => {
    const SettingsDBFactory = await loadFactory();
    new SettingsDBFactory(options).get();
    const before = await fs.readFile(settingsPath, 'utf-8');
    const beforeStat = await fs.stat(settingsPath);

    vi.resetModules();
    threadState.isMainThread = false;
    const WorkerSettingsDBFactory = await loadFactory();

    const settings = new WorkerSettingsDBFactory(options).get();

    expect(settings.systemSettings()).toBeDefined();
    expect(await fs.readFile(settingsPath, 'utf-8')).toBe(before);
    expect((await fs.stat(settingsPath)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(await fs.readdir(dir)).toEqual(['settings.json']);
  });

  describe('log rolling default', () => {
    type WrittenSettings = {
      migration: Record<string, unknown>;
      system: { logging: { logRollConfig: Record<string, unknown> } };
    };

    const dailyRoll = {
      enabled: true,
      maxFileSizeBytes: 52428800,
      rolledFileLimit: 3,
      schedule: { type: 'every', increment: 1, unit: 'day', offsetMs: 0 },
    };

    const readSettings = async () =>
      JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as WrittenSettings;

    // Writes a settings file as an older release left it, then starts fresh.
    const writeLegacySettings = async (
      logRollConfig: Record<string, unknown>,
    ) => {
      const SettingsDBFactory = await loadFactory();
      new SettingsDBFactory(options).get();
      const settings = await readSettings();
      delete settings.migration.hasEnabledLogRollByDefault;
      settings.system.logging.logRollConfig = logRollConfig;
      await fs.writeFile(settingsPath, JSON.stringify(settings));
      vi.resetModules();
    };

    test('new installs roll daily', async () => {
      const SettingsDBFactory = await loadFactory();

      new SettingsDBFactory(options).get();

      const settings = await readSettings();
      expect(settings.system.logging.logRollConfig).toEqual(dailyRoll);
      expect(settings.migration.hasEnabledLogRollByDefault).toBe(true);
    });

    test('turns rolling on for existing installs that had it off', async () => {
      await writeLegacySettings({
        enabled: false,
        rolledFileLimit: 3,
        maxFileSizeBytes: 1048576,
      });
      const SettingsDBFactory = await loadFactory();

      new SettingsDBFactory(options).get();

      const settings = await readSettings();
      expect(settings.system.logging.logRollConfig).toEqual(dailyRoll);
      expect(settings.migration.hasEnabledLogRollByDefault).toBe(true);
    });

    test('keeps an existing enabled config', async () => {
      const custom = {
        enabled: true,
        rolledFileLimit: 5,
        maxFileSizeBytes: 10485760,
      };
      await writeLegacySettings(custom);
      const SettingsDBFactory = await loadFactory();

      new SettingsDBFactory(options).get();

      expect((await readSettings()).system.logging.logRollConfig).toEqual(
        custom,
      );
    });

    test('respects rolling turned off after the migration ran', async () => {
      const SettingsDBFactory = await loadFactory();
      new SettingsDBFactory(options).get();
      const settings = await readSettings();
      settings.system.logging.logRollConfig.enabled = false;
      await fs.writeFile(settingsPath, JSON.stringify(settings));
      vi.resetModules();
      const RestartedSettingsDBFactory = await loadFactory();

      new RestartedSettingsDBFactory(options).get();

      expect((await readSettings()).system.logging.logRollConfig.enabled).toBe(
        false,
      );
    });
  });

  describe('onboarding state', () => {
    type WrittenSettings = { migration: Record<string, unknown> };

    const readSettings = async () =>
      JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as WrittenSettings;

    const restart = async () => {
      vi.resetModules();
      new (await loadFactory())(options).get();
    };

    test('new installs start onboarding', async () => {
      new (await loadFactory())(options).get();

      expect((await readSettings()).migration.onboardingComplete).toBe(false);
    });

    test('existing installs skip onboarding', async () => {
      new (await loadFactory())(options).get();
      const settings = await readSettings();
      delete settings.migration.onboardingComplete;
      await fs.writeFile(settingsPath, JSON.stringify(settings));

      await restart();

      expect((await readSettings()).migration.onboardingComplete).toBe(true);
    });

    test('unfinished onboarding survives a restart', async () => {
      new (await loadFactory())(options).get();

      await restart();

      expect((await readSettings()).migration.onboardingComplete).toBe(false);
    });
  });

  // Codex review of #254: a value edited by hand into settings.json that the
  // schema can't read made the whole file fail to load, and startup wrote
  // defaults over all of it. Unreadable fork values are reset on their own
  // (the daily scan to 03:30 nightly, a Features switch to off) and the rest
  // of the file is kept.
  describe('hand-edited values it cannot read', () => {
    type Written = {
      settings: {
        mediaSource: Record<string, unknown>;
        ffmpeg: Record<string, unknown>;
      };
      featureFlags: Record<string, unknown>;
    };
    const readFile = async () =>
      JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Written;
    // Writes a settings file with these values, then starts again.
    const editAndRestart = async (edit: (file: Written) => void) => {
      new (await loadFactory())(options).get();
      const file = await readFile();
      file.settings.mediaSource.rescanIntervalHours = 9;
      file.settings.mediaSource.repairReaddedItems = true;
      file.settings.ffmpeg.ffmpegExecutablePath = '/opt/custom/ffmpeg';
      edit(file);
      await fs.writeFile(settingsPath, JSON.stringify(file));
      vi.resetModules();
      return new (await loadFactory())(options).get();
    };
    const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    test.each([
      ['an impossible time', '25:00'],
      ['a number', 330],
      ['the wrong format', '3:30pm'],
    ])('%s resets the daily scan to 03:30 in its zone', async (_, time) => {
      const settings = await editAndRestart((file) => {
        file.settings.mediaSource.dailyScanTime = time;
        file.settings.mediaSource.dailyScanTimeZone = 'America/Chicago';
      });
      const expected = {
        rescanIntervalHours: 9,
        repairReaddedItems: true,
        dailyScanTime: '03:30',
        dailyScanTimeZone: 'America/Chicago',
      };
      expect(settings.globalMediaSourceSettings()).toMatchObject(expected);
      expect(settings.ffmpegSettings().ffmpegExecutablePath).toBe(
        '/opt/custom/ffmpeg',
      );
      const after = await readFile();
      expect(after.settings.mediaSource).toMatchObject(expected);
      expect(after.settings.ffmpeg.ffmpegExecutablePath).toBe(
        '/opt/custom/ffmpeg',
      );
    });

    test("a time without a readable zone keeps the time in the server's zone", async () => {
      const settings = await editAndRestart((file) => {
        file.settings.mediaSource.dailyScanTime = '04:15';
        file.settings.mediaSource.dailyScanTimeZone = 42;
      });
      expect(settings.globalMediaSourceSettings()).toMatchObject({
        rescanIntervalHours: 9,
        dailyScanTime: '04:15',
        dailyScanTimeZone: serverZone,
      });
    });

    test('a Features switch that is not true or false is turned off', async () => {
      const settings = await editAndRestart((file) => {
        file.featureFlags.vaapiHableLut = 'yes';
        file.featureFlags.vaapiDefaultScaling = true;
      });
      expect(settings.globalMediaSourceSettings()).toMatchObject({
        rescanIntervalHours: 9,
        repairReaddedItems: true,
      });
      const after = await readFile();
      expect(after.featureFlags).toMatchObject({
        vaapiHableLut: false,
        vaapiDefaultScaling: true,
      });
      expect(after.settings.ffmpeg.ffmpegExecutablePath).toBe(
        '/opt/custom/ffmpeg',
      );
    });
  });
});
