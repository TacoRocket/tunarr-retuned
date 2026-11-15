import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { expect, test } from 'vitest';
import { applyConversionToForm } from './applyConversionToForm.ts';

type Values = {
  name: string;
  useEtvNext: boolean;
  streamMode: string;
  transcodeConfigId: string;
};

const savedLegacy: Values = {
  name: 'Cartoons',
  useEtvNext: false,
  streamMode: 'hls',
  transcodeConfigId: 'AAC',
};

test('a conversion overrides unsaved engine choices and keeps other unsaved edits', () => {
  const { result } = renderHook(() =>
    useForm<Values>({ defaultValues: savedLegacy }),
  );
  act(() => {
    result.current.setValue('name', 'Saturday Cartoons', { shouldDirty: true });
    result.current.setValue('streamMode', 'hls_slower', { shouldDirty: true });
  });

  act(() =>
    applyConversionToForm(result.current, {
      ...savedLegacy,
      useEtvNext: true,
      streamMode: 'hls',
      transcodeConfigId: 'AC3',
    }),
  );

  // What a later Save sends.
  expect(result.current.getValues()).toEqual({
    name: 'Saturday Cartoons',
    useEtvNext: true,
    streamMode: 'hls',
    transcodeConfigId: 'AC3',
  });
  // The engine fields now match what's saved; the name is still unsaved.
  expect(result.current.formState.dirtyFields).toEqual({ name: true });
});
