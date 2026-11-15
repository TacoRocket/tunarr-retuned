const docs = 'https://github.com/TacoRocket/tunarr-retuned/blob/main';

// The guides published so far, in reading order. They live on main, so the
// links follow the docs as the beta grows.
export const extensionGuideUrls = {
  overview: `${docs}/docs/fork/extensions.md`,
  packageInterface: `${docs}/server/resources/extensions/README.md`,
  styleGuide: `${docs}/docs/fork/extension-style-guide.md`,
  example: 'https://github.com/TacoRocket/tunarr-bazarr-extension',
  feedback: 'https://github.com/TacoRocket/tunarr-retuned/issues/new',
} as const;
