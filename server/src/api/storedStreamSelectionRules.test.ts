import { StreamSelectionProfileSchema } from '@tunarr/types/schemas';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { expect, test } from 'vitest';
import { withRuleDefaults } from './storedStreamSelectionRules.ts';

// A profile row as stored before upstream #1874 added
// subtitleAction.preferTextBased: the field is simply absent.
const storedRow = {
  uuid: '6f1c2c58-6a43-4b8e-9d1a-2f4b1e0c9a11',
  name: 'Original audio and English captions',
  locked: false,
  createdAt: 1792622722592,
  updatedAt: 1792622722592,
  rules: [
    {
      condition: 'true',
      audioAction: { type: 'default' },
      subtitleAction: {
        type: 'by_language',
        languages: ['eng'],
        filterType: 'any',
        allowImageBased: true,
        allowExternal: true,
      },
    },
    {
      condition: 'true',
      audioAction: { type: 'default' },
      subtitleAction: { type: 'default' },
    },
  ],
};

// The same response check the profile routes use.
async function serve(body: unknown) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.get(
    '/profile',
    { schema: { response: { 200: StreamSelectionProfileSchema } } },
    (_req, res) => res.send(body as never),
  );
  const response = await app.inject({ method: 'GET', url: '/profile' });
  await app.close();
  return response;
}

test('serving a stored rule without preferTextBased fails the response check', async () => {
  // This is the 500 the profile list returned.
  expect((await serve(storedRow)).statusCode).toBe(500);
});

test('with the defaults applied it is served, as false', async () => {
  const response = await serve(withRuleDefaults(storedRow));
  expect(response.statusCode).toBe(200);
  const actions = response
    .json<{ rules: { subtitleAction: { preferTextBased: boolean } }[] }>()
    .rules.map((rule) => rule.subtitleAction.preferTextBased);
  expect(actions).toEqual([false, false]);
});

test('a stored value is kept as stored', () => {
  const rule = storedRow.rules[1]!;
  const profile = withRuleDefaults({
    ...storedRow,
    rules: [
      { ...rule, subtitleAction: { type: 'default', preferTextBased: true } },
    ],
  });
  expect(profile.rules[0]?.subtitleAction).toEqual({
    type: 'default',
    preferTextBased: true,
  });
});
