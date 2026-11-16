"""Loopback-only DMIT-style overlay in front of an existing BWH RPC bridge.

All real paths, hostnames, identifiers and key locations come from a private
configuration file. This program is not installed or started by the project.
"""

import base64
import http.client
import json
import os
from pathlib import Path
import socket
import sqlite3
import ssl
import sys
from urllib.parse import quote, urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from bridge_core import Mapping, SourceCache, select_mapping, update_rpc_subscription, validate_upstream

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
            mapping = Mapping(sid, eid, frozenset(paths), entry["rpc_filename"])
            result.append((mapping, external[0], external[1] or "", entry["approved_host"]))
        # Reject duplicate paths, external identities and RPC identities.
        seen_paths, seen_external, seen_rpc = set(), set(), set()
        for mapping, _, _, _ in result:
            rpc = (mapping.subscription_id, mapping.rpc_filename)
            if not mapping.paths or seen_paths.intersection(mapping.paths) or mapping.external_id in seen_external or rpc in seen_rpc:
                raise ValueError("ambiguous configuration")
            seen_paths.update(mapping.paths)
            seen_external.add(mapping.external_id)
            seen_rpc.add(rpc)
        return result
    finally:
        db.close()


def transform_rpc(request_body: bytes, response_body: bytes, private_bytes: bytes,
                  records: list[tuple[Mapping, str, str, str]], get_header) -> bytes:
    private = x25519.X25519PrivateKey.from_private_bytes(private_bytes)
    master = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    public = request_body[:32]
    shared = private.exchange(x25519.X25519PublicKey.from_public_bytes(public))
    keys = {direction: HKDF(algorithm=hashes.SHA256(), length=32, salt=public + master,
                            info=("mmx-secure-rpc-" + direction + "-v1").encode()).derive(shared)
            for direction in ("c2s", "s2c")}
    request = json.loads(ChaCha20Poly1305(keys["c2s"]).decrypt(request_body[32:44], request_body[44:], None))
    if request.get("method", "GET") != "GET" or request.get("path") != "/subscriptions":
        return response_body
    response = json.loads(ChaCha20Poly1305(keys["s2c"]).decrypt(response_body[:12], response_body[12:], None))
    if not isinstance(response, dict) or not isinstance(response.get("subscriptions"), list):
        return response_body
    changed = False
    for record in records:
        mapping = record[0]
        items = response["subscriptions"]
        matched = [item for item in items if isinstance(item, dict)
                   and item.get("id") == mapping.subscription_id and item.get("filename") == mapping.rpc_filename]
        if matched:
            try:
                changed = update_rpc_subscription(items, mapping, get_header(record)) or changed
            except Exception:
                # Do not leave an unrelated aggregate quota on this entry.
                for item in matched:
                    item["traffic_used"] = None
                    item["traffic_total"] = None
                    item["expire_at"] = None
                changed = True
    if not changed:
        return response_body
    nonce = os.urandom(12)
    return nonce + ChaCha20Poly1305(keys["s2c"]).encrypt(nonce, json.dumps(response, ensure_ascii=False).encode(), None)


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

        def do_POST(self):
            if self.path != "/api/secure/rpc":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 * 1024:
                    self.send_error(413)
                    return
                body = self.rfile.read(length)
                headers = {key: value for key, value in self.headers.items() if key.lower() not in HOP_HEADERS}
                headers["Accept-Encoding"] = "identity"
                status, response_headers, payload = overlay.forward(overlay.config["bwh_bridge_port"], "POST", self.path, headers, body)
                if status == 200:
                    try:
                        key = base64.b64decode(Path(overlay.config["rpc_key_file"]).read_bytes(), validate=True)
                        payload = transform_rpc(body, payload, key, load_records(overlay.config), overlay.header)
                    except Exception:
                        # An unverifiable response could contain an aggregate
                        # incorrectly attributed to the additional subscription.
                        self.send_error(502, "RPC transformation unavailable")
                        return
                self.send_payload(status, response_headers, payload)
            except Exception:
                self.send_error(502, "RPC unavailable")

    return Handler


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: overlay.py PRIVATE_CONFIG")
    with open(sys.argv[1], encoding="utf8") as source:
        config = json.load(source)
    overlay = Overlay(config)
    # Validate mappings before opening the loopback listener.
    load_records(config)
    ThreadingHTTPServer(("127.0.0.1", int(config["listen_port"])), make_handler(overlay)).serve_forever()


if __name__ == "__main__":
    main()
