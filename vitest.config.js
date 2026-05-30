import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Rules tests need the Firestore emulator — run them via `npm run test:rules`
    // (vitest.rules.config.js), not in the default jsdom unit run.
    exclude: [...configDefaults.exclude, '**/*.rules.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/utils/**/*.js'],
      exclude: ['src/utils/__tests__/**', 'src/utils/sampleData.js', 'src/utils/*SeedData.js'],
    },
  },
});
