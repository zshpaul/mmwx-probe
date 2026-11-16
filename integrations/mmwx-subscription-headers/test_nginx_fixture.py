"""Opt-in nginx + actual overlay fixture; deliberately not a production config."""
import http.client
import http.server
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import overlay
import dispatcher
from bridge_core import Mapping
from test_dispatcher import DispatcherTests


@unittest.skipUnless(os.environ.get("NGINX_FIXTURE") == "1" and shutil.which("nginx"),
                     "nginx fixture not requested or nginx unavailable")
class NginxFixtureTests(unittest.TestCase):
    def test_guarded_dispatcher_rotation_and_nginx_boundary(self):
        fixture = DispatcherTests("test_dynamic_rotation_and_reassignment")
        fixture.setUp()
        config = fixture.config
        fixture.db.execute("UPDATE subscribe_files SET id=4 WHERE id=1")
        fixture.db.execute("UPDATE subscribe_files SET id=5 WHERE id=2")
        fixture.db.execute("UPDATE external_subscriptions SET id=10 WHERE id=22")
        fixture.db.commit()
        config["protected_subscription_ids"] = [4]
        config["protected_external_ids"] = [9]
        config["mappings"][0]["subscription_id"] = 5
        config["mappings"][0]["external_id"] = 10
        config.update({"panel_host_header": "example.org", "panel_port": 1111, "bwh_bridge_port": 2222})
        instance = overlay.Overlay(config)
        instance.header = lambda _: "upload=2; download=3; total=20"
        server = overlay.ThreadingHTTPServer(("127.0.0.1", 0), dispatcher.make_dispatch_handler(overlay, instance))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        reserve = socket.socket()
        reserve.bind(("127.0.0.1", 0))
        port = reserve.getsockname()[1]
        reserve.close()
        # An upstream fixture represents the normal X catch-all, without data.
        class Panel(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/x/ordinary?redirect=1":
                    self.send_response(307)
                    self.send_header("Location", "/x/dmit")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Subscription-Userinfo", "aggregate-fixture")
                self.end_headers()
            def log_message(self, *_): pass
        class Bwh(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Subscription-Userinfo", "legacy-bwh")
                self.end_headers()
            def log_message(self, *_): pass
        bwh_header = "legacy-bwh"
        if os.environ.get("LEGACY_FIXTURE_PATH"):
            import types
            import test_legacy_fixture
            legacy_test = test_legacy_fixture.LegacyFixtureTests("test_legacy_bwh_get_and_head")
            legacy_test.setUp()
            legacy = legacy_test.legacy
            class FakeResponse:
                headers = {"Content-Type": "text/plain"}
                def __enter__(self): return self
                def __exit__(self, *_): pass
                def read(self, _): return b"synthetic legacy panel"
            legacy.CLIENT = types.SimpleNamespace(open=lambda *_args, **_kwargs: FakeResponse())
            legacy.settings = lambda: ({"/x/bwh", "/x/newbwh"}, None)
            Bwh = legacy.Handler
            bwh_header = "upload=7;download=13;total=100;expire=0"
        panel = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Panel)
        panel_thread = threading.Thread(target=panel.serve_forever, daemon=True)
        panel_thread.start()
        bwh = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Bwh)
        bwh_thread = threading.Thread(target=bwh.serve_forever, daemon=True)
        bwh_thread.start()
        config["panel_port"] = panel.server_port
        config["bwh_bridge_port"] = bwh.server_port
        with tempfile.TemporaryDirectory(prefix="dispatch-nginx-") as directory:
            conf = Path(directory) / "nginx.conf"
            conf.write_text(
                r"""events {}
http {
  access_log off;
  map $request_uri $reject_subscription_path {
    default 0;
    "~*^/%(?:25)*78(?:/|%(?:25)*2f)" 1;
    "~*^/(?:/|%(?:25)*2f)+(?:x|%(?:25)*78)(?:/|%(?:25)*2f)" 1;
    "~*^/x%(?:25)*2f" 1;
    "~*^/x/[^?]*%" 1;
    "~^/x//" 1;
    "~^/x/(?:[^?]*/)?\.{1,2}(?:/|$|\?)" 1;
  }
  server {
""" +
                f"listen 127.0.0.1:{port}; "
                "if ($reject_subscription_path) { return 400; } "
                f"location ^~ /x/ {{ proxy_pass http://127.0.0.1:{server.server_port}; }} "
                f"location / {{ proxy_pass http://127.0.0.1:{panel.server_port}; }} "
                "} }\n", encoding="utf8")
            proc = None
            def get(path):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                try:
                    conn.request("GET", path)
                    response = conn.getresponse()
                    response.read()
                    return response.status, response.getheader("Subscription-Userinfo"), response.getheader("Location")
                finally:
                    conn.close()
            try:
                subprocess.run(["nginx", "-t", "-p", directory + "/", "-c", str(conf)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                proc = subprocess.Popen(["nginx", "-p", directory + "/", "-c", str(conf), "-g", "daemon off;"],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                for _ in range(50):
                    try:
                        get("/x/dmit")
                        break
                    except OSError:
                        time.sleep(0.05)
                self.assertEqual(get("/x/dmit"), (200, "upload=2; download=3; total=20", None))
                self.assertEqual(get("/x/bwh"), (200, bwh_header, None))
                self.assertEqual(get("/x/ordinary?value=%25"), (200, "aggregate-fixture", None))
                self.assertEqual(get("/x/ordinary?redirect=1"), (307, None, "/x/dmit"))
                self.assertEqual(get("/x/dmit")[1], "upload=2; download=3; total=20")
                for invalid in ("/%2578/dmit", "/%78/dmit", "/x/%2564mit", "/x/%64mit",
                                "/x%2fdmit", "/%2fx/dmit", "/x/../dmit", "/x//dmit"):
                    self.assertEqual(get(invalid)[0], 400, invalid)
                self.assertEqual(get("/unrelated?value=%25")[0], 200)
                fixture.db.execute("UPDATE subscribe_files SET file_short_code='newbwh' WHERE id=4")
                fixture.db.execute("UPDATE subscribe_files SET file_short_code='bwh' WHERE id=5")
                fixture.db.commit()
                self.assertEqual(get("/x/newbwh"), (200, bwh_header, None))
                self.assertEqual(get("/x/bwh"), (200, "upload=2; download=3; total=20", None))
                self.assertEqual(get("/x/dmit")[0], 404)
                fixture.db.execute("UPDATE subscribe_files SET custom_short_code='bwh' WHERE id=3")
                fixture.db.commit()
                self.assertEqual(get("/x/bwh")[0], 503)
                fixture.db.execute("UPDATE subscribe_files SET custom_short_code=NULL WHERE id=3")
                fixture.db.commit()
                config["database"] += ".missing"
                self.assertEqual(get("/x/ordinary")[0], 503)
            finally:
                if proc is not None:
                    proc.terminate()
                    proc.wait(timeout=5)
                server.shutdown()
                server.server_close()
                panel.shutdown()
                panel.server_close()
                bwh.shutdown()
                bwh.server_close()
                thread.join(timeout=2)
                panel_thread.join(timeout=2)
                bwh_thread.join(timeout=2)
                fixture.tearDown()

    def test_exact_location_fails_to_protect_rotated_paths(self):
        class Panel(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Subscription-Userinfo", "aggregate-fixture")
                self.end_headers()
                self.wfile.write(b"panel")
            def log_message(self, *_): pass

        panel = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Panel)
        mapping = Mapping(2, 22, frozenset({"/x/known"}), "fixture.yaml")
        record = (mapping, "https://example.org/fixture", "", "example.org")
        instance = overlay.Overlay({"panel_host_header": "example.org", "panel_port": 1234})
        instance.header = lambda _: "upload=2; download=3; total=20"
        instance.forward = lambda *_args, **_kwargs: (200, [("Content-Type", "text/plain")], b"config")
        bridge = overlay.ThreadingHTTPServer(("127.0.0.1", 0), overlay.make_handler(instance))
        threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (panel, bridge)]
        for thread in threads:
            thread.start()
        reserve = socket.socket()
        reserve.bind(("127.0.0.1", 0))
        port = reserve.getsockname()[1]
        reserve.close()
        with tempfile.TemporaryDirectory(prefix="overlay-nginx-") as directory:
            conf = Path(directory) / "nginx.conf"
            conf.write_text(
                "events {}\nhttp { access_log off; server { "
                f"listen 127.0.0.1:{port}; "
                f"location = /x/known {{ proxy_pass http://127.0.0.1:{bridge.server_port}; }} "
                f"location / {{ proxy_pass http://127.0.0.1:{panel.server_port}; }} "
                "} }\n", encoding="utf8")
            proc = None
            def get(path):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                try:
                    conn.request("GET", path)
                    response = conn.getresponse()
                    body = response.read()
                    return response.status, response.getheader("Subscription-Userinfo"), body
                finally:
                    conn.close()
            try:
                subprocess.run(["nginx", "-t", "-p", directory + "/", "-c", str(conf)],
                               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                proc = subprocess.Popen(["nginx", "-p", directory + "/", "-c", str(conf), "-g", "daemon off;"],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                with patch("overlay.load_records", return_value=[record]):
                    for _ in range(50):
                        try:
                            get("/x/known")
                            break
                        except OSError:
                            time.sleep(0.05)
                    for path in ("/x/known", "/x/known?q=1", "/x/%6bnown"):
                        self.assertEqual(get(path), (200, "upload=2; download=3; total=20", b"config"))
                    # These assertions document the flaw in this exact-location
                    # example: they are not acceptance of production routing.
                    for path in ("/x/%256bnown", "/x/rotated", "/ordinary", "/rpc"):
                        self.assertEqual(get(path), (200, "aggregate-fixture", b"panel"))
                    bridge.shutdown()
                    bridge.server_close()
                    status, header, _ = get("/x/known")
                    self.assertEqual((status, header), (502, None))
            finally:
                if proc is not None:
                    proc.terminate()
                    proc.wait(timeout=5)
                panel.shutdown()
                panel.server_close()
                bridge.shutdown()
                bridge.server_close()
                for thread in threads:
                    thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
