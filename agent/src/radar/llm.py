from collections.abc import Callable
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

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
    """Send one request; the only code that touches the SDK.

    `request` carries `output_format` (a pydantic class); it is turned into the
    json_schema output format here. The reply is returned raw (text blocks),
    unvalidated, so the caller can record usage before validating.
    """
    import anthropic

    global _client
    try:
        if _client is None:
            _client = anthropic.Anthropic()
        schema = request.pop("output_format")
        request["output_config"] = {
            **request["output_config"],
            "format": {
                "type": "json_schema",
                "schema": anthropic.transform_schema(schema.model_json_schema()),
            },
        }
        namespace = _client.beta.messages if "betas" in request else _client.messages
        return namespace.create(**request)
    except anthropic.AnthropicError as exc:
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
        text = "".join(b.text for b in response.content if b.type == "text")
        try:
            return schema.model_validate_json(text)
        except ValidationError as exc:
            raise LLMError(f"{step}: reply is not a valid {schema.__name__}: {exc}") from exc
