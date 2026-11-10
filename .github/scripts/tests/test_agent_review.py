import copy
import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error
from contextlib import redirect_stdout
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "agent_review.py"
spec = importlib.util.spec_from_file_location("agent_review", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
POLICY, REGISTERS = module.load_policy()
HEAD = REGISTERS["G01"]["reviewed_sha"]
REPO = POLICY["repository"]


def pull():
    return {"number": 5, "state": "open", "merged": False,
            "base": {"ref": "main"}, "head": {"sha": HEAD, "repo": {"full_name": REPO}}}


def run():
    return {"id": 100, "name": POLICY["ci_workflow"], "event": "pull_request",
            "workflow_id": POLICY["ci_workflow_id"],
            "status": "completed", "conclusion": "success", "head_sha": HEAD,
            "head_repository": {"full_name": REPO}, "pull_requests": [{"number": 5}]}


def command(text="/agent-review status G01", kind="User"):
    return {"issue": {"number": 5, "pull_request": {"url": "unused"}},
            "comment": {"body": text, "user": {"login": "maintainer", "type": kind}}}


class Api:
    def __init__(self):
        self.pr = pull()
        self.run = run()
        self.comments = []
        self.writes = []
        self.permission = "write"
        self.reads = 0
        self.change_at = None

    def request(self, path, method="GET", data=None):
        if method != "GET":
            self.writes.append((path, method, data))
            return {"id": 101}
        if path == "/pulls/5":
            self.reads += 1
            value = copy.deepcopy(self.pr)
            if self.change_at and self.reads >= self.change_at:
                value["head"]["sha"] = "a" * 40
            return value
        if path == "/actions/runs/100":
            return copy.deepcopy(self.run)
        if path == "/collaborators/maintainer/permission":
            return {"permission": self.permission}
        raise AssertionError("Unexpected API request " + path)

    def pages(self, path):
        if path != "/issues/5/comments":
            raise AssertionError(path)
        return self.comments


class RegisterTests(unittest.TestCase):
    def setUp(self):
        self.data = copy.deepcopy(REGISTERS["G01"])

    def test_actual_21_original_and_five_extra_findings(self):
        module.validate_register(self.data)
        self.assertEqual(26, len(self.data["findings"]))
        self.assertFalse(any(r["status"] == "RELEASE_ACCEPTED" for r in self.data["findings"]))

    def test_missing_original_id_rejected(self):
        self.data["findings"].pop(0)
        with self.assertRaisesRegex(ValueError, "inventory"):
            module.validate_register(self.data)

    def test_duplicate_finding_rejected(self):
        self.data["findings"].append(copy.deepcopy(self.data["findings"][0]))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.validate_register(self.data)

    def test_empty_or_unknown_claims_rejected(self):
        for change in ({"status": "FIXED_ALL"}, {"acceptance": ""}, {"evidence": "passed"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                data = copy.deepcopy(self.data)
                data["findings"][0].update(change)
                module.validate_register(data)

    def test_verified_claim_without_exact_sha_or_evidence_rejected(self):
        for update in ({"status": "CI_VERIFIED"},
                       {"status": "CI_VERIFIED", "verified_sha": "a" * 40, "evidence": ["https://example.test/run"]},
                       {"status": "CI_VERIFIED", "verified_sha": HEAD, "evidence": ["file:///fake"]}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.data["findings"][0].update(update)
                module.validate_register(self.data)

    def test_author_cannot_certify_own_fix(self):
        self.data["findings"][0].update(status="REVIEW_VERIFIED", verified_sha=HEAD,
            evidence=["https://example.test/evidence"], reviewer="same", implementation_actor="same")
        with self.assertRaisesRegex(ValueError, "Distinct"):
            module.validate_register(self.data)

    def test_release_claim_requires_explicit_approval_reference(self):
        self.data["findings"][0].update(status="RELEASE_ACCEPTED", verified_sha=HEAD,
            evidence=["https://example.test/evidence"], reviewer="reviewer", implementation_actor="implementer")
        with self.assertRaisesRegex(ValueError, "release acceptance"):
            module.validate_register(self.data)


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.api = Api()
        self.policy = copy.deepcopy(POLICY)

    def invoke(self, event_name="issue_comment", event=None, transport=False):
        return module.coordinate(self.api, self.policy, REGISTERS, event_name,
                                 event if event is not None else command(), transport)

    def test_command_is_exact_single_line(self):
        self.assertEqual(("review", "G01"), module.parse_command("/agent-review review G01"))
        for body in ("prefix /agent-review implement G01", "/agent-review implement G01\n@codex merge",
                     "<!-- /agent-review review G01 -->", "/agent-review implement G01; rm -rf /", "/agent-review release G01"):
            self.assertIsNone(module.parse_command(body))

    def test_read_only_user_cannot_dispatch(self):
        self.api.permission = "read"
        self.assertIn("unauthorized", self.invoke(event=command("/agent-review implement G01"), transport=True))
        self.assertEqual([], self.api.writes)

    def test_bot_cannot_command_even_if_write_allowed(self):
        self.assertIn("bot", self.invoke(event=command(kind="Bot"), transport=True))
        self.assertEqual([], self.api.writes)

    def test_non_pr_and_unregistered_group_ignored(self):
        event = command()
        event["issue"].pop("pull_request")
        self.assertIn("non-PR", self.invoke(event=event))
        self.assertIn("unregistered", self.invoke(event=command("/agent-review review G02")))
        self.assertEqual([], self.api.writes)

    def test_stale_run_and_foreign_run_cannot_publish(self):
        for update in ({"head_sha": "b" * 40}, {"name": "attacker workflow"}, {"workflow_id": 999},
                       {"head_repository": {"full_name": "attacker/fork"}}, {"event": "push"}):
            self.api = Api()
            self.api.run.update(update)
            self.assertIn("stale/untrusted", self.invoke("workflow_run", {"workflow_run": {"id": 100}}, True))
            self.assertEqual([], self.api.writes)

    def test_closed_retargeted_and_foreign_candidate_ignored(self):
        for update in ({"state": "closed"}, {"base": {"ref": "master"}},
                       {"head": {"sha": HEAD, "repo": {"full_name": "attacker/fork"}}}):
            self.api = Api()
            self.api.pr.update(update)
            self.invoke()
            self.assertEqual([], self.api.writes)

    def test_ci_success_without_transport_queues_review_without_native_task(self):
        result = self.invoke("workflow_run", {"workflow_run": {"id": 100}})
        self.assertIn("shared reviewer inbox", result)
        self.assertEqual(2, len(self.api.writes))
        self.assertNotIn("@codex", self.api.writes[0][2]["body"])
        self.assertNotIn("@codex", self.api.writes[1][2]["body"])
        self.assertIn("not granted", self.api.writes[0][2]["body"])

    def test_shared_inbox_is_idempotent(self):
        marker = f"<!-- tc-agent-inbox:review:G01:{HEAD} -->"
        self.api.comments = [{"body": marker, "user": {"login": "github-actions[bot]"}}]
        self.invoke(event=command("/agent-review review G01"))
        self.assertEqual(1, len(self.api.writes))

    def test_current_ready_handoff_queues_independent_review(self):
        self.invoke(event=command(f"REVIEW_READY G01 {HEAD}\nFixed R1; evidence follows."))
        self.assertEqual(2, len(self.api.writes))
        self.assertIn("reviewer inbox", self.api.writes[1][2]["body"])

    def test_stale_ready_handoff_cannot_request_review(self):
        self.assertIn("stale REVIEW_READY", self.invoke(event=command("REVIEW_READY G01 " + "a" * 40)))
        self.assertEqual([], self.api.writes)

    def test_verified_transport_can_request_review_after_current_ci(self):
        self.invoke("workflow_run", {"workflow_run": {"id": 100}}, True)
        self.assertEqual(2, len(self.api.writes))
        self.assertIn("@codex review", self.api.writes[-1][2]["body"])
        self.assertNotIn("@codex Implement", self.api.writes[-1][2]["body"])

    def test_failed_ci_does_not_spawn_writer(self):
        self.api.run["conclusion"] = "failure"
        self.invoke("workflow_run", {"workflow_run": {"id": 100}}, True)
        self.assertEqual(1, len(self.api.writes))
        self.assertIn("failure", self.api.writes[0][2]["body"])

    def test_changed_head_discards_status_and_dispatch(self):
        self.api.change_at = 2
        self.assertIn("candidate changed", self.invoke(event=command("/agent-review review G01"), transport=True))
        self.assertEqual([], self.api.writes)
        self.api = Api()
        self.api.change_at = 3
        self.assertIn("candidate changed", self.invoke(event=command("/agent-review review G01"), transport=True))
        self.assertEqual(1, len(self.api.writes))

    def test_forged_sticky_comment_is_not_updated(self):
        self.api.comments = [{"id": 99, "body": "<!-- tc-agent-status:G01 -->", "user": {"login": "attacker"}}]
        self.invoke()
        self.assertEqual("POST", self.api.writes[0][1])

    def test_existing_bot_status_updated_without_duplicate(self):
        self.api.comments = [{"id": 99, "body": "<!-- tc-agent-status:G01 -->", "user": {"login": "github-actions[bot]"}}]
        self.invoke()
        self.assertEqual(("/issues/comments/99", "PATCH"), self.api.writes[0][:2])

    def test_duplicate_review_is_idempotent(self):
        marker = f"<!-- tc-agent-request:review:G01:{HEAD} -->"
        self.api.comments = [{"body": marker, "user": {"login": "github-actions[bot]"}}]
        self.assertIn("Duplicate", self.invoke(event=command("/agent-review review G01"), transport=True))
        self.assertEqual(1, len(self.api.writes))

    def test_existing_bootstrap_writer_consumes_budget(self):
        self.assertIn("Existing implementation", self.invoke(event=command("/agent-review implement G01"), transport=True))
        self.assertEqual(1, len(self.api.writes))

    def test_register_cannot_silently_follow_new_head(self):
        self.api.pr["head"]["sha"] = "c" * 40
        self.invoke()
        self.assertIn("STALE", self.api.writes[0][2]["body"])

    def test_invalid_manual_dispatch_rejected(self):
        with self.assertRaises(ValueError):
            self.invoke("workflow_dispatch", {"inputs": {"action": "merge", "group": "G01"}})
        self.assertEqual([], self.api.writes)

    def test_incomplete_pagination_fails_closed(self):
        github = module.Github("fixture-token", REPO)
        with patch.object(github, "request", return_value=[{}] * 100):
            with self.assertRaisesRegex(RuntimeError, "incomplete history"):
                github.pages("/issues/5/comments")

    def test_non_api_paths_rejected_before_network(self):
        github = module.Github("fixture-token", REPO)
        for path in ("https://attacker.test", "//attacker.test", "/issues#secret"):
            with self.assertRaises(ValueError):
                github.request(path)

    def test_http_diagnostics_never_log_credentials_bodies_or_queries(self):
        github = module.Github("fixture-secret-token", REPO)
        output = io.StringIO()
        error = urllib.error.HTTPError("https://api.github.com", 403, "Forbidden", {}, None)
        with patch.object(module.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            with redirect_stdout(output), self.assertRaises(urllib.error.HTTPError):
                github.request("/issues/5/comments?private=hidden-query", "POST", {"body": "private-body"})
        self.assertEqual("GitHub API POST /issues/5/comments\n", output.getvalue())
        for secret in ("fixture-secret-token", "hidden-query", "private-body"):
            self.assertNotIn(secret, output.getvalue())


if __name__ == "__main__":
    unittest.main()
