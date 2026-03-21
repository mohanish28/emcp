import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      // allow tests to import from 'src/...' without .js extensions
      '@': resolve(__dirname, 'src'),
    },
    extensions: ['.ts', '.js'],
  },
  esbuild: {
    target: 'node18',
  },
})
