module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/*.module.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage-integration',
  testTimeout: 180000, // first run pulls container images
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
};
