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
from bridge_core import Mapping


@unittest.skipUnless(os.environ.get("NGINX_FIXTURE") == "1" and shutil.which("nginx"),
                     "nginx fixture not requested or nginx unavailable")
class NginxFixtureTests(unittest.TestCase):
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
