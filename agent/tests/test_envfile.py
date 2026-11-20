from radar.envfile import load_env_file


def test_missing_file_changes_nothing(tmp_path):
    env = {"A": "1"}
    assert load_env_file(tmp_path / "nope.env", env) == []
    assert env == {"A": "1"}


def test_reads_pairs_and_skips_comments_blanks_and_empty_values(tmp_path):
    path = tmp_path / ".env"
    path.write_text(
        "# a comment\n"
        "\n"
        "ANTHROPIC_API_KEY=sk-test\n"
        "RADAR_DB_PATH=\n"
        "export RADAR_ADMIN_URL=http://127.0.0.1:8787\n"
        'QUOTED="has = sign"\n'
        "SINGLE='x y'\n"
        "   # indented comment\n"
        "no equals sign here\n",
        encoding="utf-8",
    )
    env: dict[str, str] = {}
    names = load_env_file(path, env)
    assert env == {
        "ANTHROPIC_API_KEY": "sk-test",
        "RADAR_ADMIN_URL": "http://127.0.0.1:8787",
        "QUOTED": "has = sign",
        "SINGLE": "x y",
    }
    assert names == ["ANTHROPIC_API_KEY", "RADAR_ADMIN_URL", "QUOTED", "SINGLE"]


def test_process_environment_wins(tmp_path):
    path = tmp_path / ".env"
    path.write_text("ANTHROPIC_API_KEY=from-file\nOTHER=file\n", encoding="utf-8")
    env = {"ANTHROPIC_API_KEY": "from-shell"}
    assert load_env_file(path, env) == ["OTHER"]
    assert env == {"ANTHROPIC_API_KEY": "from-shell", "OTHER": "file"}


def test_empty_process_value_is_filled_from_file(tmp_path):
    path = tmp_path / ".env"
    path.write_text("ANTHROPIC_API_KEY=from-file\n", encoding="utf-8")
    env = {"ANTHROPIC_API_KEY": ""}
    load_env_file(path, env)
    assert env == {"ANTHROPIC_API_KEY": "from-file"}


def test_utf8_bom_is_ignored(tmp_path):
    path = tmp_path / ".env"
    path.write_bytes("﻿KEY=v\n".encode())
    env: dict[str, str] = {}
    load_env_file(path, env)
    assert env == {"KEY": "v"}
