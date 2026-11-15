import { Trans } from '@lingui/react/macro';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { AnyRoute } from '@tanstack/react-router';
import { useBlocker } from '@tanstack/react-router';
import { useRef } from 'react';
import { isExemptNavigation } from './unsavedNavigation.ts';

type AvailablePaths<TRoute extends AnyRoute = AnyRoute> = TRoute['fullPath'];

type Props = {
  isDirty: boolean;
  exceptTargetPaths?: AvailablePaths[];
  onProceed?: () => void;
};

// Exempt paths are used in situations where the form spans multiple tabs or pages.
// This ensures the Alert is not activated in the middle of a form navigation.

export default function UnsavedNavigationAlert({
  isDirty,
  exceptTargetPaths,
  onProceed,
}: Props) {
  // Read at unload time so the browser's "Leave site?" prompt follows the
  // current dirty state. Without this, useBlocker enables the prompt
  // unconditionally and it fires even on a pristine form.
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const { proceed, status, reset } = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      isExemptNavigation(current, next, exceptTargetPaths) ? false : isDirty,
    enableBeforeUnload: () => isDirtyRef.current,
    withResolver: true,
  });

  const handleProceed = () => {
    proceed?.();
    onProceed?.();
  };

  return status === 'blocked' ? (
    <Dialog
      open={status === 'blocked'}
      onClose={reset}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title">
        <Trans>You have unsaved changes!</Trans>
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="alert-dialog-description">
          <Trans>
            If you proceed, all unsaved changes will be lost. Are you sure you
            want to proceed?
          </Trans>
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={reset}>
          <Trans>Cancel</Trans>
        </Button>
        <Button onClick={handleProceed} autoFocus variant="contained">
          <Trans>Proceed</Trans>
        </Button>
      </DialogActions>
    </Dialog>
  ) : null;
}
