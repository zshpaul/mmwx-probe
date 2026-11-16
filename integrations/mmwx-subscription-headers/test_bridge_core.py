import unittest
import threading

from bridge_core import Mapping, SourceCache, normalize_request_path, normalize_traffic_header, select_mapping, update_rpc_subscription, validate_upstream


class BridgeCoreTests(unittest.TestCase):
    def setUp(self):
        self.first = Mapping(1, 11, frozenset({"/first"}), "first.yaml")
        self.second = Mapping(2, 22, frozenset({"/second"}), "second.yaml")

    def test_exact_paths_and_ambiguity(self):
        self.assertEqual(select_mapping("/first", [self.first, self.second]), self.first)
        self.assertIsNone(select_mapping("/first/extra", [self.first, self.second]))
        with self.assertRaises(ValueError):
            select_mapping("/first", [self.first, Mapping(3, 33, self.first.paths, "third.yaml")])

    def test_header_preserves_directions_and_rejects_bad_input(self):
        self.assertEqual(normalize_traffic_header("upload=2; download=3; total=20; expire=0"),
                         "upload=2; download=3; total=20; expire=0")
        for value in ("upload=1; download=2", "upload=1; upload=2; download=3; total=20",
                      "upload=-1; download=2; total=20", "upload=1; download=2; total=0"):
            with self.assertRaises(ValueError):
                normalize_traffic_header(value)

    def test_path_decodes_one_safe_layer_and_rejects_ambiguity(self):
        self.assertEqual(normalize_request_path("/x/%6bnown"), "/x/known")
        for value in ("/x/%256bnown", "/x/%2fknown", "/x/%5cknown", "/x/%00",
                      "/x/%2e%2e/known", "/x//known", "/x/%zz"):
            with self.assertRaises(ValueError):
                normalize_request_path(value)

    def test_cache_is_per_source_and_failure_does_not_fabricate(self):
        now = [0.0]
        cache = SourceCache(clock=lambda: now[0])
        self.assertIn("total=10", cache.get(11, lambda: "upload=1;download=2;total=10"))
        self.assertIn("total=20", cache.get(22, lambda: "upload=3;download=4;total=20"))
        now[0] = 31
        with self.assertRaises(ValueError):
            cache.get(11, lambda: "not a quota")
        self.assertIn("total=20", cache.get(22, lambda: "upload=3;download=4;total=20"))

    def test_slow_source_does_not_block_another_source(self):
        cache = SourceCache()
        started = threading.Event()
        release = threading.Event()
        done = threading.Event()
        errors = []
        def slow():
            started.set()
            if not release.wait(2):
                raise TimeoutError("fixture timed out")
            return "upload=1;download=2;total=10"
        def worker():
            try:
                cache.get(11, slow)
            except Exception as exc:
                errors.append(exc)
        thread = threading.Thread(target=worker)
        thread.start()
        try:
            self.assertTrue(started.wait(1))
            def fast():
                cache.get(22, lambda: "upload=3;download=4;total=20")
                done.set()
            other = threading.Thread(target=fast)
            other.start()
            self.assertTrue(done.wait(1), "unrelated source was blocked")
            other.join(timeout=1)
        finally:
            release.set()
            thread.join(timeout=2)
        self.assertFalse(errors)

    def test_rpc_only_updates_exact_id_and_filename(self):
        items = [{"id": 1, "filename": "first.yaml", "traffic_used": 8},
                 {"id": 2, "filename": "second.yaml", "traffic_used": 9}]
        self.assertTrue(update_rpc_subscription(items, self.second, "upload=2;download=3;total=20;expire=1700000000"))
        self.assertEqual(items[0]["traffic_used"], 8)
        self.assertEqual(items[1]["traffic_used"], 5)
        self.assertEqual(items[1]["traffic_total"], 20)
        self.assertEqual(items[1]["expire_at"], "2023-11-14T22:13:20Z")
        update_rpc_subscription(items, self.second, "upload=3;download=4;total=20")
        self.assertEqual(items[1]["expire_at"], "2023-11-14T22:13:20Z")

    def test_upstream_requires_approved_host_and_public_addresses(self):
        validate_upstream("https://example.org/path", "example.org", ["8.8.8.8"])
        for url, addresses in (("http://example.org/path", ["8.8.8.8"]),
                               ("https://other.example/path", ["8.8.8.8"]),
                               ("https://example.org/path", ["127.0.0.1"])):
            with self.assertRaises(ValueError):
                validate_upstream(url, "example.org", addresses)


if __name__ == "__main__":
    unittest.main()
