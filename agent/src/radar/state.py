"""The agent database as one encrypted file.

File format: MAGIC, 16 random salt bytes, then the Fernet token of the gzipped
database. The key is scrypt(passphrase, salt) as urlsafe base64.
"""

import base64
import contextlib
import gzip
import hashlib
import os
import secrets
import sqlite3
import tempfile
import zlib
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

MAGIC = b"RADARSTATE1\n"
SALT_BYTES = 16
MIN_PASSPHRASE = 16


class StateError(Exception):
    """A failure to pack or unpack. The message never contains the passphrase."""


def _check_passphrase(passphrase: str) -> None:
    if len(passphrase) < MIN_PASSPHRASE:
        raise StateError(f"the passphrase must be at least {MIN_PASSPHRASE} characters")


def _key(passphrase: str, salt: bytes) -> bytes:
    raw = hashlib.scrypt(passphrase.encode(), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=2**26)
    return base64.urlsafe_b64encode(raw)


def _temp_file(directory: Path) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=directory, prefix=".radar-state-")
    os.close(fd)
    return name


def _remove(name: str | None) -> None:
    if name:
        with contextlib.suppress(OSError):
            os.unlink(name)


def _copy_database(db_path: str) -> bytes:
    """A consistent copy of the database as bytes; nothing plain is written to disk.

    The source is opened read-only, so packing never modifies or checkpoints it.
    """
    source = sqlite3.connect(f"{Path(db_path).resolve().as_uri()}?mode=ro", uri=True)
    try:
        memory = sqlite3.connect(":memory:")
        try:
            source.backup(memory)
            return memory.serialize()
        finally:
            memory.close()
    finally:
        source.close()


def pack(db_path: str, out_path: str, passphrase: str) -> int:
    """Write the encrypted copy of the database to `out_path`; returns the bytes written."""
    _check_passphrase(passphrase)
    if not os.path.isfile(db_path):
        raise StateError(f"no database at {db_path}")
    out = Path(out_path)
    out_name = None
    try:
        try:
            raw = _copy_database(db_path)
        except sqlite3.Error:
            raise StateError("cannot read the database") from None
        salt = secrets.token_bytes(SALT_BYTES)
        token = Fernet(_key(passphrase, salt)).encrypt(gzip.compress(raw))
        data = MAGIC + salt + token
        out_name = _temp_file(out.parent)
        with open(out_name, "wb") as handle:
            handle.write(data)
        os.replace(out_name, out)
        out_name = None
        return len(data)
    finally:
        _remove(out_name)


def _integrity_ok(path: str) -> bool:
    try:
        conn = sqlite3.connect(path)
        try:
            return conn.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        return False


def unpack(in_path: str, db_path: str, passphrase: str, force: bool = False) -> None:
    """Decrypt `in_path` into `db_path`; an existing file is replaced only with `force`."""
    _check_passphrase(passphrase)
    target = Path(db_path)
    if target.exists() and not force:
        raise StateError(f"{db_path} already exists (use --force to replace it)")
    try:
        with open(in_path, "rb") as handle:
            data = handle.read()
    except OSError:
        raise StateError(f"cannot read {in_path}") from None
    if not data.startswith(MAGIC):
        raise StateError(f"{in_path} is not a Radar state file")
    salt = data[len(MAGIC) : len(MAGIC) + SALT_BYTES]
    token = data[len(MAGIC) + SALT_BYTES :]
    if len(salt) < SALT_BYTES or not token:
        raise StateError(f"{in_path} is truncated")
    try:
        packed = Fernet(_key(passphrase, salt)).decrypt(token)
    except InvalidToken:
        raise StateError("cannot decrypt (wrong key or damaged file)") from None
    try:
        raw = gzip.decompress(packed)
    except (OSError, EOFError, zlib.error):
        raise StateError("the decrypted data is damaged") from None
    temp_name = None
    try:
        temp_name = _temp_file(target.parent)
        with open(temp_name, "wb") as handle:
            handle.write(raw)
        if not _integrity_ok(temp_name):
            raise StateError("the decrypted data is not a sound database")
        # Side files of an older database would be replayed over the restored one.
        for suffix in ("-wal", "-shm", "-journal"):
            side = Path(f"{target}{suffix}")
            try:
                side.unlink(missing_ok=True)
            except OSError:
                raise StateError(f"cannot remove {side}") from None
        os.replace(temp_name, target)
        temp_name = None
    finally:
        _remove(temp_name)
