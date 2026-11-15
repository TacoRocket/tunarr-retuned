import { FfmpegInfo } from '@/ffmpeg/ffmpegInfo.js';
import { autoFactoryKey } from '@/types/inject.js';
import { inject, injectable } from 'inversify';
import {
  allFeaturesSupported,
  describeFeature,
  featureSupportAdvice,
  ffmpegFeatureSupport,
} from '../../ffmpeg/FfmpegFeatureSupport.ts';
import {
  type HealthCheck,
  type HealthCheckResult,
  HealthyHealthCheckResult,
  healthCheckResult,
} from './HealthCheck.ts';

// Fork: which fork features the configured FFmpeg can run. Each poll resolves
// the executable configured now, then reads the per-executable capability
// cache playback uses, so a poll starts no FFmpeg process while it is warm.
@injectable()
export class FfmpegFeatureSupportHealthCheck implements HealthCheck {
  readonly id: string = 'FfmpegFeatureSupport';

  constructor(
    @inject(autoFactoryKey(FfmpegInfo))
    private ffmpegInfo: () => Pick<FfmpegInfo, 'getCapabilities'>,
  ) {}

  async getStatus(): Promise<HealthCheckResult> {
    const capabilities = await this.ffmpegInfo().getCapabilities();
    const features = ffmpegFeatureSupport(capabilities);
    if (allFeaturesSupported(features)) {
      return capabilities.runtime.source === 'bundled'
        ? HealthyHealthCheckResult
        : {
            type: 'healthy',
            context: featureSupportAdvice(capabilities.runtime)[0],
          };
    }
    return healthCheckResult({
      type: 'warning',
      context: [
        'This FFmpeg lacks pieces some fork features need.',
        ...features
          .filter((f) => f.status !== 'supported')
          .map((f) => `- ${describeFeature(f)}`),
        ...featureSupportAdvice(capabilities.runtime),
      ].join('\n'),
    });
  }
}
