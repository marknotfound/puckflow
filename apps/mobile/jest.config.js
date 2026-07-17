export default {
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@puckflow/api-client$':
      '<rootDir>/../../packages/api-client/src/index.ts',
    '^@puckflow/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@puckflow/ui-tokens$': '<rootDir>/../../packages/ui-tokens/src/index.ts',
  },
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  watchman: false,
}
