"""Reads `agent/.env` into the environment when `radar` is started from the shell."""

from collections.abc import MutableMapping
from pathlib import Path

ENV_FILE: Path = Path(__file__).resolve().parents[2] / ".env"


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def load_env_file(path: Path, environ: MutableMapping[str, str]) -> list[str]:
    """Sets each `NAME=value` line of `path` that the environment does not already hold.

    A variable already set to a non-empty value always wins, so a shell export or a
    CI secret is never replaced. Blank lines, `#` comments, lines without `=` and
    empty values are skipped. A leading `export ` and one pair of matching quotes
    around the value are removed. Returns the names that were set.
    """
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return []
    names: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        name, _, value = line.partition("=")
        name = name.strip()
        value = _unquote(value.strip())
        if not name or not value or environ.get(name):
            continue
        environ[name] = value
        names.append(name)
    return names
