from __future__ import annotations

import sys
from typing import IO, Protocol


class Logger(Protocol):
    """Structured logger available to agents as `ctx.logger` and passed to `open_channel(logger=)`."""

    def debug(self, message: str, **details: object) -> None: ...

    def info(self, message: str, **details: object) -> None: ...

    def warn(self, message: str, **details: object) -> None: ...

    def error(self, message: str, **details: object) -> None: ...


class StderrLogger:
    """Default logger: `warn` and `error` go to stderr; `debug` and `info` are silent."""

    def __init__(self, stream: IO[str] | None = None) -> None:
        self._stream = stream

    def debug(self, message: str, **details: object) -> None:
        del message, details

    def info(self, message: str, **details: object) -> None:
        del message, details

    def warn(self, message: str, **details: object) -> None:
        self._write("WARN", message, details)

    def error(self, message: str, **details: object) -> None:
        self._write("ERROR", message, details)

    def _write(self, level: str, message: str, details: dict[str, object]) -> None:
        suffix = f" {details}" if details else ""
        print(f"[open_channel] {level} {message}{suffix}", file=self._stream or sys.stderr)


class NullLogger:
    """Logger that discards every message."""

    def debug(self, message: str, **details: object) -> None:
        del message, details

    def info(self, message: str, **details: object) -> None:
        del message, details

    def warn(self, message: str, **details: object) -> None:
        del message, details

    def error(self, message: str, **details: object) -> None:
        del message, details
