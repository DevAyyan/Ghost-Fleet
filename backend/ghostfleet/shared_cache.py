"""A cache shared by every running instance of the API: Upstash Redis over its REST API (stdlib only).

On Vercel each function instance has its own /tmp, so without this every new instance fetches the same upstream data
again. With it, an upstream answer is fetched once and every instance reads the stored copy.

Switched on by UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN, the names the
Vercel marketplace integration sets). Unset, it does nothing. It is only ever a cache: any failure (network, quota,
oversized value) is logged and the request carries on as if the key were missing. Values are gzipped JSON.
"""
from __future__ import annotations

import base64
import gzip
import json
import logging
import os
import time
import urllib.request

log = logging.getLogger("ghostfleet.shared_cache")
PREFIX = "gfx:v1:"
TIMEOUT_S = 4.0                    # a slow cache must never cost more than it saves
MAX_VALUE_BYTES = 8_000_000        # stay under Upstash's free-tier request size


class SharedCache:
    def __init__(self, url: str, token: str):
        self.url, self.token = url.rstrip("/"), token

    @classmethod
    def from_env(cls) -> SharedCache | None:
        url = os.getenv("UPSTASH_REDIS_REST_URL") or os.getenv("KV_REST_API_URL")
        token = os.getenv("UPSTASH_REDIS_REST_TOKEN") or os.getenv("KV_REST_API_TOKEN")
        return cls(url, token) if url and token else None

    def _cmd(self, *args):
        req = urllib.request.Request(self.url, data=json.dumps(list(args)).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.loads(r.read()).get("result")

    def get(self, key: str) -> tuple[float, object] | None:
        """(unix time it was stored, value), or None if missing or the cache could not be read."""
        try:
            raw = self._cmd("GET", PREFIX + key)
            if not raw:
                return None
            box = json.loads(gzip.decompress(base64.b64decode(raw)))
            return float(box["t"]), box["v"]
        except Exception as e:  # noqa: BLE001 - a cache miss, never an error for the caller
            log.warning("shared cache read failed for %s: %s", key, type(e).__name__)
            return None

    def put(self, key: str, value: object, ttl_s: int) -> None:
        """Store `value`; `ttl_s` is how long it may be kept at all (also as a stale fallback), not how long it is fresh."""
        try:
            raw = base64.b64encode(gzip.compress(json.dumps({"t": time.time(), "v": value}, separators=(",", ":")).encode(), 6))
            if len(raw) > MAX_VALUE_BYTES:
                log.warning("shared cache: %s is %d bytes, not stored", key, len(raw))
                return
            self._cmd("SET", PREFIX + key, raw.decode(), "EX", str(int(ttl_s)))
        except Exception as e:  # noqa: BLE001
            log.warning("shared cache write failed for %s: %s", key, type(e).__name__)
