'use strict';
// G01-007/009/010: an isolated Node.js *process*, not a second Pool in the
// parent Jest VM. It uses the exact production budget helper against a
// disposable PostgreSQL database as restricted tc_app. No delivery adapter.
const { Pool } = require('pg');
const { consumeAuthenticationBudget } = require('../../src/modules/identity/auth-security.ts');
const pool = new Pool({ connectionString: process.env.G01_PROCESS_DATABASE_URL, max: 5 });
pool.on('error', () => {});
const category = process.env.G01_PROCESS_BUDGET_CATEGORY;
const key = process.env.G01_PROCESS_BUDGET_KEY;
let finished = false;
const tell = message => { if (typeof process.send === 'function') process.send(message); };
async function finish() {
  if (finished) return;
  finished = true;
  try { await pool.end(); } catch {}
}
process.on('message', async message => {
  if (message !== 'begin' || finished) return;
  try {
    const outcome = await Promise.allSettled(Array.from({length: 16},
      () => consumeAuthenticationBudget(pool, category, key, 7, 3600)));
    const accepted = outcome.filter(x=>x.status==='fulfilled').length;
    const denied = outcome.length-accepted;
    if (!outcome.filter(x=>x.status==='rejected').every(x=>
      x.reason?.getStatus?.()===429 &&
      x.reason?.getResponse?.()?.code==='RATE_LIMITED')) {
      throw new Error('G01_RATE_LIMIT_DENIAL_CONTRACT_CHANGED');
    }
    tell({done:true,accepted,denied});
  } catch {
    tell({done:true,error:'G01_PROCESS_BUDGET_FAILED'});
  } finally {
    await finish();
  }
});
tell({ready:true});
