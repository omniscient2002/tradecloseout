"""Trusted-base PR coordination. Never checks out/runs candidate code or approves it."""
import collections
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-f]{40}\Z")
STATUSES = {"OPEN", "IMPLEMENTED", "CI_VERIFIED", "REVIEW_VERIFIED",
            "RELEASE_ACCEPTED", "DISPUTED", "BLOCKED_EXTERNAL", "STALE"}
COMMAND = re.compile(r"/agent-review (status|review|implement)(?: (G\d{2}))?\Z")


def validate_register(data):
    """Validate claims, not their truth. Acceptance still requires independent review."""
    group = data.get("group", "")
    if data.get("schema_version") != 1 or not re.fullmatch(r"G\d{2}", group):
        raise ValueError("Invalid register version/group")
    if not SHA.fullmatch(data.get("reviewed_sha", "")):
        raise ValueError("Exact reviewed SHA required")
    if not isinstance(data.get("original_finding_count"), int) or data["original_finding_count"] < 1:
        raise ValueError("Original finding count required")
    rows = data.get("findings")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Nonempty findings required")
    ids = []
    for row in rows:
        ident = row.get("id", "")
        if not re.fullmatch(re.escape(group) + r"-(?:\d{3}|R\d+)", ident):
            raise ValueError("Invalid finding ID")
        ids.append(ident)
        if row.get("status") not in STATUSES:
            raise ValueError("Unknown finding status")
        for key in ("requirement", "acceptance", "evidence_level"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise ValueError("Finding requires " + key)
        if not isinstance(row.get("evidence"), list):
            raise ValueError("Evidence list required")
        if row["status"] in {"CI_VERIFIED", "REVIEW_VERIFIED", "RELEASE_ACCEPTED"}:
            if not SHA.fullmatch(row.get("verified_sha", "")) or row["verified_sha"] != data["reviewed_sha"]:
                raise ValueError("Verification must match reviewed SHA")
            if not row["evidence"] or any(not isinstance(url, str) or not url.startswith("https://")
                                           for url in row["evidence"]):
                raise ValueError("Verifiable HTTPS evidence required")
        if row["status"] in {"REVIEW_VERIFIED", "RELEASE_ACCEPTED"}:
            if not row.get("reviewer") or not row.get("implementation_actor") or row["reviewer"] == row["implementation_actor"]:
                raise ValueError("Distinct accountable reviewer required")
        if row["status"] == "RELEASE_ACCEPTED" and not str(row.get("release_approval_url", "")).startswith("https://"):
            raise ValueError("Explicit release acceptance required")
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate finding ID")
    expected = {f"{group}-{i:03}" for i in range(1, data["original_finding_count"] + 1)}
    if {ident for ident in ids if re.fullmatch(re.escape(group) + r"-\d{3}", ident)} != expected:
        raise ValueError("Original finding inventory changed")
    return data


def parse_command(body):
    # Whole, single-line commands only. Hidden instructions and arbitrary @mentions
    # in external PR bodies/review text are never copied into coding prompts.
    match = COMMAND.fullmatch(body.strip())
    return match.groups() if match else None


def can_command(comment, permission):
    return comment.get("user", {}).get("type") == "User" and permission in {"write", "maintain", "admin"}


def current_run(run, pr, repository, workflow_name, workflow_id):
    return (run.get("name") == workflow_name and run.get("event") == "pull_request"
            and run.get("workflow_id") == workflow_id
            and run.get("status") == "completed" and run.get("head_sha") == pr["head"]["sha"]
            and run.get("head_repository", {}).get("full_name") == repository
            and pr["head"].get("repo", {}).get("full_name") == repository
            and any(item.get("number") == pr["number"] for item in run.get("pull_requests", [])))


def reserve_request(comments, marker, kind, maximum):
    # A request is idempotent for its exact head. Bound all implementation
    # requests across heads; a human must reconsider after the budget is used.
    if any(marker in c.get("body", "") and c.get("user", {}).get("login") == "github-actions[bot]"
           for c in comments):
        return False
    if kind == "implement":
        return sum("<!-- tc-agent-request:implement:" in c.get("body", "")
                   for c in comments if c.get("user", {}).get("login") == "github-actions[bot]") < maximum
    return True


class Github:
    def __init__(self, token, repository):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
            raise ValueError("Invalid repository")
        self.token = token
        self.repository = repository

    def request(self, path, method="GET", data=None):
        # All paths are constructed internally. No external URLs or redirects
        # may receive the GitHub token, including artifact download URLs.
        if not path.startswith("/") or path.startswith("//") or "#" in path or "://" in path:
            raise ValueError("Invalid API path")
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        req = urllib.request.Request("https://api.github.com/repos/" + self.repository + path,
            data=json.dumps(data).encode() if data is not None else None, method=method,
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            return json.load(response)

    def pages(self, path):
        result = []
        for page in range(1, 101):
            rows = self.request(f"{path}?per_page=100&page={page}")
            result.extend(rows)
            if len(rows) < 100:
                return result
        raise RuntimeError("Pagination limit reached; refusing incomplete history")


def load_policy(root=ROOT):
    policy = json.loads((root / ".github/agent-review/policy.json").read_text())
    registers = {}
    for group, config in policy["groups"].items():
        path = (root / config["register"]).resolve()
        if not path.is_relative_to((root / "docs/groups").resolve()):
            raise ValueError("Register outside trusted directory")
        data = validate_register(json.loads(path.read_text()))
        if data["group"] != group:
            raise ValueError("Group mismatch")
        registers[group] = data
    return policy, registers


def summary(group, register, pr, conclusion):
    counts = collections.Counter(row["status"] for row in register["findings"])
    stale = register["reviewed_sha"] != pr["head"]["sha"]
    lines = [f"<!-- tc-agent-status:{group} -->", f"## {group} engineering coordination",
             f"Candidate: `{pr['head']['sha']}`", f"CI: **{conclusion}** (not release acceptance).",
             f"Register baseline: `{register['reviewed_sha']}`; " + ("**STALE — re-review required.**" if stale else "same candidate."),
             "", "| Status | Findings |", "|---|---:|"]
    lines.extend(f"| {status} | {count} |" for status, count in sorted(counts.items()))
    lines.extend(["", "**Release acceptance is not granted by this bot.** The register is read from the trusted default branch;",
                  "unmerged candidate edits cannot certify themselves. Findings need reviewer-accepted evidence,",
                  "including external/provider/staging gates. No merge or deployment is performed."])
    return "\n".join(lines)


def coordinate(api, policy, registers, event_name, event, transport=False):
    action = "status"
    group_filter = None
    ready_sha = None
    run = None
    if event_name == "issue_comment":
        if not event.get("issue", {}).get("pull_request"):
            return "Ignored non-PR comment"
        body = event.get("comment", {}).get("body", "")
        ready = re.fullmatch(r"REVIEW_READY (G\d{2}) ([0-9a-f]{40})(?:\n[\s\S]*)?", body.strip())
        parsed = ("review", ready[1]) if ready else parse_command(body)
        ready_sha = ready[2] if ready else None
        if not parsed:
            return "Ignored non-command comment"
        if event["comment"].get("user", {}).get("type") != "User":
            return "Ignored bot command"
        login = event["comment"]["user"]["login"]
        permission = api.request("/collaborators/" + urllib.parse.quote(login, safe="") + "/permission")["permission"]
        if not can_command(event["comment"], permission):
            return "Ignored unauthorized/bot command"
        action, group_filter = parsed
        number = event["issue"]["number"]
    elif event_name == "workflow_run":
        # Re-fetch the run to avoid trusting a cross-workflow injected payload.
        run = api.request("/actions/runs/" + str(int(event["workflow_run"]["id"])))
        matches = [config["pull_request"] for config in policy["groups"].values()
                   if any(p.get("number") == config["pull_request"] for p in run.get("pull_requests", []))]
        if len(matches) != 1:
            return "Ignored unregistered/ambiguous run"
        number = matches[0]
    elif event_name == "workflow_dispatch":
        inputs = event.get("inputs", {})
        action = inputs.get("action", "status")
        group_filter = inputs.get("group", "G01")
        if action not in {"status", "review", "implement"} or group_filter not in policy["groups"]:
            raise ValueError("Invalid dispatch")
        number = policy["groups"][group_filter]["pull_request"]
    else:
        return "Ignored event"

    matches = [(group, conf) for group, conf in policy["groups"].items()
               if conf["pull_request"] == number and (group_filter is None or group_filter == group)]
    if len(matches) != 1:
        return "Ignored unregistered/ambiguous PR"
    group, config = matches[0]
    pr = api.request("/pulls/" + str(number))
    if pr["state"] != "open" or pr.get("merged") or pr["base"]["ref"] != "main":
        return "Ignored closed/retargeted PR"
    if pr["head"].get("repo", {}).get("full_name") != policy["repository"]:
        return "Ignored foreign head repository"
    if ready_sha and ready_sha != pr["head"]["sha"]:
        return "Ignored stale REVIEW_READY handoff"
    if run and not current_run(run, pr, policy["repository"], policy["ci_workflow"], policy["ci_workflow_id"]):
        return "Ignored stale/untrusted CI run"
    comments = api.pages(f"/issues/{number}/comments")
    status_body = summary(group, registers[group], pr, run["conclusion"] if run else "not evaluated by this request")
    marker = f"<!-- tc-agent-status:{group} -->"
    existing = next((c for c in comments if marker in c.get("body", "")
                     and c.get("user", {}).get("login") == "github-actions[bot]"), None)
    # Recheck immediately before publishing, including explicit comment commands.
    if api.request("/pulls/" + str(number))["head"]["sha"] != pr["head"]["sha"]:
        return "Discarded result: candidate changed"
    if existing:
        api.request("/issues/comments/" + str(existing["id"]), "PATCH", {"body": status_body})
    else:
        api.request(f"/issues/{number}/comments", "POST", {"body": status_body})
    if run and run["conclusion"] == "success":
        action = "review"
    if action == "status":
        return "Published coordination status"
    if action == "implement" and config.get("implementation_request_url"):
        return "Existing implementation request consumes writer budget; continue " + config["implementation_request_url"]
    if not transport:
        inbox_marker = f"<!-- tc-agent-inbox:{action}:{group}:{pr['head']['sha']} -->"
        if reserve_request(comments, inbox_marker, "inbox", 1):
            body = (inbox_marker + f"\n## {group} reviewer inbox\n\n"
                    f"Review requested for exact candidate `{pr['head']['sha']}`. Tracking issue #{config['tracking_issue']}.\n\n"
                    f"Read `{config['register']}` and `docs/engineering/agent-collaboration.md` from main, "
                    "inspect source and actual CI evidence, and independently accept/reject each claimed fix. "
                    "Publish stable finding IDs, exact SHA, reproduction status, corrections and verification criteria. "
                    "Do not equate green CI with external/provider/staging acceptance. No merge or release authorization.\n\n"
                    "Delivery: shared GitHub inbox for the architecture/review chat. No native coding task was started; "
                    "this comment cannot wake an idle existing ChatGPT conversation.")
            if api.request("/pulls/" + str(number))["head"]["sha"] != pr["head"]["sha"]:
                return "Discarded inbox: candidate changed"
            api.request(f"/issues/{number}/comments", "POST", {"body": body})
        return "Published shared reviewer inbox; no native task dispatched"
    request_marker = f"<!-- tc-agent-request:{action}:{group}:{pr['head']['sha']} -->"
    if not reserve_request(comments, request_marker, action, policy["max_implementation_requests"]):
        return "Duplicate request or implementation budget exhausted"
    # Never automatically start a writer from a CI event. Only a trusted human
    # command/dispatch can authorize each bounded implementation request.
    if action == "implement":
        if any("<!-- tc-agent-request:implement:" in c.get("body", "")
               and c.get("user", {}).get("login") == "github-actions[bot]"
               for c in comments):
            raise ValueError("Writer already requested; use its existing task, do not start competing writers")
        prompt = (f"@codex Implement the open source findings for {group} in tracking issue #{config['tracking_issue']}. "
                  f"Read docs/engineering/agent-collaboration.md and {config['register']} from main. "
                  "Reproduce each finding against this exact current head before editing; preserve existing work. "
                  "Reply per ID with fix SHA, regression evidence and limitations. Follow AGENTS.md. "
                  "No self-acceptance, weakening controls, merge or deployment. Keep the implementation PR draft.")
    else:
        prompt = (f"@codex review for {group} security, tenant isolation, migrations, domain correctness and regressions. "
                  f"Use tracking issue #{config['tracking_issue']} and {config['register']} from main. "
                  "Include original finding IDs in evidence. Independently inspect claimed fixes and test relevance. "
                  "Do not equate CI success with external/provider/staging acceptance or modify application code.")
    if api.request("/pulls/" + str(number))["head"]["sha"] != pr["head"]["sha"]:
        return "Discarded dispatch: candidate changed"
    api.request(f"/issues/{number}/comments", "POST", {"body": request_marker + "\n" + prompt +
                f"\n\nRequested candidate: `{pr['head']['sha']}`. Transport acknowledgement must be observed; posting is not task completion."})
    return "Published native Codex request; acknowledgement not asserted"


def main():
    policy, registers = load_policy()
    if sys.argv[1:] == ["validate"]:
        print("Validated register structure for " + ", ".join(registers) + "; no acceptance asserted")
        return
    if sys.argv[1:] != ["event"]:
        raise ValueError("Use validate or event")
    if os.environ["GITHUB_REPOSITORY"] != policy["repository"]:
        raise ValueError("Repository mismatch")
    event = json.loads(pathlib.Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    api = Github(os.environ["GITHUB_TOKEN"], policy["repository"])
    print(coordinate(api, policy, registers, os.environ["GITHUB_EVENT_NAME"], event,
                     os.environ.get("AGENT_NATIVE_TRANSPORT_VERIFIED") == "true"))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        print(f"GitHub API failed with HTTP {error.code}; no credentials or response body logged", file=sys.stderr)
        sys.exit(1)
