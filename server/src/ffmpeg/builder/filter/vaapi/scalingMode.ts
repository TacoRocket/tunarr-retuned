// Explicit default lets the driver select its dedicated scaler instead of FFmpeg's HQ request.
export function vaapiScalingModeOption(
  // Callers decide: a CRT channel's tier, else Settings → Features
  // "Driver-Default VAAPI Scaling".
  preferDedicatedScaler = false,
): string {
  return preferDedicatedScaler ? ':mode=default' : '';
}
