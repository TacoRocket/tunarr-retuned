import { RouterLink } from '@/components/base/RouterLink.tsx';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import type { Channel, TranscodeConfig } from '@tunarr/types';
import { useState } from 'react';

export type DuplicateChannelProfileDialogProps = {
  // Duplicating makes copies; converting moves the channels themselves.
  purpose?: 'duplicate' | 'convert';
  channels: Channel[];
  profiles: Pick<TranscodeConfig, 'id' | 'name'>[];
  onCancel: () => void;
  onConfirm: (profileId: string) => void;
};

export function DuplicateChannelProfileDialog({
  purpose = 'duplicate',
  channels,
  profiles,
  onCancel,
  onConfirm,
}: DuplicateChannelProfileDialogProps) {
  const { t } = useLingui();
  const [profileId, setProfileId] = useState('');
  const channelNames = channels.map((channel) => channel.name).join(', ');

  return (
    <Dialog open onClose={onCancel} onClick={(e) => e.stopPropagation()}>
      <DialogTitle>
        <Trans>Choose a transcode profile</Trans>
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {purpose === 'convert' ? (
            <Trans>
              ErsatzTV next can't play the transcode profile of {channelNames}.
              Choose one it can play. Everything else about the channel stays
              the same.
            </Trans>
          ) : (
            <Trans>
              ErsatzTV next needs a different profile to play copies of{' '}
              {channelNames}.
            </Trans>
          )}
        </DialogContentText>
        {profiles.length > 0 ? (
          <TextField
            select
            fullWidth
            autoFocus
            margin="normal"
            label={t`Transcode Profile`}
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            {profiles.map((profile) => (
              <MenuItem key={profile.id} value={profile.id}>
                {profile.name}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <RouterLink to="/profiles/transcode/new" onClick={onCancel}>
            <Trans>
              Create a Next-compatible transcode profile to add a channel.
            </Trans>
          </RouterLink>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="contained"
          disabled={!profileId}
          onClick={() => onConfirm(profileId)}
        >
          {purpose === 'convert' ? (
            <Trans>Convert</Trans>
          ) : (
            <Trans>Duplicate</Trans>
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
