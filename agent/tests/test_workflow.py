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
    assert data["permissions"] == {"contents": "write"}
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
    assert checkout["with"]["persist-credentials"] is True


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
    assert "--no-filters" in steps()[step_index("save")]["run"]


def test_steps_run_restore_then_daily_then_save():
    restore, run, save = step_index("restore"), step_index("daily"), step_index("save")
    assert restore < run < save
    assert "always()" in steps()[save]["if"]
    assert "steps.restore.outcome == 'success'" in steps()[save]["if"]
    assert "always()" not in str(steps()[run].get("if", ""))


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
    assert not re.search(r"https?://[^\s\"']*\$\{?GITHUB_TOKEN", text)
    assert "x-access-token" not in text
    assert "GITHUB_TOKEN" not in text


def test_ci_workflow_keeps_its_three_jobs():
    assert list(load("ci.yml")["jobs"]) == ["test", "admin", "site"]
