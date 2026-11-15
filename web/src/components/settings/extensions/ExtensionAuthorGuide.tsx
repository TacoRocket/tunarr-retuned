import { Trans } from '@lingui/react/macro';
import { Code, OpenInNew } from '@mui/icons-material';
import { Box, Link, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { extensionGuideUrls } from './extensionGuideUrls.ts';

function GuideLink({
  href,
  label,
  description,
}: {
  href: string;
  label: ReactNode;
  description: ReactNode;
}) {
  return (
    <Box>
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        variant="body2"
        fontWeight={600}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        {label}
        <OpenInNew sx={{ fontSize: 'inherit' }} />
      </Link>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    </Box>
  );
}

export function ExtensionAuthorGuide({ apiVersion }: { apiVersion: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 4 }}>
      <Stack direction="row" spacing={2}>
        <Box sx={{ pt: 0.25, color: 'text.secondary' }}>
          <Code />
        </Box>
        <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              <Trans>Build an extension</Trans>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <Trans>
                An extension is a JavaScript package in a public GitHub
                repository. This is what we have written up so far for extension
                API {apiVersion}.
              </Trans>
            </Typography>
          </Box>
          <GuideLink
            href={extensionGuideUrls.overview}
            label={<Trans>How extensions work</Trans>}
            description={
              <Trans>
                What an extension can and can't do, and what is planned.
              </Trans>
            }
          />
          <GuideLink
            href={extensionGuideUrls.packageInterface}
            label={<Trans>Package interface</Trans>}
            description={
              <Trans>
                The manifest, code, service requests, limits and sandbox.
              </Trans>
            }
          />
          <GuideLink
            href={extensionGuideUrls.styleGuide}
            label={<Trans>Style guide</Trans>}
            description={
              <Trans>
                What makes an extension easy to set up, trust and support.
              </Trans>
            }
          />
          <GuideLink
            href={extensionGuideUrls.example}
            label={<Trans>Bazarr extension</Trans>}
            description={<Trans>A complete extension to start from.</Trans>}
          />
          <Typography variant="body2">
            <Trans>
              Hit a limit, or need something extensions can't do yet?{' '}
              <Link
                href={extensionGuideUrls.feedback}
                target="_blank"
                rel="noopener noreferrer"
              >
                Tell us what you're trying to build
              </Link>
              .
            </Trans>
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}
