const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
module.exports = {
  rootDir: path.join(repo, 'apps/api'),
  roots: [__dirname],
  testMatch: ['**/g03-probes.spec.ts'],
  transform: { '^.+\\.ts$': [require.resolve(path.join(repo, 'apps/api/node_modules/ts-jest')), { tsconfig: path.join(repo, 'apps/api/tsconfig.json') }] },
  moduleNameMapper: {
    '^@tradecloseout/db$': path.join(repo, 'packages/db/src'),
    '^@tradecloseout/shared$': path.join(repo, 'packages/shared/src'),
  },
  moduleDirectories: [path.join(repo, 'apps/api/node_modules'), path.join(repo, 'node_modules'), 'node_modules'],
  testEnvironment: 'node',
  testTimeout: 120000,
};
