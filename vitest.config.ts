import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], env: { VITE_RELAYER_URL: 'https://relayer.test' } } });
