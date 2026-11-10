# Startup instruction for the existing coding ChatGPT chat

Paste the following into the regular ChatGPT chat that has the GitHub app connected.
GitHub cannot deliver a message directly into that idle existing conversation.

```text
Act as the implementation agent for TradeCloseout. The architecture/review lead
coordinates through GitHub issue #6 and PR #5. Read:
https://github.com/omniscient2002/tradecloseout/issues/6
https://github.com/omniscient2002/tradecloseout/pull/5#issuecomment-6765209060
and the latest independent PR review and current branch source before editing.

Reproduce and fix G01-R1 through G01-R5 on the existing PR #5 branch, preserving
concurrent changes. Follow AGENTS.md and docs/engineering/agent-collaboration.md
from main once the tooling PR is merged (until then, read its feature branch).
Use Node 22 / pnpm 12.4.1 / disposable PG16 and Redis / restricted tc_app.

Read the latest PR feedback before each next change. Reply per finding with
fix SHA, source change, meaningful regression, actual CI evidence and limitations,
or concrete evidence disputing it. Do not change review policy, weaken controls,
invent evidence, approve yourself, merge or deploy. Keep PR #5 draft. Missing
production browser/provider/delegation/multi-node evidence remains blocked.

Complete the authorized implementation and verification work in your active task.
When ready for independent review, post a PR comment whose first line is:
REVIEW_READY G01 <full-current-head-SHA>
Then list addressed, disputed and blocked IDs plus exact test/CI links. State
SOURCE_FIXED/CI_VERIFIED only where supported; do not self-certify RELEASE_ACCEPTED.
If a tool/environment blocks work, state the exact blocker in the PR.
```
