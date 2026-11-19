from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from radar.budget import BudgetExceeded, Meter
from radar.llm import AnthropicLLM, LLMError, Refused

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


class Out(BaseModel):
    label: str


def reply(
    text='{"label": "ok"}',
    stop_reason="end_turn",
    model="claude-haiku-5-5",
    input_tokens=1_000,
    output_tokens=200,
    stop_details=None,
):
    return SimpleNamespace(
        content=[
            SimpleNamespace(type="thinking", thinking="hmm"),
            SimpleNamespace(type="text", text=text),
        ],
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
    llm, _ = make(store, reply(text="", stop_reason="refusal", stop_details=details))
    with pytest.raises(Refused, match="cyber"):
        call(llm)
    assert len(usage(store)) == 1


def test_truncated_reply_raises_llm_error(store):
    llm, _ = make(store, reply(stop_reason="max_tokens"))
    with pytest.raises(LLMError, match="max_tokens"):
        call(llm)
    assert len(usage(store)) == 1


def test_unparseable_reply_raises_llm_error_and_records(store):
    llm, _ = make(store, reply(text='{"label": "cut'))
    with pytest.raises(LLMError):
        call(llm)
    assert len(usage(store)) == 1


def test_wrong_shape_raises_llm_error(store):
    llm, _ = make(store, reply(text='{"other": 1}'))
    with pytest.raises(LLMError):
        call(llm)


def test_fallback_model_is_priced_by_the_response_model(store):
    llm, _ = make(store, reply(model="claude-sonnet-5"))
    call(llm, model="claude-sonnet-5-5", fallback=True)
    assert usage(store)[0]["model"] == "claude-sonnet-5"


def test_fallback_reserves_two_attempts(store):
    # "sys" + "usr" = 6 bytes; one attempt:
    # (ceil(6 / 2) + 1_000) * $2 / M + 500 * $10 / M = 0.002006 + 0.005 = 0.007006
    # with a fallback: 2 * 0.007006 = 0.014012 > 0.012 >= 0.007006
    llm, sent = make(store, reply(model="claude-sonnet-5-5"), cap=0.012)
    with pytest.raises(BudgetExceeded):
        call(llm, model="claude-sonnet-5-5", fallback=True)
    assert sent == []
    call(llm, model="claude-sonnet-5-5")
    assert len(sent) == 1


def test_reserve_counts_utf8_bytes_not_characters(store):
    seen: list[tuple] = []

    class Spy(Meter):
        def reserve(self, model, input_bytes, max_tokens, attempts=1):
            seen.append((model, input_bytes, max_tokens, attempts))

    llm = AnthropicLLM(Spy(store, None, 0.25, clock=lambda: NOW), send=lambda **kw: reply())
    call(llm, system="şş", user="İstanbul")  # 2 * 2 bytes + (2 + 7) bytes
    call(llm, model="claude-sonnet-5-5", system="a", user="b", fallback=True)
    assert seen == [
        ("claude-haiku-5-5", 13, 500, 1),
        ("claude-sonnet-5-5", 2, 500, 2),
    ]


def test_fallback_model_shares_the_write_model_price():
    from radar.budget import PRICES
    from radar.llm import FALLBACK_MODEL
    from radar.write import WRITE_MODEL

    assert FALLBACK_MODEL == "claude-sonnet-5"
    assert PRICES[FALLBACK_MODEL] == PRICES[WRITE_MODEL]


def iteration(kind, input_tokens, output_tokens, model=None):
    entry = SimpleNamespace(type=kind, input_tokens=input_tokens, output_tokens=output_tokens)
    if model is not None or kind == "message":
        entry.model = model
    return entry


def test_iterations_are_recorded_one_row_each(store):
    response = reply(model="claude-sonnet-5", input_tokens=900, output_tokens=150)
    response.usage.iterations = [
        iteration("message", 800, 40, model="claude-sonnet-5-5"),
        iteration("fallback_message", 900, 150, model="claude-sonnet-5"),
    ]
    llm, _ = make(store, response)
    call(llm, model="claude-sonnet-5-5", step="write", fallback=True)
    rows = [(r["step"], r["model"], r["input_tokens"], r["output_tokens"]) for r in usage(store)]
    assert rows == [
        ("write", "claude-sonnet-5-5", 800, 40),
        ("write", "claude-sonnet-5", 900, 150),
    ]


def test_iteration_without_a_model_is_priced_as_the_requested_model(store):
    response = reply(model="claude-sonnet-5-5")
    response.usage.iterations = [iteration("message", 700, 30)]
    llm, _ = make(store, response)
    call(llm, model="claude-sonnet-5-5")
    assert [(r["model"], r["input_tokens"]) for r in usage(store)] == [("claude-sonnet-5-5", 700)]


def test_empty_iterations_fall_back_to_top_level_usage(store):
    response = reply(model="claude-sonnet-5")
    response.usage.iterations = []
    llm, _ = make(store, response)
    call(llm, model="claude-sonnet-5-5", fallback=True)
    assert [(r["model"], r["input_tokens"]) for r in usage(store)] == [("claude-sonnet-5", 1_000)]


def test_refusal_after_iterations_still_records_every_hop(store):
    response = reply(text="", stop_reason="refusal", model="claude-sonnet-5")
    response.usage.iterations = [
        iteration("message", 800, 40, model="claude-sonnet-5-5"),
        iteration("message", 810, 20, model="claude-sonnet-5"),
    ]
    llm, _ = make(store, response)
    with pytest.raises(Refused):
        call(llm, model="claude-sonnet-5-5", fallback=True)
    assert len(usage(store)) == 2


def _stub_anthropic(monkeypatch, exc, seen, built=None):
    import anthropic

    class Messages:
        def create(self, **kwargs):
            seen.append(kwargs)
            raise exc

    class Stub:
        def __init__(self, **kwargs):
            if built is not None:
                built.append(kwargs)
            self.messages = Messages()
            self.beta = SimpleNamespace(messages=Messages())

    monkeypatch.setattr(anthropic, "Anthropic", Stub)
    monkeypatch.setattr("radar.llm._client", None)


@pytest.mark.parametrize("kind", ["connection", "status", "base"])
def test_default_send_translates_sdk_errors(monkeypatch, kind):
    import anthropic
    import httpx

    from radar.llm import _default_send

    req = httpx.Request("POST", "https://example.invalid")
    exc = {
        "connection": anthropic.APIConnectionError(request=req),
        "status": anthropic.APIStatusError(
            "bad", response=httpx.Response(500, request=req), body=None
        ),
        "base": anthropic.AnthropicError("no key"),
    }[kind]
    seen: list[dict] = []
    _stub_anthropic(monkeypatch, exc, seen)
    with pytest.raises(LLMError):
        _default_send(
            model="m",
            max_tokens=1,
            system="s",
            messages=[],
            output_format=Out,
            output_config={"effort": "low"},
        )
    fmt = seen[0]["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert fmt["schema"]["properties"]["label"]["type"] == "string"
    assert seen[0]["output_config"]["effort"] == "low"
    assert "output_format" not in seen[0]


def test_client_is_built_with_one_retry_and_a_timeout(monkeypatch):
    import anthropic

    from radar.llm import _default_send

    built: list[dict] = []
    _stub_anthropic(monkeypatch, anthropic.AnthropicError("x"), [], built)
    for _ in range(2):
        with pytest.raises(LLMError):
            _default_send(
                model="m",
                max_tokens=1,
                system="s",
                messages=[],
                output_format=Out,
                output_config={"effort": "low"},
            )
    assert built == [{"max_retries": 1, "timeout": 120}]


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
    assert full["fallbacks"] == [{"model": "claude-sonnet-5"}]
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
