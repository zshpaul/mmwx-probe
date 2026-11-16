"""Pure selection and validation helpers for subscription header bridging.

This module does not open sockets, read production configuration, or write data.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import ipaddress
import re
import threading
import time
from typing import Callable
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Mapping:
    subscription_id: int
    external_id: int
    paths: frozenset[str]
    rpc_filename: str


def select_mapping(path: str, mappings: list[Mapping]) -> Mapping | None:
    """Match a complete request path, rejecting ambiguous configuration."""
    matches = [mapping for mapping in mappings if path in mapping.paths]
    if len(matches) > 1:
        raise ValueError("ambiguous subscription path")
    return matches[0] if matches else None


def normalize_traffic_header(value: str) -> str:
    """Preserve the upstream upload, download, total and optional expiry."""
    fields: dict[str, int] = {}
    for part in value.split(";"):
        key, sep, raw = part.strip().partition("=")
        if key not in ("upload", "download", "total", "expire"):
            continue
        if not sep or not re.fullmatch(r"\d+", raw) or key in fields:
            raise ValueError("invalid traffic field")
        fields[key] = int(raw)
        if fields[key] > 9223372036854775807:
            raise ValueError("traffic field exceeds supported range")
    if not {"upload", "download", "total"} <= fields.keys() or fields["total"] <= 0:
        raise ValueError("missing traffic allowance")
    return "; ".join(f"{key}={fields[key]}" for key in ("upload", "download", "total", "expire") if key in fields)


def validate_upstream(url: str, approved_host: str, addresses: list[str]) -> None:
    """Validate a configured upstream and its resolved addresses before dialing.

    The caller must pin the validated address for the request and preserve TLS
    hostname verification; a separate DNS lookup after this check is unsafe.
    """
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.fragment
            or parsed.hostname.lower() != approved_host.lower().rstrip(".")
            or parsed.port not in (None, 443)):
        raise ValueError("unapproved upstream")
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("upstream resolves to a non-public address")


def update_rpc_subscription(items: object, mapping: Mapping, header: str) -> bool:
    """Change only the configured subscription entry in an already decoded RPC."""
    if not isinstance(items, list):
        return False
    fields = dict(part.split("=", 1) for part in normalize_traffic_header(header).split("; "))
    expiry = int(fields.get("expire", "0"))
    expires_at = datetime.fromtimestamp(expiry, timezone.utc).isoformat().replace("+00:00", "Z") if expiry else None
    matches = [item for item in items if isinstance(item, dict)
               and item.get("id") == mapping.subscription_id
               and item.get("filename") == mapping.rpc_filename]
    for item in matches:
        item["traffic_used"] = int(fields["upload"]) + int(fields["download"])
        item["traffic_total"] = int(fields["total"])
        item["expire_at"] = expires_at
    return bool(matches)


class SourceCache:
    """Cache independently by external record; errors never create values."""

    def __init__(self, ttl: float = 30, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl
        self._clock = clock
        self._values: dict[int, tuple[float, str]] = {}
        self._lock = threading.Lock()
        self._source_locks: dict[int, threading.Lock] = {}

    def get(self, external_id: int, fetch: Callable[[], str]) -> str:
        with self._lock:
            source_lock = self._source_locks.setdefault(external_id, threading.Lock())
        with source_lock:
            cached = self._values.get(external_id)
            now = self._clock()
            if cached and now - cached[0] < self._ttl:
                return cached[1]
            value = normalize_traffic_header(fetch())
            self._values[external_id] = (self._clock(), value)
            return value
