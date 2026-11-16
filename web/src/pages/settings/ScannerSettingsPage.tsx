import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import {
  getApiSettingsMediaSourceOptions,
  putApiSettingsMediaSourceMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
  FormHelperText,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import type { GlobalMediaSourceSettings } from '@tunarr/types/schemas';
import { useSnackbar } from 'notistack';
import { useCallback, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';

// Half past the hour keeps scans clear of the hourly library refresh.
const SuggestedDailyScanTime = '03:30';

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Intl.supportedValuesOf is newer than the ES2021 library this app targets.
function timeZoneOptions(): string[] {
  const listed =
    (
      Intl as { supportedValuesOf?: (key: 'timeZone') => string[] }
    ).supportedValuesOf?.('timeZone') ?? [];
  return [...new Set([browserTimeZone(), 'UTC', ...listed])].sort();
}

export const ScannerSettingsPage = () => {
  const { t } = useLingui();
  const { data: mediaSourceSettings } = useSuspenseQuery(
    getApiSettingsMediaSourceOptions(),
  );

  const settingsForm = useForm<GlobalMediaSourceSettings>({
    defaultValues: mediaSourceSettings,
  });
  const dailyScanTime = settingsForm.watch('dailyScanTime');
  const zones = useMemo(timeZoneOptions, []);

  const snackbar = useSnackbar();

  const updateMediaSourceSettingsMut = useMutation({
    ...putApiSettingsMediaSourceMutation(),
    onSuccess: (returned) => {
      settingsForm.reset(returned);
      snackbar.enqueueSnackbar({
        variant: 'success',
        message: t`Successfully updated Media Source settings.`,
      });
    },
    onError: (err) => {
      console.error(err);
      snackbar.enqueueSnackbar({
        variant: 'error',
        message:
          getApiErrorMessage(err) ??
          t`Failed to update Media Source settings. Please check server and browser logs for details.`,
      });
    },
  });

  const onSubmit = useCallback(
    (data: GlobalMediaSourceSettings) => {
      updateMediaSourceSettingsMut.mutate({
        body: {
          rescanIntervalHours: data.rescanIntervalHours,
          dailyScanTime: data.dailyScanTime,
          dailyScanTimeZone: data.dailyScanTimeZone,
        },
      });
    },
    [updateMediaSourceSettingsMut],
  );

  const onError = useCallback(() => {
    snackbar.enqueueSnackbar({
      variant: 'error',
      message: t`There was an error submitting the request to update Media Source settings. Please check the form and try again`,
    });
  }, [snackbar, t]);

  const setDailyScan = (on: boolean) => {
    const options = { shouldDirty: true, shouldValidate: true };
    settingsForm.setValue(
      'dailyScanTime',
      on ? SuggestedDailyScanTime : null,
      options,
    );
    settingsForm.setValue(
      'dailyScanTimeZone',
      on ? browserTimeZone() : null,
      options,
    );
  };

  return (
    <Stack>
      <Box
        component="form"
        onSubmit={settingsForm.handleSubmit(onSubmit, onError)}
      >
        <Stack gap={2}>
          <NumericFormControllerText
            control={settingsForm.control}
            name="rescanIntervalHours"
            prettyFieldName={t`Rescan Interval (hours)`}
            TextFieldProps={{
              label: t`Rescan Interval (hours)`,
              helperText: t`How frequently libraries should be scanned (starting from midnight).`,
            }}
          />
          <Stack gap={1}>
            <FormControlLabel
              label={t`Scan once a day at a set time`}
              control={
                <Switch
                  checked={dailyScanTime !== null}
                  onChange={(_, checked) => setDailyScan(checked)}
                />
              }
            />
            {dailyScanTime !== null && (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
                  <Controller
                    control={settingsForm.control}
                    name="dailyScanTime"
                    rules={{
                      required: true,
                      pattern: /^([01]\d|2[0-3]):[0-5]\d$/,
                    }}
                    render={({ field, fieldState }) => (
                      <TextField
                        label={t`Time`}
                        type="time"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                        error={!!fieldState.error}
                        slotProps={{
                          inputLabel: { shrink: true },
                          htmlInput: { step: 60 },
                        }}
                        sx={{ minWidth: 160 }}
                      />
                    )}
                  />
                  <Controller
                    control={settingsForm.control}
                    name="dailyScanTimeZone"
                    rules={{ required: true }}
                    render={({ field, fieldState }) => (
                      <Autocomplete
                        options={zones}
                        value={field.value ?? browserTimeZone()}
                        onChange={(_, zone) => field.onChange(zone)}
                        disableClearable
                        sx={{ minWidth: 280, flexGrow: 1 }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label={t`Time zone`}
                            error={!!fieldState.error}
                          />
                        )}
                      />
                    )}
                  />
                </Stack>
                <FormHelperText sx={{ ml: 0 }}>
                  <Trans>
                    Library scans run once a day at this time instead of on the
                    interval above. Collections and custom shows still sync on
                    the interval. Half past the hour keeps scans clear of the
                    hourly library refresh.
                  </Trans>
                </FormHelperText>
              </>
            )}
          </Stack>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="submit"
              variant="contained"
              disabled={!settingsForm.formState.isDirty}
            >
              <Trans>Save</Trans>
            </Button>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
};
