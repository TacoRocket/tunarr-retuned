import { FfmpegInfo } from '@/ffmpeg/ffmpegInfo.js';
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

// Fork: which fork features the configured FFmpeg can run. Reads the shared
// capability cache that playback uses, so a status poll starts no FFmpeg
// process of its own while that cache is warm.
@injectable()
export class FfmpegFeatureSupportHealthCheck implements HealthCheck {
  readonly id: string = 'FfmpegFeatureSupport';

  constructor(
    @inject(FfmpegInfo)
    private ffmpegInfo: Pick<FfmpegInfo, 'getCapabilities'>,
  ) {}

  async getStatus(): Promise<HealthCheckResult> {
    const capabilities = await this.ffmpegInfo.getCapabilities();
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
