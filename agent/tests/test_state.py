import os
import sqlite3
import subprocess
import sys

import pytest

from radar import state
from radar.cli import main
from radar.state import MAGIC, StateError, pack, unpack
from radar.store import SqliteStore

PASSPHRASE = "test-passphrase-0123456789"
OTHER = "other-passphrase-9876543210"


def dump(path) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return list(conn.iterdump())
    finally:
        conn.close()


@pytest.fixture
def filled(store, tmp_path, item, now, cluster_id, run_id, score, draft):
    store.insert_items([item])
    store.save_scores([score], now)
    store.insert_story(
        cluster_id=cluster_id,
        run_id=run_id,
        status="review",
        reasons=["needs a human"],
        score=score,
        draft=draft,
        source_url="https://e.com/a",
        source_count=2,
        created_at=now,
    )
    store.record_usage(
        run_id=run_id,
        step="write",
        model="test-model",
        input_tokens=10,
        output_tokens=5,
        cost_usd=0.01,
        at=now,
    )
    return tmp_path / "radar.db"


def left_nothing(target) -> bool:
    return not target.exists() and (not target.parent.exists() or os.listdir(target.parent) == [])


def packed(filled, tmp_path):
    out = tmp_path / "state.bin"
    pack(str(filled), str(out), PASSPHRASE)
    return out


def test_pack_then_unpack_gives_back_every_table_and_row(filled, tmp_path):
    out = tmp_path / "state.bin"
    written = pack(str(filled), str(out), PASSPHRASE)
    assert written == out.stat().st_size and out.read_bytes().startswith(MAGIC)
    restored = tmp_path / "restored" / "radar.db"
    unpack(str(out), str(restored), PASSPHRASE)
    assert dump(restored) == dump(filled)
    assert any("A2UI 1.0 ships" in line for line in dump(restored))
    assert sorted(os.listdir(tmp_path / "restored")) == ["radar.db"]


def test_the_packed_file_does_not_contain_a_stored_title_in_clear(filled, tmp_path):
    data = packed(filled, tmp_path).read_bytes()
    for text in ("A2UI 1.0 ships", "A2UI 1.0 çıktı".encode(), b"SQLite format", b"A2UI"):
        assert (text if isinstance(text, bytes) else text.encode()) not in data


def test_a_wrong_passphrase_fails_writes_nothing_and_does_not_print_it(
    filled, tmp_path, capsys, monkeypatch
):
    out = packed(filled, tmp_path)
    target = tmp_path / "wrong" / "radar.db"
    with pytest.raises(StateError) as err:
        unpack(str(out), str(target), OTHER)
    assert OTHER not in str(err.value) and PASSPHRASE not in str(err.value)
    assert err.value.__cause__ is None and err.value.__suppress_context__
    assert left_nothing(target)
    monkeypatch.delenv("RADAR_STATE_KEY", raising=False)
    code = main(["state", "load", "--db", str(target), "--file", str(out)])
    # the CLI reads the key from the environment, which is not set here
    assert code == 2
    seen = capsys.readouterr()
    assert OTHER not in seen.out + seen.err and PASSPHRASE not in seen.out + seen.err


def test_a_truncated_file_and_a_file_with_one_flipped_byte_fail(filled, tmp_path):
    good = packed(filled, tmp_path).read_bytes()
    target = tmp_path / "bad" / "radar.db"
    flipped = []
    for position in (len(MAGIC), len(MAGIC) + 15, len(MAGIC) + 20, len(good) // 2, len(good) - 1):
        data = bytearray(good)
        data[position] ^= 0x01
        flipped.append(bytes(data))
    cuts = [
        good[:cut] for cut in (0, 5, len(MAGIC), len(MAGIC) + 8, len(MAGIC) + 16, len(good) - 1)
    ]
    for index, data in enumerate(flipped + cuts):
        broken = tmp_path / f"broken{index}.bin"
        broken.write_bytes(data)
        with pytest.raises(StateError):
            unpack(str(broken), str(target), PASSPHRASE)
        assert left_nothing(target)


def test_a_file_without_the_magic_fails(filled, tmp_path):
    other = tmp_path / "other.bin"
    other.write_bytes(b"NOTSTATE\n" + b"x" * 200)
    target = tmp_path / "radar-new.db"
    with pytest.raises(StateError, match="not a Radar state file"):
        unpack(str(other), str(target), PASSPHRASE)
    assert not target.exists()


def test_unpack_refuses_to_replace_an_existing_database_without_force(filled, store, tmp_path):
    out = packed(filled, tmp_path)
    store.close()
    before = filled.read_bytes()
    with pytest.raises(StateError, match="already exists"):
        unpack(str(out), str(filled), PASSPHRASE)
    assert filled.read_bytes() == before
    expected = dump(filled)
    unpack(str(out), str(filled), PASSPHRASE, force=True)
    assert dump(filled) == expected
    assert sorted(p for p in os.listdir(tmp_path) if p.startswith("radar")) == ["radar.db"]


def test_a_failed_unpack_leaves_an_existing_database_untouched(filled, tmp_path):
    good = packed(filled, tmp_path).read_bytes()
    before = filled.read_bytes()
    names = sorted(os.listdir(tmp_path))
    flipped = bytearray(good)
    flipped[-3] ^= 0xFF
    bad = tmp_path / "flipped.bin"
    bad.write_bytes(bytes(flipped))
    with pytest.raises(StateError):
        unpack(str(bad), str(filled), PASSPHRASE, force=True)
    with pytest.raises(StateError):
        unpack(str(bad), str(filled), OTHER, force=True)
    assert filled.read_bytes() == before
    assert sorted(os.listdir(tmp_path)) == sorted(names + ["flipped.bin"])


def test_a_decrypted_file_that_is_not_a_database_fails(tmp_path):
    import base64
    import gzip
    import hashlib

    from cryptography.fernet import Fernet

    salt = b"s" * 16
    key = base64.urlsafe_b64encode(
        hashlib.scrypt(PASSPHRASE.encode(), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=2**26)
    )
    token = Fernet(key).encrypt(gzip.compress(b"this is not an sqlite database" * 50))
    bad = tmp_path / "notdb.bin"
    bad.write_bytes(MAGIC + salt + token)
    target = tmp_path / "radar.db"
    with pytest.raises(StateError):
        unpack(str(bad), str(target), PASSPHRASE)
    assert sorted(os.listdir(tmp_path)) == ["notdb.bin"]


def test_pack_while_the_store_is_open_gives_a_consistent_copy(filled, store, tmp_path, now, run_id):
    out = tmp_path / "state.bin"
    pack(str(filled), str(out), PASSPHRASE)  # the fixture's store is still open
    store.record_usage(
        run_id=run_id,
        step="score",
        model="test-model",
        input_tokens=1,
        output_tokens=1,
        cost_usd=0.001,
        at=now,
    )
    restored = tmp_path / "restored.db"
    unpack(str(out), str(restored), PASSPHRASE)
    conn = sqlite3.connect(str(restored))
    try:
        assert conn.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert conn.execute("SELECT COUNT(*) FROM llm_usage").fetchone() == (1,)
    finally:
        conn.close()
    reopened = SqliteStore(str(restored))
    try:
        assert len(reopened.unpushed_stories()) == 1
    finally:
        reopened.close()


def test_pack_of_a_missing_database_fails_and_writes_nothing(tmp_path):
    out = tmp_path / "state.bin"
    with pytest.raises(StateError):
        pack(str(tmp_path / "none.db"), str(out), PASSPHRASE)
    assert os.listdir(tmp_path) == []


@pytest.mark.parametrize("bad", ["", "short", "x" * 15])
def test_a_short_or_empty_passphrase_is_refused(filled, tmp_path, bad):
    out = tmp_path / "state.bin"
    with pytest.raises(StateError) as err:
        pack(str(filled), str(out), bad)
    assert bad == "" or bad not in str(err.value)
    assert not out.exists()
    good = packed(filled, tmp_path)
    target = tmp_path / "radar-new.db"
    with pytest.raises(StateError):
        unpack(str(good), str(target), bad)
    assert not target.exists()
    assert state.MIN_PASSPHRASE == 16


def test_cli_state_save_and_load_and_exit_codes(filled, tmp_path, monkeypatch, capsys):
    out = tmp_path / "cli-state.bin"
    monkeypatch.delenv("RADAR_STATE_KEY", raising=False)
    assert main(["state", "save", "--db", str(filled), "--file", str(out)]) == 2
    assert not out.exists()
    monkeypatch.setenv("RADAR_STATE_KEY", "too-short")
    assert main(["state", "save", "--db", str(filled), "--file", str(out)]) == 2
    assert not out.exists()
    monkeypatch.setenv("RADAR_STATE_KEY", PASSPHRASE)
    assert main(["state", "save", "--db", str(filled), "--file", str(out)]) == 0
    assert out.read_bytes().startswith(MAGIC)

    target = tmp_path / "new" / "radar.db"
    assert main(["state", "load", "--db", str(target), "--file", str(out)]) == 0
    assert dump(target) == dump(filled)
    # an existing database is refused without --force, with one line on stderr
    capsys.readouterr()
    assert main(["state", "load", "--db", str(target), "--file", str(out)]) == 1
    assert len(capsys.readouterr().err.strip().splitlines()) == 1
    assert main(["state", "load", "--db", str(target), "--file", str(out), "--force"]) == 0

    monkeypatch.setenv("RADAR_STATE_KEY", OTHER)
    capsys.readouterr()
    assert main(["state", "load", "--db", str(target), "--file", str(out), "--force"]) == 1
    seen = capsys.readouterr()
    assert len(seen.err.strip().splitlines()) == 1 and seen.out == ""
    assert seen.err.startswith("state: ")
    assert OTHER not in seen.out + seen.err and PASSPHRASE not in seen.out + seen.err
    assert dump(target) == dump(filled)


def test_state_module_does_not_import_anthropic():
    code = (
        "import sys, radar.state, radar.cli;"
        "sys.exit(1 if any(m.startswith('anthropic') for m in sys.modules) else 0)"
    )
    assert subprocess.run([sys.executable, "-c", code]).returncode == 0


def make_wal_db(path, rows, keep_open=False):
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")
    conn.execute("CREATE TABLE t (x TEXT)")
    conn.executemany("INSERT INTO t VALUES (?)", [(r,) for r in rows])
    conn.commit()
    if keep_open:
        return conn
    conn.close()
    return None


def rows_of(path) -> list[str]:
    conn = sqlite3.connect(str(path))
    try:
        return [r[0] for r in conn.execute("SELECT x FROM t ORDER BY x")]
    finally:
        conn.close()


def test_load_with_force_removes_a_stale_wal_and_shm(tmp_path):
    import shutil

    make_wal_db(tmp_path / "new.db", ["new1", "new2"])
    out = tmp_path / "state.bin"
    pack(str(tmp_path / "new.db"), str(out), PASSPHRASE)
    live = make_wal_db(tmp_path / "old.db", ["old1", "old2"], keep_open=True)
    target = tmp_path / "radar.db"
    for suffix in ("", "-wal", "-shm"):
        shutil.copy(str(tmp_path / "old.db") + suffix, str(target) + suffix)
    live.close()
    assert os.path.getsize(str(target) + "-wal") > 0
    unpack(str(out), str(target), PASSPHRASE, force=True)
    assert rows_of(target) == ["new1", "new2"]
    assert not [n for n in os.listdir(tmp_path) if n.startswith("radar.db-")]


def test_load_with_force_removes_a_stale_journal_and_orphan_side_files(tmp_path):
    make_wal_db(tmp_path / "new.db", ["new1"])
    out = tmp_path / "state.bin"
    pack(str(tmp_path / "new.db"), str(out), PASSPHRASE)
    make_wal_db(tmp_path / "radar.db", ["old1"])
    (tmp_path / "radar.db-journal").write_bytes(b"stale journal bytes")
    unpack(str(out), str(tmp_path / "radar.db"), PASSPHRASE, force=True)
    assert rows_of(tmp_path / "radar.db") == ["new1"]
    assert not (tmp_path / "radar.db-journal").exists()
    # side files with no database beside them go too
    orphan = tmp_path / "fresh" / "radar.db"
    orphan.parent.mkdir()
    (tmp_path / "fresh" / "radar.db-wal").write_bytes(b"junk")
    unpack(str(out), str(orphan), PASSPHRASE)
    assert os.listdir(orphan.parent) == ["radar.db"]


def test_pack_never_leaves_a_plain_database_in_the_output_directory(filled, tmp_path, monkeypatch):
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    seen: list[bytes] = []
    real = state.Fernet.encrypt

    def spy(self, data):
        for name in os.listdir(out_dir):
            with open(out_dir / name, "rb") as handle:
                seen.append(handle.read(16))
        return real(self, data)

    monkeypatch.setattr(state.Fernet, "encrypt", spy)
    pack(str(filled), str(out_dir / "state.bin"), PASSPHRASE)
    assert not any(head.startswith(b"SQLite format 3") for head in seen)
    assert os.listdir(out_dir) == ["state.bin"]


def test_pack_includes_uncheckpointed_wal_rows_and_does_not_touch_the_source(tmp_path):
    live = make_wal_db(tmp_path / "live.db", ["a", "b", "c"], keep_open=True)
    before_wal = (tmp_path / "live.db-wal").read_bytes()
    out = tmp_path / "state.bin"
    pack(str(tmp_path / "live.db"), str(out), PASSPHRASE)
    assert (tmp_path / "live.db-wal").read_bytes() == before_wal
    restored = tmp_path / "restored.db"
    unpack(str(out), str(restored), PASSPHRASE)
    live.close()
    assert rows_of(restored) == ["a", "b", "c"]
