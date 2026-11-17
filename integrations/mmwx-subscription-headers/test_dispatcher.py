import http.client
import os
import threading
import sqlite3
import tempfile
import unittest

import dispatcher
import overlay


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.dbpath = os.path.join(self.directory.name, "fixture.sqlite")
        self.db = sqlite3.connect(self.dbpath)
        self.db.executescript("""
            CREATE TABLE subscribe_files(id INTEGER, filename TEXT, file_short_code TEXT,
                custom_short_code TEXT, created_by TEXT);
            CREATE TABLE user_tokens(username TEXT, user_short_code TEXT, custom_user_short_code TEXT);
            CREATE TABLE external_subscriptions(id INTEGER, url TEXT, user_agent TEXT);
            INSERT INTO user_tokens VALUES ('owner','owner',NULL);
            INSERT INTO subscribe_files VALUES (1,'bwh.yaml','bwh',NULL,'owner');
            INSERT INTO subscribe_files VALUES (2,'dmit.yaml','dmit',NULL,'owner');
            INSERT INTO subscribe_files VALUES (3,'normal.yaml','ordinary',NULL,'owner');
            INSERT INTO external_subscriptions VALUES (22,'https://example.org/synthetic','fixture');
        """)
        self.db.commit()
        self.config = {"database": self.dbpath, "protected_subscription_ids": [1],
                       "protected_external_ids": [11], "mappings": [
                           {"subscription_id": 2, "external_id": 22, "rpc_filename": "dmit.yaml",
                            "approved_host": "example.org"}]}

    def tearDown(self):
        self.db.close()
        self.directory.cleanup()

    def test_dynamic_rotation_and_reassignment(self):
        self.assertEqual(dispatcher.classify("/x/bwh", self.config)[0], "protected")
        self.assertEqual(dispatcher.classify("/x/dmit?query=1", self.config)[0], "additional")
        self.assertEqual(dispatcher.classify("/x/%64mit", self.config)[0], "additional")
        self.assertEqual(dispatcher.classify("/x/ordinary", self.config)[0], "ordinary")
        self.db.execute("UPDATE subscribe_files SET file_short_code='newbwh' WHERE id=1")
        self.db.execute("UPDATE subscribe_files SET file_short_code='bwh' WHERE id=2")
        self.db.commit()
        self.assertEqual(dispatcher.classify("/x/bwh", self.config)[0], "additional")
        self.assertEqual(dispatcher.classify("/x/newbwh", self.config)[0], "protected")
        with self.assertRaises(LookupError):
            dispatcher.classify("/x/dmit", self.config)

    def test_update_interval_only_for_additional_subscription(self):
        self.config.update({"panel_host_header": "fixture", "panel_port": 1111, "bwh_bridge_port": 2222})
        self.config["mappings"][0]["profile_update_hours"] = 1
        instance = overlay.Overlay(self.config)
        instance.forward = lambda *_args, **_kwargs: (200, [("Profile-Update-Interval", "24"),
                                                              ("profile-update-interval", "48")], b"fixture")
        instance.header = lambda _: "upload=2; download=3; total=20"
        def protected(handler, head):
            handler.send_payload(200, [("profile-update-interval", "6")], b"bwh", head)
        server = overlay.ThreadingHTTPServer(("127.0.0.1", 0), dispatcher.make_dispatch_handler(overlay, instance, protected))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def read(path, method="GET"):
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            try:
                conn.request(method, path)
                response = conn.getresponse()
                response.read()
                return response.status, [v for k, v in response.getheaders() if k.lower() == "profile-update-interval"]
            finally:
                conn.close()
        try:
            self.assertEqual(read("/x/dmit"), (200, ["1"]))
            self.assertEqual(read("/x/dmit", "HEAD"), (200, ["1"]))
            instance.forward = lambda *_args, **_kwargs: (200, [], b"fixture")
            self.assertEqual(read("/x/dmit"), (200, ["1"]))
            instance.forward = lambda *_args, **_kwargs: (200, [("Profile-Update-Interval", "24"),
                                                                  ("profile-update-interval", "48")], b"fixture")
            instance.header = lambda _: (_ for _ in ()).throw(ValueError("source unavailable"))
            self.assertEqual(read("/x/dmit"), (503, []))
            instance.header = lambda _: "upload=2; download=3; total=20"
            self.assertEqual(read("/x/bwh"), (200, ["6"]))
            self.assertEqual(read("/x/ordinary"), (200, ["24", "48"]))
            self.config["mappings"][0].pop("profile_update_hours")
            self.assertEqual(read("/x/dmit"), (200, ["24", "48"]))
            self.config["mappings"][0]["profile_update_hours"] = True
            self.assertEqual(read("/x/dmit")[0], 503)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_fail_closed_ambiguous_unknown_and_database_failure(self):
        for path in ("/x/%2564mit", "/x/%2fdmit", "/x/%2e%2e/dmit", "/x//dmit"):
            with self.assertRaises(ValueError):
                dispatcher.classify(path, self.config)
        with self.assertRaises(LookupError):
            dispatcher.classify("/x/unknown", self.config)
        self.db.execute("UPDATE subscribe_files SET file_short_code='dmit' WHERE id=3")
        self.db.commit()
        with self.assertRaises(ValueError):
            dispatcher.classify("/x/dmit", self.config)
        self.config["database"] += ".missing"
        with self.assertRaises(sqlite3.OperationalError):
            dispatcher.classify("/x/ordinary", self.config)


if __name__ == "__main__":
    unittest.main()
