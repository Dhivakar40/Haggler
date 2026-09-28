import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/babel.config.js',
      '**/metro.config.js',
      'apps/api/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
    },
  },
  {
    // NestJS injects by constructor parameter *type* via emitDecoratorMetadata, so those
    // imports must stay real (value) imports; `import type` would break dependency injection.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['**/jest.setup.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/test/**', '**/scripts/**', '**/prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
);
