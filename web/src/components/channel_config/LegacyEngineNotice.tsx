import { RouterButtonLink } from '@/components/base/RouterButtonLink.tsx';
import { DuplicateChannelProfileDialog } from '@/components/channels/DuplicateChannelProfileDialog.tsx';
import { useChannelBulkActions } from '@/components/channels/useChannelBulkActions.ts';
import { getChannelsByNumberV2Options } from '@/generated/@tanstack/react-query.gen.ts';
import { isLegacyChannel, nextStreamMode } from '@/helpers/nextConversion.ts';
import { Trans } from '@lingui/react/macro';
import { Alert, AlertTitle, Box, Button } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { Channel } from '@tunarr/types';
import { useState } from 'react';

// Modes that only exist on the native pipeline, named as the Streaming tab
// names them.
const NativeOnlyModeLabels: Partial<Record<Channel['streamMode'], string>> = {
  hls_slower: 'HLS Alt',
  hls_direct: 'HLS Direct',
};

type Props = {
  // The channel as saved on the server, not the form's unsaved values.
  channel: Channel;
  onConverted: (channel: Channel) => void;
};

/**
 * SIGNPOST(native-retirement): remove with native playback.
 *
 * Offers a channel still on Tunarr's native pipeline a one-click move to
 * ErsatzTV next. Until it converts, the edit page around this notice is
 * read-only; programming stays editable on its own page.
 */
export function LegacyEngineNotice({ channel, onConverted }: Props) {
  if (!isLegacyChannel(channel)) return null;
  // An offset channel takes its engine from its source.
  if (channel.offset) {
    return <FollowsSourceNotice sourceId={channel.offset.sourceChannelId} />;
  }
  return <ConvertNotice channel={channel} onConverted={onConverted} />;
}

function ConvertNotice({ channel, onConverted }: Props) {
  const { convertChannels, profileDialog } = useChannelBulkActions();
  const [converting, setConverting] = useState(false);

  const nativeOnlyMode = NativeOnlyModeLabels[channel.streamMode];
  const convert = async () => {
    setConverting(true);
    try {
      await convertChannels([channel], onConverted);
    } finally {
      setConverting(false);
    }
  };

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        <AlertTitle>
          <Trans>This channel uses the legacy playback engine</Trans>
        </AlertTitle>
        <Trans>
          Tunarr's own playback engine is being retired in favor of ErsatzTV
          next. Converting keeps this channel's settings and programming.
        </Trans>{' '}
        {nativeOnlyMode && nextStreamMode(channel.streamMode) === 'hls' && (
          <>
            <Trans>
              Its stream mode changes from {nativeOnlyMode} to HLS, which
              ErsatzTV next plays.
            </Trans>{' '}
          </>
        )}
        <Trans>
          Its settings are read-only until it's converted. Programming can still
          be changed.
        </Trans>
        {/* Under the text rather than beside it, so a phone keeps the text
            readable and the button on one line. */}
        <Box sx={{ mt: 1.5 }}>
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            disabled={converting}
            onClick={() => void convert()}
          >
            {converting ? (
              <Trans>Converting…</Trans>
            ) : (
              <Trans>Convert to ErsatzTV next</Trans>
            )}
          </Button>
        </Box>
      </Alert>
      {profileDialog && <DuplicateChannelProfileDialog {...profileDialog} />}
    </>
  );
}

function FollowsSourceNotice({ sourceId }: { sourceId: string }) {
  const { data: source } = useQuery(
    getChannelsByNumberV2Options({ path: { id: sourceId } }),
  );
  const sourceName = source?.name;

  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      <AlertTitle>
        <Trans>This channel uses the legacy playback engine</Trans>
      </AlertTitle>
      {sourceName ? (
        <Trans>
          It plays {sourceName} later and uses its playback engine. Convert{' '}
          {sourceName} to ErsatzTV next, and this channel moves with it. Until
          then its settings are read-only.
        </Trans>
      ) : (
        <Trans>
          It plays another channel later and uses that channel's playback
          engine. Convert that channel to ErsatzTV next, and this channel moves
          with it. Until then its settings are read-only.
        </Trans>
      )}
      <Box sx={{ mt: 1.5 }}>
        <RouterButtonLink
          to="/channels/$channelId/edit"
          params={{ channelId: sourceId }}
          variant="outlined"
          color="inherit"
          size="small"
        >
          {sourceName ? (
            <Trans>Open {sourceName}</Trans>
          ) : (
            <Trans>Open source channel</Trans>
          )}
        </RouterButtonLink>
      </Box>
    </Alert>
  );
}
