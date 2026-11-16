"""Loopback-only handler for an explicitly mapped additional subscription.

All real paths, hostnames, identifiers and key locations come from a private
configuration file. This program is not installed or started by the project.
"""

import http.client
from pathlib import Path
import socket
import sqlite3
import ssl
from urllib.parse import quote, urlsplit
from http.server import BaseHTTPRequestHandler

from bridge_core import Mapping, SourceCache, select_mapping, validate_upstream

MAX_BODY = 16 * 1024 * 1024
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailer", "transfer-encoding", "upgrade", "content-length"}


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname: str, address: str):
        super().__init__(hostname, 443, timeout=15, context=ssl.create_default_context())
        self._address = address

    def connect(self):
        raw = socket.create_connection((self._address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def fetch_upstream_header(url: str, user_agent: str, approved_host: str) -> str:
    parsed = urlsplit(url)
    # Do not resolve attacker-selected hosts before checking the allowlist.
    if not parsed.hostname or parsed.hostname.lower() != approved_host.lower():
        raise ValueError("unapproved upstream")
    addresses = sorted({entry[4][0] for entry in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)})
    validate_upstream(url, approved_host, addresses)
    connection = PinnedHTTPSConnection(parsed.hostname, addresses[0])
    try:
        target = parsed.path or "/"
        if parsed.query:
            target += "?" + parsed.query
        connection.request("GET", target, headers={"User-Agent": user_agent or "clash-meta/2.4.0",
                                                   "Accept-Encoding": "identity"})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("upstream unavailable")
        value = response.getheader("Subscription-Userinfo")
        if value is None:
            raise ValueError("upstream quota missing")
        return value
    finally:
        connection.close()


def load_records(config: dict) -> list[tuple[Mapping, str, str, str]]:
    protected_subscriptions = config["protected_subscription_ids"]
    protected_externals = config["protected_external_ids"]
    valid_ids = lambda values: isinstance(values, list) and bool(values) and all(type(value) is int and value > 0 for value in values)
    if not valid_ids(protected_subscriptions) or not valid_ids(protected_externals):
        raise ValueError("protected BWH identities must be configured")
    db_path = Path(config["database"]).resolve()
    db = sqlite3.connect("file:" + quote(str(db_path), safe="/") + "?mode=ro", uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        result = []
        for entry in config["mappings"]:
            sid, eid = entry["subscription_id"], entry["external_id"]
            if type(sid) is not int or sid <= 0 or type(eid) is not int or eid <= 0:
                raise ValueError("invalid record identity")
            if sid in protected_subscriptions or eid in protected_externals:
                raise ValueError("mapping conflicts with protected identity")
            codes = db.execute("SELECT file_short_code,custom_short_code FROM subscribe_files WHERE id=?", (sid,)).fetchone()
            owners = db.execute("SELECT user_short_code,custom_user_short_code FROM user_tokens WHERE username=(SELECT created_by FROM subscribe_files WHERE id=?)", (sid,)).fetchone()
            external = db.execute("SELECT url,user_agent FROM external_subscriptions WHERE id=?", (eid,)).fetchone()
            if not codes or not external:
                raise ValueError("configured record missing")
            paths = {"/x/" + code for code in codes if code}
            paths.update("/x/" + code + owner for code in codes if code for owner in (owners or ()) if owner)
            mapping = Mapping(sid, eid, frozenset(paths))
            result.append((mapping, external[0], external[1] or "", entry["approved_host"]))
        # Reject duplicate paths, external identities and subscription identities.
        seen_paths, seen_external, seen_subscriptions = set(), set(), set()
        for mapping, _, _, _ in result:
            if not mapping.paths or seen_paths.intersection(mapping.paths) or mapping.external_id in seen_external or mapping.subscription_id in seen_subscriptions:
                raise ValueError("ambiguous configuration")
            seen_paths.update(mapping.paths)
            seen_external.add(mapping.external_id)
            seen_subscriptions.add(mapping.subscription_id)
        return result
    finally:
        db.close()


class Overlay:
    def __init__(self, config: dict):
        self.config = config
        self.cache = SourceCache()

    def header(self, record):
        mapping, url, agent, host = record
        return self.cache.get(mapping.external_id, lambda: fetch_upstream_header(url, agent, host))

    def forward(self, port: int, method: str, target: str, headers: dict, body: bytes = b""):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        try:
            connection.request(method, target, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read(MAX_BODY + 1)
            if len(payload) > MAX_BODY:
                raise ValueError("response too large")
            return response.status, response.getheaders(), payload
        finally:
            connection.close()


def make_handler(overlay: Overlay):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):
            pass

        def send_payload(self, status, headers, payload, head=False):
            self.send_response(status)
            for key, value in headers:
                if key.lower() not in HOP_HEADERS:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if not head:
                self.wfile.write(payload)

        def do_HEAD(self):
            self.handle_subscription(True)

        def do_GET(self):
            self.handle_subscription(False)

        def handle_subscription(self, head):
            try:
                records = getattr(self, "_additional_records", None)
                if records is None:
                    records = load_records(overlay.config)
                selected = select_mapping(urlsplit(self.path).path, [record[0] for record in records])
                if selected is None:
                    self.send_error(404)
                    return
                record = next(record for record in records if record[0] == selected)
                headers = {"User-Agent": self.headers.get("User-Agent", ""),
                           "Accept-Encoding": "identity", "Host": overlay.config["panel_host_header"]}
                status, response_headers, body = overlay.forward(overlay.config["panel_port"], "GET", self.path, headers)
                if status != 200:
                    raise ValueError("panel unavailable")
                value = overlay.header(record)
                allowed = {"content-type", "content-disposition", "profile-title", "profile-update-interval",
                           "profile-web-page-url", "support-url"}
                response_headers = [(k, v) for k, v in response_headers if k.lower() in allowed]
                response_headers.append(("Subscription-Userinfo", value))
                response_headers.append(("Cache-Control", "no-store"))
                self.send_payload(200, response_headers, body, head)
            except Exception:
                self.send_error(502, "subscription unavailable")

    return Handler
