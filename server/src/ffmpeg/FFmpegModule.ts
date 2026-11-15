import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import { FfmpegStreamFactory } from '@/ffmpeg/FfmpegStreamFactory.js';
import { autoFactoryKey, KEYS } from '@/types/inject.js';
import { ContainerModule } from 'inversify';
import type { ChannelOrm } from '../db/schema/Channel.ts';
import { bindAssistedFactory } from '../util/assistedInject.ts';
import { bindAutoFactory } from '../util/inject.ts';
import { FfmpegInfo } from './ffmpegInfo.ts';
import { StreamSelector } from './StreamSelector.ts';

export type FFmpegAssistedFactory = (
  transcodeConfig: TranscodeConfigOrm,
  channel: ChannelOrm,
) => FfmpegStreamFactory;

const FFmpegModule = new ContainerModule(({ bind }) => {
  bindAssistedFactory<FfmpegStreamFactory, FFmpegAssistedFactory>(
    bind,
    KEYS.FFmpegFactory,
    FfmpegStreamFactory,
  );

  // Not a singleton: FfmpegInfo captures KEYS.FFmpegPath / KEYS.FFprobePath at
  // construction, and those are bound transiently so a settings change takes
  // effect without a restart.
  bind(FfmpegInfo).toSelf();
  // Fork: `@inject(autoFactoryKey(FfmpegInfo))` resolves FfmpegInfo when
  // called, so a long-lived holder follows the configured executable.
  // Capabilities stay cached per executable path.
  bindAutoFactory(bind, autoFactoryKey(FfmpegInfo), FfmpegInfo);
  bind(StreamSelector).toSelf().inSingletonScope();
});

export { FFmpegModule };
