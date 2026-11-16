import { Trans } from '@lingui/react/macro';
import { Campaign } from '@mui/icons-material';
import { ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { Link } from '@tanstack/react-router';

// Fork: the channel menu's way to a channel's ad breaks.
export function AdBreaksMenuItem({ channelId }: { channelId: string }) {
  return (
    <MenuItem
      to={`/channels/${channelId}/ad-breaks`}
      component={Link}
      onClick={(e) => e.stopPropagation()}
    >
      <ListItemIcon>
        <Campaign />
      </ListItemIcon>
      <ListItemText>
        <Trans>Ad Breaks</Trans>
      </ListItemText>
    </MenuItem>
  );
}
