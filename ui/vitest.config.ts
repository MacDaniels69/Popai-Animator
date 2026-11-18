import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], exclude: ['tests/composition.test.ts', 'node_modules/**'], environment: 'node', testTimeout: 15000 } });
