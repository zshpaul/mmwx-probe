"""Optional synthetic tests using an explicitly supplied legacy source."""
import base64
import http.client
import http.server
import os
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

import legacy_wrapper
import overlay
import test_dispatcher
import test_legacy_fixture
import test_overlay


class WrapperIsolationTests(unittest.TestCase):
    def test_additional_transform_and_global_fallback(self):
        f = test_overlay.OverlayTests("test_rpc_preserves_bwh_and_updates_only_second_group")
        f.setUp()
        request = f.client_public + f.seal(f.keys["c2s"], {"method": "GET", "path": "/subscriptions"})
        response = f.seal(f.keys["s2c"], {"subscriptions": [
            {"id": 1, "filename": "bwh.yaml", "traffic_used": 20},
            {"id": 2, "filename": "second.yaml", "traffic_used": 999},
        ]})
        class Legacy:
            class Handler:
                def respond(self, head):
                    return head
            @staticmethod
            def transform_rpc(_request, payload):
                return payload
        legacy = Legacy()
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / "synthetic-key"
            key.write_bytes(base64.b64encode(f.master_raw))
            legacy_wrapper.make_handler(legacy, {"rpc_key_file": str(key)})
            with patch("overlay.load_records", return_value=[f.record]), \
                 patch.object(overlay.Overlay, "header", return_value="upload=2;download=3;total=20"):
                entries = f.open_response(legacy.transform_rpc(request, response))["subscriptions"]
                self.assertEqual(entries[0]["traffic_used"], 20)
                self.assertEqual((entries[1]["traffic_used"], entries[1]["traffic_total"]), (5, 20))
            with patch("overlay.load_records", side_effect=ValueError("synthetic failure")):
                self.assertEqual(legacy.transform_rpc(request, response), response)


@unittest.skipUnless(os.environ.get("LEGACY_FIXTURE_PATH"), "legacy source snapshot not supplied")
class LegacyWrapperTests(unittest.TestCase):
    def test_rpc_preserves_original_result_on_additional_failure(self):
        legacy_test = test_legacy_fixture.LegacyFixtureTests("test_legacy_rpc_then_overlay_and_failures")
        legacy_test.setUp()
        legacy, f = legacy_test.legacy, legacy_test.fixture
        fixture = test_dispatcher.DispatcherTests("test_dynamic_rotation_and_reassignment")
        fixture.setUp()
        try:
            with tempfile.TemporaryDirectory() as directory:
                key = Path(directory) / "synthetic-key"
                key.write_bytes(base64.b64encode(f.master_raw))
                legacy.pathlib = types.SimpleNamespace(Path=lambda _: key)
                fixture.config["rpc_key_file"] = str(key)
                original = legacy.transform_rpc
                request = f.client_public + f.seal(f.keys["c2s"], {"method": "GET", "path": "/subscriptions"})
                response = f.seal(f.keys["s2c"], {"subscriptions": [
                    {"id": 1, "filename": "bwh-fixture.yaml", "traffic_used": 99},
                    {"id": 2, "filename": "second.yaml", "traffic_used": 999},
                ]})
                before = f.open_response(original(request, response))["subscriptions"]
                self.assertEqual(before[0]["traffic_used"], 20)
                legacy_wrapper.make_handler(legacy, fixture.config)
                with patch("overlay.load_records", return_value=[f.record]), \
                     patch.object(overlay.Overlay, "header", return_value="upload=2;download=3;total=20"):
                    after = f.open_response(legacy.transform_rpc(request, response))["subscriptions"]
                    self.assertEqual(after[0], before[0])
                    self.assertEqual((after[1]["traffic_used"], after[1]["traffic_total"]), (5, 20))
                with patch("overlay.load_records", side_effect=ValueError("synthetic mapping failure")):
                    after = f.open_response(legacy.transform_rpc(request, response))["subscriptions"]
                    self.assertEqual(after[0], before[0])
                    self.assertEqual(after[1]["traffic_used"], 999)
        finally:
            fixture.tearDown()

    def test_legacy_http_rpc_transport_and_fallback(self):
        legacy_test = test_legacy_fixture.LegacyFixtureTests("test_legacy_rpc_then_overlay_and_failures")
        legacy_test.setUp()
        legacy, f = legacy_test.legacy, legacy_test.fixture
        fixture = test_dispatcher.DispatcherTests("test_dynamic_rotation_and_reassignment")
        fixture.setUp()
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / "synthetic-key"
            key.write_bytes(base64.b64encode(f.master_raw))
            legacy.pathlib = types.SimpleNamespace(Path=lambda _: key)
            fixture.config["rpc_key_file"] = str(key)
            request = f.client_public + f.seal(f.keys["c2s"], {"method": "GET", "path": "/subscriptions"})
            upstream = [f.seal(f.keys["s2c"], {"subscriptions": [
                {"id": 1, "filename": "bwh-fixture.yaml", "traffic_used": 99},
                {"id": 2, "filename": "second.yaml", "traffic_used": 999},
            ]})]
            class FakeConnection:
                def __init__(self, *_args, **_kwargs): pass
                def request(self, *_args, **_kwargs): pass
                def getresponse(self):
                    class Response:
                        status = 200
                        def getheaders(self): return [("Content-Type", "application/octet-stream")]
                        def read(self): return upstream[0]
                    return Response()
                def close(self): pass
            legacy.http = types.SimpleNamespace(client=types.SimpleNamespace(HTTPConnection=FakeConnection))
            handler = legacy_wrapper.make_handler(legacy, fixture.config)
            server = overlay.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def post():
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                try:
                    connection.request("POST", "/api/secure/rpc", request)
                    result = connection.getresponse()
                    return result.status, result.read()
                finally:
                    connection.close()
            try:
                with patch("overlay.load_records", return_value=[f.record]), \
                     patch.object(overlay.Overlay, "header", return_value="upload=2;download=3;total=20"):
                    status, payload = post()
                    entries = f.open_response(payload)["subscriptions"]
                    self.assertEqual(status, 200)
                    self.assertEqual(entries[0]["traffic_used"], 20)
                    self.assertEqual((entries[1]["traffic_used"], entries[1]["traffic_total"]), (5, 20))
                with patch("overlay.load_records", return_value=[f.record]), \
                     patch.object(overlay.Overlay, "header", side_effect=ValueError("source unavailable")):
                    status, payload = post()
                    entries = f.open_response(payload)["subscriptions"]
                    self.assertEqual(status, 200)
                    self.assertEqual(entries[0]["traffic_used"], 20)
                    self.assertIsNone(entries[1]["traffic_used"])
                upstream[0] = b"invalid-encrypted-response"
                status, payload = post()
                self.assertEqual((status, payload), (200, upstream[0]))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=3)
                fixture.tearDown()


if __name__ == "__main__":
    unittest.main()
