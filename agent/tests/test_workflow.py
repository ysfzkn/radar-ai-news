"""The scheduled workflow is checked by reading the file; it cannot be run here."""

import re
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
ALLOWED_ACTIONS = ("actions/checkout@", "astral-sh/setup-uv@")


def load(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


def triggers(data: dict) -> dict:
    # YAML 1.1 reads the key `on` as the boolean True.
    return data.get("on", data.get(True))


def job() -> dict:
    jobs = load("daily.yml")["jobs"]
    assert len(jobs) == 1
    return next(iter(jobs.values()))


def steps() -> list[dict]:
    return job()["steps"]


def step_index(step_id: str) -> int:
    return next(i for i, s in enumerate(steps()) if s.get("id") == step_id)


def test_schedule_and_manual_trigger():
    on = triggers(load("daily.yml"))
    assert on["schedule"] == [{"cron": "15 4 * * *"}]
    inputs = on["workflow_dispatch"]["inputs"]
    assert list(inputs) == ["max_stories"]
    assert inputs["max_stories"]["type"] == "string"
    assert inputs["max_stories"]["default"] == ""


def test_permissions_and_concurrency():
    data = load("daily.yml")
    assert data["permissions"] == {"contents": "read"}
    # The job needs write for the one step that pushes the state branch; nothing else.
    assert job()["permissions"] == {"contents": "write"}
    assert data["concurrency"] == {"group": "radar-daily", "cancel-in-progress": False}


def test_job_is_off_unless_enabled_and_bounded():
    j = job()
    assert j["if"] == "vars.RADAR_ENABLED == 'true'"
    assert j["timeout-minutes"] == 20
    assert j["runs-on"] == "ubuntu-latest"
    assert j["defaults"]["run"]["working-directory"] == "agent"
    assert "env" not in j  # the runner context is not available at job level


def test_database_path_is_set_before_restore():
    steps_ = steps()
    first = next(i for i, s in enumerate(steps_) if "RADAR_DB_PATH" in s.get("run", ""))
    assert first < step_index("restore")
    assert '"RADAR_DB_PATH=$RUNNER_TEMP/radar.db" >> "$GITHUB_ENV"' in steps_[first]["run"]


def test_runner_and_secrets_expressions_only_in_step_env():
    data = load("daily.yml")
    assert "runner." not in str({k: v for k, v in data.items() if k != "jobs"})
    j = {k: v for k, v in job().items() if k != "steps"}
    assert "runner." not in str(j) and "secrets." not in str(j)
    for s in steps():
        rest = {k: v for k, v in s.items() if k != "env"}
        assert "runner." not in str(rest) and "secrets." not in str(rest), s


def test_trigger_keys_and_checkout_credentials():
    assert set(triggers(load("daily.yml"))) == {"schedule", "workflow_dispatch"}
    checkout = steps()[0]
    assert checkout["uses"].startswith("actions/checkout@")
    # No token is left in .git/config for later steps (uv, the agent) to find.
    assert checkout["with"]["persist-credentials"] is False


def test_missing_key_stops_restore_before_anything_else():
    script = steps()[step_index("restore")]["run"]
    check = script.index("-lt 16")
    assert check < script.index("ls-remote") < script.index("radar state load")
    assert not [x for x in script.splitlines() if "echo" in x and "${#" in x]


def test_one_push_to_the_state_branch_only():
    pushes = [
        line.strip()
        for s in steps()
        for line in s.get("run", "").splitlines()
        if "git push" in line
    ]
    assert len(pushes) == 1 and pushes[0].endswith(':refs/heads/radar-state"')
    assert "--no-filters" in steps()[step_index("push")]["run"]


def test_steps_run_restore_then_daily_then_save():
    restore, run, save = step_index("restore"), step_index("daily"), step_index("save")
    push = step_index("push")
    assert restore < run < save < push == save + 1
    assert "always()" in steps()[save]["if"]
    assert "steps.restore.outcome == 'success'" in steps()[save]["if"]
    assert "always()" in steps()[push]["if"]
    assert "steps.save.outputs.packed == 'true'" in steps()[push]["if"]
    assert 'echo "packed=true" >> "$GITHUB_OUTPUT"' in steps()[save]["run"]
    assert "always()" not in str(steps()[run].get("if", ""))


def test_the_run_step_times_out_before_the_job_so_state_is_still_saved():
    run = steps()[step_index("daily")]
    assert run["timeout-minutes"] == 15
    assert run["timeout-minutes"] < job()["timeout-minutes"]
    assert "timeout-minutes" not in steps()[step_index("save")]


def test_state_key_only_in_the_two_state_steps():
    holders = [s["id"] for s in steps() if "RADAR_STATE_KEY" in s.get("env", {})]
    assert holders == ["restore", "save"]
    text = (WORKFLOWS / "daily.yml").read_text(encoding="utf-8")
    assert text.count("secrets.RADAR_STATE_KEY") == 2
    assert "RADAR_STATE_KEY" not in str(job().get("env", {}))


def test_secrets_reach_steps_only_through_env():
    text = (WORKFLOWS / "daily.yml").read_text(encoding="utf-8")
    for s in steps():
        script = s.get("run", "")
        assert "${{" not in script, s.get("name")
        assert "set -x" not in script and "xtrace" not in script
        assert not re.search(r"\becho\b[^\n]*\$\{?[A-Z_]*(KEY|TOKEN|PASSWORD|SECRET)", script)
        assert not re.search(r"\bprintenv\b|\benv\s*$|\bset\s*$", script, re.M)
    for line in text.splitlines():
        if "secrets." in line:
            assert re.match(r"\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$", line), line
    daily_env = steps()[step_index("daily")]["env"]
    for name in ("ANTHROPIC_API_KEY", "RADAR_INGEST_TOKEN", "TELEGRAM_BOT_TOKEN"):
        assert name in daily_env


def test_only_two_actions_are_used():
    uses = [s["uses"] for s in steps() if "uses" in s]
    assert uses and all(u.startswith(ALLOWED_ACTIONS) for u in uses)


def test_dispatch_input_goes_through_env_and_is_checked():
    run = steps()[step_index("daily")]
    assert "MAX_STORIES" in run["env"]
    assert "inputs.max_stories" in run["env"]["MAX_STORIES"]
    assert "0-9" in run["run"] and "--max-stories" in run["run"]


def test_no_token_in_a_url_or_argument():
    text = (WORKFLOWS / "daily.yml").read_text(encoding="utf-8")
    assert not re.search(r"https?://[^\s\"']*\$\{?[A-Z_]*TOKEN", text)
    assert "GITHUB_TOKEN" not in text
    assert "git config" not in text and "git remote" not in text


def test_the_write_token_reaches_only_the_push_step():
    text = (WORKFLOWS / "daily.yml").read_text(encoding="utf-8")
    assert text.count("github.token") == 1
    holders = [s["id"] for s in steps() if "github.token" in str(s)]
    assert holders == ["push"]
    push = steps()[step_index("push")]
    assert push["env"]["PUSH_TOKEN"] == "${{ github.token }}"
    script = push["run"]
    # Only git runs with the token: not uv, not the agent.
    assert "uv " not in script and "radar" not in script.replace("radar-state", "")
    # Handed to the one push through git's environment, so it is neither written to
    # .git/config nor visible on a command line; it is never printed.
    assert "x-access-token" in script and "base64 -w0" in script
    assert 'GIT_CONFIG_KEY_0="http.$GITHUB_SERVER_URL/.extraheader"' in script
    assert "GIT_CONFIG_VALUE_0=" in script
    assert script.count("PUSH_TOKEN") == 1
    assert not re.search(r"\becho\b.*(PUSH_TOKEN|auth)", script)


SHA_PIN = re.compile(r"^\s*(?:- )?uses: ([\w.-]+/[\w.-]+)@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)$")


def test_every_action_is_pinned_to_a_commit_with_its_version_noted():
    for name in ("daily.yml", "ci.yml"):
        lines = (WORKFLOWS / name).read_text(encoding="utf-8").splitlines()
        uses = [x for x in lines if re.match(r"^\s*(- )?uses:", x)]
        assert uses, name
        for line in uses:
            assert SHA_PIN.match(line), line


def test_uv_itself_is_pinned_and_the_lock_is_enforced():
    setup = next(s for s in steps() if s.get("uses", "").startswith("astral-sh/setup-uv@"))
    assert re.fullmatch(r"\d+\.\d+\.\d+", str(setup["with"]["version"]))
    syncs = [s["run"] for s in steps() if "uv sync" in s.get("run", "")]
    assert syncs == ["uv sync --locked"]


def test_ci_has_a_read_only_token():
    assert load("ci.yml")["permissions"] == {"contents": "read"}
    for j in load("ci.yml")["jobs"].values():
        assert "permissions" not in j


def test_ci_workflow_keeps_its_three_jobs():
    assert list(load("ci.yml")["jobs"]) == ["test", "admin", "site"]
