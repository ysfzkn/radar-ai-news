from typing import Any

from pydantic import BaseModel


class FakeLLM:
    """Scripted LLM for tests: replies are keyed by step, no meter, no network."""

    def __init__(self, replies: dict[str, list[BaseModel | Exception]]) -> None:
        self._replies = {step: list(items) for step, items in replies.items()}
        self.calls: list[dict[str, Any]] = []

    def parse(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        step = kwargs["step"]
        queue = self._replies.get(step)
        if not queue:
            raise AssertionError(f"unexpected LLM call: no reply left for step {step!r}")
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply
