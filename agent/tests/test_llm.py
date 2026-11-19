from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from radar.budget import BudgetExceeded, Meter
from radar.llm import AnthropicLLM, LLMError, Refused

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


class Out(BaseModel):
    label: str


OK = Out(label="ok")


def reply(
    parsed=OK,
    stop_reason="end_turn",
    model="claude-haiku-5-5",
    input_tokens=1_000,
    output_tokens=200,
    stop_details=None,
):
    return SimpleNamespace(
        parsed_output=parsed,
        stop_reason=stop_reason,
        model=model,
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
        stop_details=stop_details,
    )


def make(store, response, cap=0.25):
    sent: list[dict] = []

    def send(**kwargs):
        sent.append(kwargs)
        return response

    meter = Meter(store, None, cap_usd=cap, clock=lambda: NOW)
    return AnthropicLLM(meter, send=send), sent


def call(llm, **over):
    args = dict(
        step="score",
        model="claude-haiku-5-5",
        system="sys",
        user="usr",
        schema=Out,
        max_tokens=500,
        effort="low",
    )
    args.update(over)
    return llm.parse(**args)


def usage(store):
    return store.usage_since(datetime(2026, 11, 18, tzinfo=UTC))


def test_parse_returns_object_and_records_usage(store):
    llm, sent = make(store, reply())
    assert call(llm) == Out(label="ok")
    rows = usage(store)
    assert len(rows) == 1
    assert rows[0]["step"] == "score"
    assert rows[0]["model"] == "claude-haiku-5-5"
    assert rows[0]["input_tokens"] == 1_000
    assert rows[0]["output_tokens"] == 200
    assert rows[0]["cost_usd"] > 0
    assert len(sent) == 1


def test_budget_exceeded_sends_nothing(store):
    llm, sent = make(store, reply(), cap=0.000001)
    with pytest.raises(BudgetExceeded):
        call(llm)
    assert sent == []
    assert usage(store) == []


def test_refusal_raises_refused_and_still_records(store):
    details = SimpleNamespace(category="cyber")
    llm, _ = make(store, reply(parsed=None, stop_reason="refusal", stop_details=details))
    with pytest.raises(Refused, match="cyber"):
        call(llm)
    assert len(usage(store)) == 1


def test_truncated_reply_raises_llm_error(store):
    llm, _ = make(store, reply(stop_reason="max_tokens"))
    with pytest.raises(LLMError, match="max_tokens"):
        call(llm)
    assert len(usage(store)) == 1


def test_missing_parsed_object_raises_llm_error(store):
    llm, _ = make(store, reply(parsed=None))
    with pytest.raises(LLMError):
        call(llm)
    assert len(usage(store)) == 1


def test_wrong_parsed_type_raises_llm_error(store):
    llm, _ = make(store, reply(parsed="nope"))
    with pytest.raises(LLMError):
        call(llm)


def test_fallback_model_is_priced_by_the_response_model(store):
    llm, _ = make(store, reply(model="claude-sonnet-5"))
    call(llm, model="claude-sonnet-5-5", fallback=True)
    assert usage(store)[0]["model"] == "claude-sonnet-5"


def test_send_failure_becomes_llm_error(store):
    def send(**kwargs):
        raise LLMError("boom")

    llm = AnthropicLLM(Meter(store, None, 0.25, lambda: NOW), send=send)
    with pytest.raises(LLMError):
        call(llm)


def test_request_shape(store):
    llm, sent = make(store, reply())
    call(llm, system="S", user="U")
    plain = sent[0]
    assert plain["model"] == "claude-haiku-5-5"
    assert plain["max_tokens"] == 500
    assert plain["system"] == "S"
    assert plain["messages"] == [{"role": "user", "content": "U"}]
    assert plain["output_format"] is Out
    assert plain["output_config"] == {"effort": "low"}
    assert "thinking" not in plain and "betas" not in plain and "fallbacks" not in plain

    call(llm, thinking_off=True, fallback=True, effort="high")
    full = sent[1]
    assert full["thinking"] == {"type": "disabled"}
    assert full["betas"] == ["server-side-fallback-2026-07-01"]
    assert full["fallbacks"] == "default"
    assert full["output_config"] == {"effort": "high"}


def test_importing_llm_does_not_import_anthropic():
    import subprocess
    import sys

    code = "import sys, radar.llm; sys.exit(any(m.startswith('anthropic') for m in sys.modules))"
    assert subprocess.run([sys.executable, "-c", code]).returncode == 0


def test_fake_llm_pops_replies_raises_errors_and_records_calls():
    from fakes import FakeLLM

    fake = FakeLLM({"score": [Out(label="a"), LLMError("x")]})
    assert fake.parse(step="score", user="1") == Out(label="a")
    with pytest.raises(LLMError):
        fake.parse(step="score", user="2")
    with pytest.raises(AssertionError, match="score"):
        fake.parse(step="score", user="3")
    with pytest.raises(AssertionError, match="write"):
        fake.parse(step="write")
    assert [c["user"] for c in fake.calls[:3]] == ["1", "2", "3"]
