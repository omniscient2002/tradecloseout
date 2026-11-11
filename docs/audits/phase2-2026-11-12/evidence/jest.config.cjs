const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
module.exports = {
 rootDir: path.join(repo,'apps/api'), roots:[__dirname],
 testMatch:[process.env.PHASE2_AUDIT_TARGET === 'g03' ? '**/phase2-g03-probes.spec.ts' : '**/phase2-probes.spec.ts'],
 transform:{'^.+\\.ts$':[require.resolve(path.join(repo,'apps/api/node_modules/ts-jest')),{tsconfig:path.join(__dirname,'tsconfig.json')}]},
 moduleNameMapper:{
  '^@tradecloseout/db/(.*)$':path.join(repo,'packages/db/src/$1'), '^@tradecloseout/db$':path.join(repo,'packages/db/src'),
  '^@tradecloseout/shared/(.*)$':path.join(repo,'packages/shared/src/$1'), '^@tradecloseout/shared$':path.join(repo,'packages/shared/src'),
  '^@tradecloseout/pdf-engine/(.*)$':path.join(repo,'packages/pdf-engine/src/$1'), '^@tradecloseout/pdf-engine$':path.join(repo,'packages/pdf-engine/src'),
 },
 moduleDirectories:[path.join(repo,'apps/api/node_modules'),path.join(repo,'node_modules'),'node_modules'],
 testEnvironment:'node',testTimeout:180000,
};
