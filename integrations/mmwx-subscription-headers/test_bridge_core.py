import unittest

from bridge_core import Mapping, SourceCache, normalize_traffic_header, select_mapping, update_rpc_subscription, validate_upstream


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

    def test_cache_is_per_source_and_failure_does_not_fabricate(self):
        now = [0.0]
        cache = SourceCache(clock=lambda: now[0])
        self.assertIn("total=10", cache.get(11, lambda: "upload=1;download=2;total=10"))
        self.assertIn("total=20", cache.get(22, lambda: "upload=3;download=4;total=20"))
        now[0] = 31
        with self.assertRaises(ValueError):
            cache.get(11, lambda: "not a quota")
        self.assertIn("total=20", cache.get(22, lambda: "upload=3;download=4;total=20"))

    def test_rpc_only_updates_exact_id_and_filename(self):
        items = [{"id": 1, "filename": "first.yaml", "traffic_used": 8},
                 {"id": 2, "filename": "second.yaml", "traffic_used": 9}]
        self.assertTrue(update_rpc_subscription(items, self.second, "upload=2;download=3;total=20;expire=1700000000"))
        self.assertEqual(items[0]["traffic_used"], 8)
        self.assertEqual(items[1]["traffic_used"], 5)
        self.assertEqual(items[1]["traffic_total"], 20)
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
