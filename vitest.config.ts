/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}', 'src/__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/runtime/**']
    }
  }
});
