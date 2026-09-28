module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  testTimeout: 180000, // first run pulls container images
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
};
