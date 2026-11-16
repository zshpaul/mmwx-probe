"""Optional local test against an explicitly supplied legacy source snapshot.

The snapshot is never copied into this repository. Real settings and top-level
assignments are not executed; all network, keys and identities are synthetic.
"""
import ast
import base64
import http.client
import os
from pathlib import Path
import tempfile
import threading
import types
import unittest

import overlay
import test_overlay


@unittest.skipUnless(os.environ.get("LEGACY_FIXTURE_PATH"), "legacy source snapshot not supplied")
class LegacyFixtureTests(unittest.TestCase):
    def setUp(self):
        source = Path(os.environ["LEGACY_FIXTURE_PATH"]).read_text(encoding="utf8")
        tree = ast.parse(source)
        nodes = [node for node in tree.body if isinstance(
            node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))]
        # Extract the hard-coded filename without disclosing or persisting it.
        update = next(n for n in nodes if isinstance(n, ast.FunctionDef) and n.name == "update_subscription_list")
        comparisons = [n for n in ast.walk(update) if isinstance(n, ast.Compare)
                       and isinstance(n.left, ast.Call) and isinstance(n.left.func, ast.Attribute)
                       and n.left.func.attr == "get" and n.left.args
                       and isinstance(n.left.args[0], ast.Constant) and n.left.args[0].value == "filename"]
        self.assertEqual(len(comparisons), 1)
        comparisons[0].comparators[0] = ast.Constant("bwh-fixture.yaml")
        tree = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
        self.legacy = types.ModuleType("legacy_fixture")
        exec(compile(tree, "<legacy-fixture>", "exec"), self.legacy.__dict__)
        self.legacy.SUBSCRIPTION_ID = 1
        self.legacy.HOP_HEADERS = overlay.HOP_HEADERS
        self.legacy.MAX_CONFIG_SIZE = 1024
        self.legacy.settings = lambda: ({"/bwh-fixture"}, None)
        self.legacy.upstream_usage = lambda: "upload=7;download=13;total=100;expire=0"
        self.fixture = test_overlay.OverlayTests("test_rpc_preserves_bwh_and_updates_only_second_group")
        self.fixture.setUp()

    def test_legacy_rpc_then_overlay_and_failures(self):
        f = self.fixture
        request = f.client_public + f.seal(f.keys["c2s"], {"method": "GET", "path": "/subscriptions"})
        entries = [{"id": 1, "filename": "bwh-fixture.yaml", "traffic_used": 999},
                   {"id": 2, "filename": "second.yaml", "traffic_used": 999}]
        response = f.seal(f.keys["s2c"], {"subscriptions": entries})
        with tempfile.TemporaryDirectory() as directory:
            keyfile = Path(directory) / "key"
            keyfile.write_bytes(base64.b64encode(f.master_raw))
            self.legacy.pathlib = types.SimpleNamespace(Path=lambda _: keyfile)
            legacy_response = self.legacy.transform_rpc(request, response)
        before = f.open_response(legacy_response)["subscriptions"]
        self.assertEqual(before[0]["traffic_used"], 20)
        result = overlay.transform_rpc(request, legacy_response, f.master_raw, [f.record],
                                       lambda _: "upload=2;download=3;total=214748364800")
        after = f.open_response(result)["subscriptions"]
        self.assertEqual(after[0], before[0])
        self.assertEqual((after[1]["traffic_used"], after[1]["traffic_total"]), (5, 214748364800))
        def unavailable(_):
            raise ValueError("synthetic failure")
        failed = overlay.transform_rpc(request, legacy_response, f.master_raw, [f.record], unavailable)
        values = f.open_response(failed)["subscriptions"]
        self.assertEqual(values[0], before[0])
        self.assertIsNone(values[1]["traffic_used"])
        self.assertIsNone(values[1]["traffic_total"])

    def test_legacy_bwh_get_and_head(self):
        class FakeResponse:
            headers = {"Content-Type": "text/plain"}
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, _): return b"synthetic panel body"
        self.legacy.CLIENT = types.SimpleNamespace(open=lambda *_args, **_kwargs: FakeResponse())
        server = overlay.ThreadingHTTPServer(("127.0.0.1", 0), self.legacy.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for method in ("GET", "HEAD"):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                connection.request(method, "/bwh-fixture")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Subscription-Userinfo"), "upload=7;download=13;total=100;expire=0")
                self.assertEqual(response.read(), b"synthetic panel body" if method == "GET" else b"")
                connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
