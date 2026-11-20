import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  test: {
    // The first request pays for loading the Worker bundle, past the 5s default.
    testTimeout: 30_000,
    setupFiles: ['./test/apply-migrations.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SLACK_SIGNING_SECRET: 'test-signing-secret',
          SLACK_BOT_TOKEN: 'xoxb-test',
          SLACK_CLIENT_TOKEN: 'xoxc-test',
          SLACK_D_COOKIE: 'xoxd-test',
          GOOGLE_CLIENT_ID: 'google-client-id',
          GOOGLE_CLIENT_SECRET: 'google-client-secret',
          // Base64 of 32 bytes, as PIP_SECRETS_KEY is.
          PIP_SECRETS_KEY: 'cGlwLXRlc3Qtc2VjcmV0cy1rZXktMzItYnl0ZXMhISE=',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
});
