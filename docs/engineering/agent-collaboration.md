# TradeCloseout implementation and independent review protocol

## Roles and authority

The user authorized GitHub-based coordination on 2026-11-10. The implementation
agent writes changes on feature branches. The architecture/review lead identifies
requirements, challenges claims and independently accepts evidence. GitHub Actions
runs repeatable checks and publishes coordination status. The user retains merge
and deployment authority. There is no automatic merge, approval or release certification.

Two agents using the owner's GitHub account are not two independent GitHub approvers.
The existing review on PR #5 is explicitly a COMMENT, not author self-approval.
Keep implementer and reviewer provenance in evidence. Distinct accountable reviewers
are required for REVIEW_VERIFIED and RELEASE_ACCEPTED register claims.

Root and applicable nested AGENTS.md instructions remain authoritative. Use main,
Node 22, the pinned pnpm version, disposable services and restricted tc_app runtime
queries. Preserve unrelated work and append applied migrations rather than editing them.

## Durable records

- Group tracking issue: scope, dependencies, questions and acceptance progress.
- `docs/groups/Gxx/findings.json`: stable original IDs, requirements and evidence.
- `docs/groups/Gxx/acceptance.md`: environment/provider/browser/operational gates.
- PR reviews: exact candidate SHA, file/function, failure scenario, fix direction,
  regression acceptance and confidence/evidence level.
- Implementation reply: finding ID, fix SHA, changed behavior, test/artifact links,
  limitations or concrete evidence disputing the finding.

States: OPEN, IMPLEMENTED, CI_VERIFIED, REVIEW_VERIFIED, RELEASE_ACCEPTED,
DISPUTED, BLOCKED_EXTERNAL and STALE. An implementer may propose a transition;
independent evidence review decides acceptance. New heads require revalidation of
affected assertions. Missing external evidence stays BLOCKED_EXTERNAL.

The JSON validator checks claim structure only. HTTPS links and named reviewers
must still be verified by a person/review agent. Candidate register edits are not
trusted automatically: the privileged coordinator reads its workflow revision on
the default branch. Changes to policy, workflow or acceptance records need review.
Do not set RELEASE_ACCEPTED merely to make a check green.

## Active pilot

G01 is tracked in issue #6; implementation stays in draft PR #5. The initial
independent report and register describe SHA
`0b1523e4deee1abe66e861fe6bbe8e060e0a192a`. They do not claim deployed verification.
The owner confirmed the writer is a regular ChatGPT chat with the GitHub app.
Its single implementation inbox is:
https://github.com/omniscient2002/tradecloseout/pull/5#issuecomment-6765209060

An earlier native Codex request was delivered but the connector rejected startup:
https://github.com/omniscient2002/tradecloseout/pull/5#issuecomment-6765029787
There is no Codex Cloud environment for this repository, and no native coding task
started. Do not confuse that request with the owner's regular ChatGPT coding chat.
The regular-chat handoff is the one writer queue for PR #5. Continue it rather than
starting another writer. This queued request consumes the coordinator's writer budget.

## Coordinator behavior after this tooling PR is merged

`Agent PR coordination` handles:

- Completed runs of the configured application CI workflow. It re-fetches run
  metadata, requires the registered PR, same repository and exact current head,
  and discards superseded runs. A successful CI run can request an independent
  reviewer inbox once per SHA, or a native Codex review only if separately configured
  and verified. An inbox comment does not wake an idle existing conversation.
- Single-line PR comments from human repository writers/maintainers/admins:
  `/agent-review status G01`, `/agent-review review G01`, or
  `/agent-review implement G01`. Bots, arbitrary prose and non-PR issues are ignored.
- An implementer's `REVIEW_READY G01 <full-head-SHA>` first line followed by evidence.
  It requires a human writer identity and the actual current candidate SHA, then
  queues an independent reviewer handoff.
- Manual workflow dispatch on main with a configured group and action.

It updates one bot-owned status comment; it never changes source, finding status,
permissions, approvals or merges. CI success is described as CI evidence only.
The job uses contents/actions/issues read and pull-requests write for PR conversation
comments. Keep the repository's Actions pull-request approval setting disabled;
no contents-write token is provided and the code contains no approval/merge API.
Changes to the coordinator workflow also run a live comment-permission smoke on
trusted same-repository PRs. It checks out only the already trusted base commit,
not candidate code, and performs a status-only publication with the real job token.
It never executes candidate code with its comment-write token. Job concurrency is
serialized; handoffs are idempotent by PR/head/action. One implementation
request per PR is permitted and the pilot's existing request consumes it. Native
review requests are separate from coding tasks and do not authorize a second writer.

`Group review protocol verification / group-register` validates the inventory and
runs coordinator boundary tests on PRs. The full application CI remains required;
protocol validation is not application or production acceptance.

## Transport activation and honest acknowledgement

Default delivery is the owner's regular coding/review chats using the GitHub app.
The user must start/resume each existing chat; neither this workflow nor an @mention
can wake it. Give the writer `docs/engineering/implementation-startup.md` once,
then have it read current PR feedback throughout its active task. The architecture
lead reads REVIEW_READY replies on its next active turn. Fully unattended agents
require a separately provisioned agent runner; this setup does not claim one exists.

Optional native Codex requests are gated by repository variable
`AGENT_NATIVE_TRANSPORT_VERIFIED=true`. Set it only after the actual Codex app
acknowledges a real request on this repository. An enabled GitHub connector is
insufficient evidence of a Codex Cloud integration or an event route to an existing
ChatGPT conversation. Also verify that requests authored by github-actions[bot]
are supported; a human-authored request alone does not prove bot-origin dispatch.

If the bot-origin route is unsupported, keep the variable false and use the same
structured handoff with the connected coding chat. Deterministic CI/status and
reviewer-inbox coordination still works. Do not store a personal
access token just to impersonate a human and evade this boundary.

No OpenAI API key is required by these workflows. A future API-backed agent runner
needs its own explicitly configured credentials/budget and independent review; no
local .codex, .aws, .env or production secrets may be copied into Actions.

The workflow file must reach main before issue_comment/workflow_run triggers are
live. Repository protection must require the actual successful `verify-and-test`
and `group-register` contexts after adoption. A new push requires fresh CI and
affected review. Keep release-blocked PRs draft. No automatic state machine here
can replace the user's merge decision or the external 21-row acceptance.

## Review and implementation contracts

Review each confirmed defect with stable ID, severity, exact source SHA, failure
scenario, smallest safe correction and meaningful positive/negative/failure checks.
Distinguish static inference from a reproduced defect. Withdraw disproven findings
with evidence instead of silently deleting them. Use source at the actual head,
not a dated report, to determine what remains.

The implementer must reproduce the relevant mechanism, patch confirmed defects,
run appropriate regressions and reply per finding. If blocked by external provider,
legal delegation, missing service or account setup, state the specific missing
evidence. Never manufacture documents, pretend delivery succeeded, weaken RLS,
disable MFA/CSRF/replay controls or change acceptance policy to pass.

Evaluate security, tenant isolation, HVAC domain correctness, migrations, regressions
and real CI on the proposed head. Require relevant production-mode browser,
distributed-failure and provider acceptance separately. An unchanged lower-risk
surface can reuse explicitly applicable evidence; modified assertions must be retested.

Official native integration reference:
https://learn.chatgpt.com/docs/third-party/github
