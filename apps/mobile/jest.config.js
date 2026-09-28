module.exports = {
  preset: 'jest-expo',
  testTimeout: 20000, // first render in a cold worker is slow (fonts, i18n)
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.spec.*', '!src/app/**'],
  coverageDirectory: 'coverage',
};
