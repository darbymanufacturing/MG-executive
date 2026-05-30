import { defineConfig } from 'vitest/config';

// Separate config for Firestore rules tests: these run in NODE (not jsdom) against
// the Firestore emulator started by `firebase emulators:exec` (npm run test:rules).
// Kept out of the default vitest run so the unit suite stays emulator-free.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.rules.test.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false, // share one emulator; avoid cross-file ruleset races
  },
});
