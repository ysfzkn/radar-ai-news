from pathlib import Path

from radar.paths import REPO_ROOT, resolve


def test_resolve_falls_back_to_repo_root(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert resolve("db/migrations") == REPO_ROOT / "db" / "migrations"
    assert (REPO_ROOT / "db" / "migrations").is_dir()


def test_resolve_prefers_existing_relative_and_absolute(tmp_path, monkeypatch):
    (tmp_path / "x").mkdir()
    monkeypatch.chdir(tmp_path)
    assert resolve("x") == Path("x")
    assert resolve(str(tmp_path)) == tmp_path
