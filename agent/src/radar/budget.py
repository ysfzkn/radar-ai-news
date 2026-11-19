import math
import os
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, timezone

from radar.store import SqliteStore

DAILY_CAP_USD = 0.25
DAILY_TOKEN_TARGET = 30_000
# USD per million tokens, as (input, output).
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-sonnet-5": (2.00, 10.00),
}
ISTANBUL = timezone(timedelta(hours=3))


class BudgetExceeded(Exception):
    pass


def _rates(model: str) -> tuple[float, float]:
    if model in PRICES:
        return PRICES[model]
    return (
        max(p[0] for p in PRICES.values()),
        max(p[1] for p in PRICES.values()),
    )


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    rate_in, rate_out = _rates(model)
    return (input_tokens * rate_in + output_tokens * rate_out) / 1_000_000


def worst_case_usd(model: str, input_chars: int, max_tokens: int) -> float:
    return cost_usd(model, math.ceil(input_chars / 2), max_tokens)


def day_start(now: datetime) -> datetime:
    local = now.astimezone(ISTANBUL)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC)


def cap_from_env() -> float:
    raw = os.environ.get("RADAR_DAILY_CAP_USD")
    if raw is None or not raw.strip():
        return DAILY_CAP_USD
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"RADAR_DAILY_CAP_USD must be a positive number, got {raw!r}") from None
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"RADAR_DAILY_CAP_USD must be a positive number, got {raw!r}")
    return value


class Meter:
    def __init__(
        self,
        store: SqliteStore,
        run_id: int | None,
        cap_usd: float,
        clock: Callable[[], datetime],
    ) -> None:
        self._store = store
        self._run_id = run_id
        self._cap_usd = cap_usd
        self._clock = clock
        self.calls = 0

    def _usage_today(self) -> list[dict]:
        return self._store.usage_since(day_start(self._clock()))

    def spent_today(self) -> float:
        return sum(row["cost_usd"] for row in self._usage_today())

    def tokens_today(self) -> int:
        return sum(row["input_tokens"] + row["output_tokens"] for row in self._usage_today())

    def reserve(self, model: str, input_chars: int, max_tokens: int) -> None:
        worst = worst_case_usd(model, input_chars, max_tokens)
        spent = self.spent_today()
        if spent + worst > self._cap_usd:
            raise BudgetExceeded(
                f"daily cap ${self._cap_usd:.4f} would be exceeded: "
                f"spent ${spent:.4f} + worst case ${worst:.4f} for {model}"
            )

    def record(self, step: str, model: str, input_tokens: int, output_tokens: int) -> float:
        cost = cost_usd(model, input_tokens, output_tokens)
        self._store.record_usage(
            run_id=self._run_id,
            step=step,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
            at=self._clock(),
        )
        self.calls += 1
        return cost
