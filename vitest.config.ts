import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Account tests run memory-intensive scrypt and independent databases.
  test: { maxWorkers: 2 },
});
