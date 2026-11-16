import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import sqlite3
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

import legacy_wrapper
import overlay
from bridge_core import Mapping


class LegacyHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, head):
        if self.path != "/first":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", "3")
        self.end_headers()
        if not head:
            self.wfile.write(b"bwh")

    def do_GET(self):
        self.respond(False)

    def do_HEAD(self):
        self.respond(True)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.record = (Mapping(2, 22, frozenset({"/second"})),
                       "https://example.org/test", "test", "example.org")
        self.legacy = types.SimpleNamespace(Handler=LegacyHandler, settings=lambda: ({"/first"}, None))

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
                      "mappings": [{"subscription_id": 2, "external_id": 22, "approved_host": "example.org"}]}
            records = overlay.load_records(config)
            self.assertEqual(records[0][0].paths, frozenset({"/x/file", "/x/fileuser"}))
            for invalid in (11, "11"):
                config["mappings"][0]["external_id"] = invalid
                with self.assertRaises(ValueError):
                    overlay.load_records(config)

    def test_upstream_rejects_unapproved_host_before_dns(self):
        with patch("overlay.socket.getaddrinfo") as lookup:
            with self.assertRaises(ValueError):
                overlay.fetch_upstream_header("https://other.example/path", "", "example.org")
            lookup.assert_not_called()

    def test_overlapping_legacy_path_is_rejected(self):
        overlap = (Mapping(2, 22, frozenset({"/first"})), "https://example.org/test", "", "example.org")
        with patch("legacy_wrapper.load_records", return_value=[overlap]):
            with self.assertRaises(ValueError):
                legacy_wrapper.make_combined_handler(self.legacy, {})

    def test_invalid_configuration_keeps_legacy_handler(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIs(legacy_wrapper.handler_or_legacy(self.legacy, os.path.join(directory, "missing")), LegacyHandler)

    def test_loopback_dmit_failure_does_not_change_bwh_or_rpc(self):
        config = {"panel_host_header": "example.org", "panel_port": 1111}
        with patch("legacy_wrapper.load_records", return_value=[self.record]), patch(
                "overlay.load_records", return_value=[self.record]), patch(
                "overlay.Overlay.forward", return_value=(200, [("Content-Type", "text/plain")], b"fixture")), patch(
                "overlay.fetch_upstream_header", return_value="upload=2;download=3;total=20"):
            handler = legacy_wrapper.make_combined_handler(self.legacy, config)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
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
                connection.request("GET", "/first")
                self.assertEqual(connection.getresponse().read(), b"bwh")
                connection.request("POST", "/api/secure/rpc", b"encrypted-fixture")
                self.assertEqual(connection.getresponse().read(), b"encrypted-fixture")
                connection.close()
                # A fresh handler has an empty cache and a failing added source.
                failing = legacy_wrapper.make_combined_handler(self.legacy, config)
                server.RequestHandlerClass = failing
                with patch("overlay.fetch_upstream_header", side_effect=ValueError("unavailable")):
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                    connection.request("GET", "/second")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 502)
                    self.assertIsNone(response.getheader("Subscription-Userinfo"))
                    response.read()
                    connection.request("GET", "/first")
                    self.assertEqual(connection.getresponse().read(), b"bwh")
                    connection.request("POST", "/api/secure/rpc", b"encrypted-fixture")
                    self.assertEqual(connection.getresponse().read(), b"encrypted-fixture")
                    connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)

    def test_rotated_added_path_uses_one_current_mapping(self):
        config = {"panel_host_header": "example.org", "panel_port": 1111}
        current = [self.record]
        rotated = (Mapping(2, 22, frozenset({"/rotated"})),
                   "https://example.org/test", "test", "example.org")
        with patch("legacy_wrapper.load_records", side_effect=lambda _: current), patch(
                "overlay.load_records", side_effect=AssertionError("request must use captured records")), patch(
                "overlay.Overlay.forward", return_value=(200, [], b"fixture")), patch(
                "overlay.fetch_upstream_header", return_value="upload=2;download=3;total=20"):
            handler = legacy_wrapper.make_combined_handler(self.legacy, config)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                current[:] = [rotated]
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                connection.request("GET", "/rotated")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Subscription-Userinfo"), "upload=2; download=3; total=20")
                response.read()
                connection.request("GET", "/second")
                response = connection.getresponse()
                self.assertEqual(response.status, 404)
                response.read()
                connection.request("GET", "/first")
                self.assertEqual(connection.getresponse().read(), b"bwh")
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
