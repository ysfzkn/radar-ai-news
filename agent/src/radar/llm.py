from collections.abc import Callable
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

from radar.budget import Meter

T = TypeVar("T", bound=BaseModel)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class Refused(Exception):
    """The model refused (stop_reason == "refusal")."""


class LLMError(Exception):
    """API, connection or validation failure after the SDK's own retries."""


class LLM(Protocol):
    def parse(
        self,
        *,
        step: str,
        model: str,
        system: str,
        user: str,
        schema: type[T],
        max_tokens: int,
        effort: str,
        thinking_off: bool = False,
        fallback: bool = False,
    ) -> T: ...


_client: Any = None


def _default_send(**request: Any) -> Any:
    import anthropic

    global _client
    try:
        if _client is None:
            _client = anthropic.Anthropic()
        namespace = _client.beta.messages if "betas" in request else _client.messages
        return namespace.parse(**request)
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        raise LLMError(f"{type(exc).__name__}: {exc}") from exc


class AnthropicLLM:
    def __init__(self, meter: Meter, send: Callable[..., Any] | None = None) -> None:
        self._meter = meter
        self._send = send or _default_send

    def parse(
        self,
        *,
        step: str,
        model: str,
        system: str,
        user: str,
        schema: type[T],
        max_tokens: int,
        effort: str,
        thinking_off: bool = False,
        fallback: bool = False,
    ) -> T:
        self._meter.reserve(model, len(system) + len(user), max_tokens)
        request: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_format": schema,
            "output_config": {"effort": effort},
        }
        if thinking_off:
            request["thinking"] = {"type": "disabled"}
        if fallback:
            request["betas"] = [FALLBACK_BETA]
            request["fallbacks"] = "default"
        response = self._send(**request)
        usage = response.usage
        self._meter.record(step, response.model, usage.input_tokens, usage.output_tokens)
        if response.stop_reason == "refusal":
            category = getattr(response.stop_details, "category", None)
            raise Refused(f"{step}: model refused" + (f" ({category})" if category else ""))
        if response.stop_reason == "max_tokens":
            raise LLMError(f"{step}: reply truncated at max_tokens={max_tokens}")
        parsed = response.parsed_output
        if not isinstance(parsed, schema):
            raise LLMError(f"{step}: no valid {schema.__name__} in the reply")
        return parsed
