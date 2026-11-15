import { DuplicateChannelProfileDialog } from '@/components/channels/DuplicateChannelProfileDialog.tsx';
import { useChannelBulkActions } from '@/components/channels/useChannelBulkActions.ts';
import { isLegacyChannel, nextStreamMode } from '@/helpers/nextConversion.ts';
import { Trans } from '@lingui/react/macro';
import { Alert, AlertTitle, Box, Button } from '@mui/material';
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
 * ErsatzTV next. The channel stays fully editable either way.
 */
export function LegacyEngineNotice({ channel, onConverted }: Props) {
  const { convertChannels, profileDialog } = useChannelBulkActions();
  const [converting, setConverting] = useState(false);
  if (!isLegacyChannel(channel)) return null;

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
        <Trans>You can switch back under Streaming, in Playback engine.</Trans>
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
