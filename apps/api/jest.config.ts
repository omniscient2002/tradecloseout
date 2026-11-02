import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@tradecloseout/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@tradecloseout/shared$': '<rootDir>/../../packages/shared/src',
    '^@tradecloseout/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@tradecloseout/db$': '<rootDir>/../../packages/db/src',
    '^@tradecloseout/pdf-engine/(.*)$': '<rootDir>/../../packages/pdf-engine/src/$1',
    '^@tradecloseout/pdf-engine$': '<rootDir>/../../packages/pdf-engine/src',
  },
};

export default config;
