from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parents[3]


def resolve(path: str) -> Path:
    """Absolute paths and relative paths that exist from the cwd are used as is;
    other relative paths are resolved against the repository root."""
    p = Path(path)
    if p.is_absolute() or p.exists():
        return p
    return REPO_ROOT / p
