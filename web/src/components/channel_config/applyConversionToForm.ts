import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

// The fields a conversion to ErsatzTV next sets.
const ConversionFields = ['useEtvNext', 'streamMode', 'transcodeConfigId'];

type ConversionValues = {
  useEtvNext: unknown;
  streamMode: unknown;
  transcodeConfigId: unknown;
};

/**
 * SIGNPOST(native-retirement): goes with the conversion notice.
 *
 * Brings a conversion the server just saved into an open edit form. Unsaved
 * edits stay, except in the fields the conversion set: an unsaved choice
 * there (say, HLS Alt) would let a later Save undo the conversion.
 */
export function applyConversionToForm<T extends FieldValues & ConversionValues>(
  form: Pick<UseFormReturn<T>, 'reset' | 'setValue'>,
  saved: T,
) {
  // The saved channel becomes the baseline; unsaved values are kept.
  form.reset(saved, { keepDirtyValues: true });
  // Then the conversion's own fields take the saved values. shouldDirty makes
  // the form re-compare them with the baseline, so they read as saved.
  for (const field of ConversionFields as Path<T>[]) {
    form.setValue(field, saved[field], { shouldDirty: true });
  }
}
