from datetime import UTC, datetime, timedelta

import pytest

from radar.budget import (
    BudgetExceeded,
    Meter,
    cap_from_env,
    cost_usd,
    day_start,
    worst_case_usd,
)

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


def test_cost():
    assert cost_usd("claude-sonnet-5-5", 1_000_000, 0) == 2.00
    assert cost_usd("claude-haiku-5-5", 10_000, 2_000) == pytest.approx(0.002)
    assert cost_usd("some-new-model", 1_000_000, 1_000_000) == 12.00


def test_worst_case_estimates_input_tokens_from_bytes():
    # 4_000 bytes -> ceil(4_000 / 2) + 1_000 = 3_000 input tokens * $2 / M = 0.006
    # plus 2_000 output tokens * $10 / M = 0.02 -> 0.026
    assert worst_case_usd("claude-sonnet-5-5", 4_000, 2_000) == pytest.approx(0.026)
    # odd byte counts round up: ceil(3 / 2) + 1_000 = 1_002 tokens * $2 / M
    assert worst_case_usd("claude-sonnet-5-5", 3, 0) == pytest.approx(1_002 * 2.00 / 1_000_000)
    # no input at all still reserves the 1_000-token margin
    assert worst_case_usd("claude-haiku-5-5", 0, 0) == pytest.approx(1_000 * 0.10 / 1_000_000)


def test_day_start_is_istanbul_midnight():
    assert day_start(datetime(2026, 11, 19, 22, 30, tzinfo=UTC)) == datetime(
        2026, 11, 19, 21, 0, tzinfo=UTC
    )
    assert day_start(datetime(2026, 11, 19, 20, 59, tzinfo=UTC)) == datetime(
        2026, 11, 18, 21, 0, tzinfo=UTC
    )


def test_reserve_blocks_the_call_that_would_cross_the_cap(store):
    meter = Meter(store, None, cap_usd=0.25, clock=lambda: NOW)
    meter.record("write", "claude-sonnet-5-5", 50_000, 14_000)  # 0.24
    with pytest.raises(BudgetExceeded):
        meter.reserve("claude-sonnet-5-5", input_bytes=4_000, max_tokens=2_000)  # 0.026
    # haiku: 3_000 in * $0.10 / M + 2_000 out * $0.50 / M = 0.0003 + 0.001 = 0.0013 fits
    meter.reserve("claude-haiku-5-5", input_bytes=4_000, max_tokens=2_000)


def test_reserve_allows_exactly_the_cap(store):
    meter = Meter(store, None, cap_usd=0.25, clock=lambda: NOW)
    meter.record("write", "claude-sonnet-5-5", 0, 19_800)  # 19_800 * $10 / M = 0.198
    # (0 / 2 + 1_000) in * $2 / M + 5_000 out * $10 / M = 0.002 + 0.05 = 0.052 -> 0.25
    meter.reserve("claude-sonnet-5-5", input_bytes=0, max_tokens=5_000)


def test_reserve_counts_every_attempt(store):
    meter = Meter(store, None, cap_usd=0.05, clock=lambda: NOW)
    meter.reserve("claude-sonnet-5-5", input_bytes=4_000, max_tokens=2_000)  # 0.026 fits
    with pytest.raises(BudgetExceeded, match="2 attempts"):
        # two attempts: 2 * 0.026 = 0.052 > 0.05
        meter.reserve("claude-sonnet-5-5", input_bytes=4_000, max_tokens=2_000, attempts=2)


def test_record_returns_cost_counts_calls_and_stores_usage(store):
    meter = Meter(store, None, cap_usd=0.25, clock=lambda: NOW)
    cost = meter.record("score", "claude-haiku-5-5", 10_000, 2_000)
    assert cost == pytest.approx(0.002)
    assert meter.calls == 1
    assert meter.spent_today() == pytest.approx(0.002)
    assert meter.tokens_today() == 12_000
    rows = store.usage_since(day_start(NOW))
    assert [(r["step"], r["model"], r["input_tokens"], r["output_tokens"]) for r in rows] == [
        ("score", "claude-haiku-5-5", 10_000, 2_000)
    ]


def test_spend_from_another_meter_counts_but_not_its_calls(store):
    Meter(store, None, cap_usd=0.25, clock=lambda: NOW).record(
        "write", "claude-sonnet-5-5", 50_000, 14_000
    )
    second = Meter(store, None, cap_usd=0.25, clock=lambda: NOW)
    assert second.calls == 0
    assert second.spent_today() == pytest.approx(0.24)
    with pytest.raises(BudgetExceeded):
        second.reserve("claude-sonnet-5-5", input_bytes=4_000, max_tokens=2_000)  # 0.026


def test_yesterdays_spend_does_not_count(store):
    before = day_start(NOW) - timedelta(minutes=1)
    store.record_usage(
        run_id=None,
        step="write",
        model="claude-sonnet-5-5",
        input_tokens=1_000_000,
        output_tokens=0,
        cost_usd=2.0,
        at=before,
    )
    meter = Meter(store, None, cap_usd=0.25, clock=lambda: NOW)
    assert meter.spent_today() == 0
    assert meter.tokens_today() == 0


def test_cap_from_env(monkeypatch):
    monkeypatch.delenv("RADAR_DAILY_CAP_USD", raising=False)
    assert cap_from_env() == 0.25
    monkeypatch.setenv("RADAR_DAILY_CAP_USD", "0.10")
    assert cap_from_env() == 0.10
    for bad in ("abc", "-1", "0", "nan", "inf"):
        monkeypatch.setenv("RADAR_DAILY_CAP_USD", bad)
        with pytest.raises(ValueError):
            cap_from_env()
