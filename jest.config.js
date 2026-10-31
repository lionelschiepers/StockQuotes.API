module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  // Transpile-only: `pnpm run build` (tsc) is the type gate. This keeps the
  // unit-test suite fast instead of type-checking every file twice.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { isolatedModules: true } }],
  },
};
