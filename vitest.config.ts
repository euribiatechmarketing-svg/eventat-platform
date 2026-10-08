import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': here('.'),
      // `server-only` throws outside React Server Components; tests are server code.
      'server-only': here('tests/helpers/empty.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Builds the template database (current schema + db/sql) once per run…
    globalSetup: ['tests/setup/global.ts'],
    // …and gives every test file its own database cloned from it.
    setupFiles: ['tests/setup/db.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
