import json
import os
import base64
import http.client
import tempfile
import threading
import unittest
import sqlite3
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

import overlay
from bridge_core import Mapping


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.master = x25519.X25519PrivateKey.generate()
        self.client = x25519.X25519PrivateKey.generate()
        self.master_raw = self.master.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        self.client_public = self.client.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        master_public = self.master.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        shared = self.client.exchange(self.master.public_key())
        self.keys = {
            direction: HKDF(algorithm=hashes.SHA256(), length=32, salt=self.client_public + master_public,
                            info=("mmx-secure-rpc-" + direction + "-v1").encode()).derive(shared)
            for direction in ("c2s", "s2c")
        }
        self.record = (Mapping(2, 22, frozenset({"/second"}), "second.yaml"),
                       "https://example.org/test", "test", "example.org")

    def seal(self, key, value):
        nonce = os.urandom(12)
        return nonce + ChaCha20Poly1305(key).encrypt(nonce, json.dumps(value).encode(), None)

    def open_response(self, payload):
        return json.loads(ChaCha20Poly1305(self.keys["s2c"]).decrypt(payload[:12], payload[12:], None))

    def test_rpc_preserves_bwh_and_updates_only_second_group(self):
        request = self.client_public + self.seal(self.keys["c2s"], {"method": "GET", "path": "/subscriptions"})
        response = self.seal(self.keys["s2c"], {"subscriptions": [
            {"id": 1, "filename": "first.yaml", "traffic_used": 123},
            {"id": 2, "filename": "second.yaml", "traffic_used": 999},
        ]})
        result = overlay.transform_rpc(request, response, self.master_raw, [self.record],
                                       lambda _: "upload=2;download=3;total=20;expire=0")
        subscriptions = self.open_response(result)["subscriptions"]
        self.assertEqual(subscriptions[0]["traffic_used"], 123)
        self.assertEqual(subscriptions[1]["traffic_used"], 5)
        self.assertEqual(subscriptions[1]["traffic_total"], 20)

    def test_unrelated_rpc_is_unchanged_and_never_fetches(self):
        request = self.client_public + self.seal(self.keys["c2s"], {"method": "GET", "path": "/other"})
        response = self.seal(self.keys["s2c"], {"value": 1})
        def fail(_):
            raise AssertionError("unexpected fetch")
        self.assertEqual(overlay.transform_rpc(request, response, self.master_raw, [self.record], fail), response)

    def test_upstream_rejects_unapproved_host_before_dns(self):
        with patch("overlay.socket.getaddrinfo") as lookup:
            with self.assertRaises(ValueError):
                overlay.fetch_upstream_header("https://other.example/path", "", "example.org")
            lookup.assert_not_called()

    def test_database_mapping_rejects_protected_bwh_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = os.path.join(directory, "fixture.sqlite")
            db = sqlite3.connect(db_path)
            db.executescript("""
                CREATE TABLE subscribe_files(id INTEGER, file_short_code TEXT, custom_short_code TEXT, created_by TEXT);
                CREATE TABLE user_tokens(username TEXT, user_short_code TEXT, custom_user_short_code TEXT);
                CREATE TABLE external_subscriptions(id INTEGER, url TEXT, user_agent TEXT);
                INSERT INTO subscribe_files VALUES (2, 'file', NULL, 'owner');
                INSERT INTO user_tokens VALUES ('owner', 'user', NULL);
                INSERT INTO external_subscriptions VALUES (22, 'https://example.org/test', 'test');
            """)
            db.commit()
            db.close()
            config = {"database": db_path, "protected_subscription_ids": [1], "protected_external_ids": [11],
                      "mappings": [{"subscription_id": 2, "external_id": 22, "rpc_filename": "second.yaml",
                                    "approved_host": "example.org"}]}
            records = overlay.load_records(config)
            self.assertEqual(records[0][0].paths, frozenset({"/x/file", "/x/fileuser"}))
            config["mappings"][0]["external_id"] = 11
            with self.assertRaises(ValueError):
                overlay.load_records(config)
            config["mappings"][0]["external_id"] = "11"
            with self.assertRaises(ValueError):
                overlay.load_records(config)

    def test_loopback_get_and_rpc_fallback_preserve_bwh(self):
        request = self.client_public + self.seal(self.keys["c2s"], {"method": "GET", "path": "/subscriptions"})
        original = self.seal(self.keys["s2c"], {"subscriptions": [
            {"id": 1, "filename": "first.yaml", "traffic_used": 123},
            {"id": 2, "filename": "second.yaml", "traffic_used": 999},
        ]})
        with tempfile.TemporaryDirectory() as directory:
            key_file = os.path.join(directory, "fixture-key")
            with open(key_file, "wb") as key:
                key.write(base64.b64encode(self.master_raw))
            instance = overlay.Overlay({"panel_host_header": "example.org", "panel_port": 1111,
                                        "bwh_bridge_port": 2222, "rpc_key_file": key_file})
            def forward(port, method, target, headers, body=b""):
                if port == 2222:
                    self.assertEqual(body, request)
                    return 200, [("Content-Type", "application/octet-stream")], original
                self.assertEqual(target, "/second")
                return 200, [("Content-Type", "text/plain")], b"fixture"
            instance.forward = forward
            server = overlay.ThreadingHTTPServer(("127.0.0.1", 0), overlay.make_handler(instance))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            with patch("overlay.load_records", return_value=[self.record]), patch(
                    "overlay.fetch_upstream_header", return_value="upload=2;download=3;total=20"):
                thread.start()
                try:
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                    connection.request("GET", "/second")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.getheader("Subscription-Userinfo"), "upload=2; download=3; total=20")
                    self.assertEqual(response.read(), b"fixture")
                    connection.request("GET", "/unknown")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 404)
                    response.read()
                    connection.request("POST", "/api/secure/rpc", request)
                    response = connection.getresponse()
                    values = self.open_response(response.read())["subscriptions"]
                    self.assertEqual(values[0]["traffic_used"], 123)
                    self.assertEqual(values[1]["traffic_used"], 5)
                    connection.close()
                    # An upstream failure must keep BWH and suppress the second
                    # entry's unrelated aggregate quota.
                    instance.cache = overlay.SourceCache()
                    with patch("overlay.fetch_upstream_header", side_effect=ValueError("unavailable")):
                        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                        connection.request("GET", "/second")
                        response = connection.getresponse()
                        self.assertEqual(response.status, 502)
                        self.assertIsNone(response.getheader("Subscription-Userinfo"))
                        response.read()
                        connection.request("POST", "/api/secure/rpc", request)
                        response = connection.getresponse()
                        values = self.open_response(response.read())["subscriptions"]
                        self.assertEqual(values[0]["traffic_used"], 123)
                        self.assertIsNone(values[1]["traffic_used"])
                        self.assertIsNone(values[1]["traffic_total"])
                        connection.close()
                    # Invalid encrypted data fails closed rather than exposing
                    # an unverified aggregate as the additional subscription.
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                    with patch.object(instance, "forward", return_value=(200, [], b"invalid")):
                        connection.request("POST", "/api/secure/rpc", request)
                        response = connection.getresponse()
                        self.assertEqual(response.status, 502)
                        response.read()
                    connection.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
