"""Add exact subscription GET/HEAD handling without changing legacy RPC."""

import importlib.util
import json
import sys
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

from overlay import Overlay, load_records, make_handler


def make_combined_handler(legacy, config):
    instance = Overlay(config)
    records = load_records(config)
    extra_paths = {path for record in records for path in record[0].paths}
    protected_paths, _ = legacy.settings()
    if extra_paths.intersection(protected_paths):
        raise ValueError("additional path overlaps protected legacy subscription")
    additional_handler = make_handler(instance)

    class CombinedHandler(legacy.Handler):
        send_payload = additional_handler.send_payload

        def respond(self, head):
            if urlsplit(self.path).path in extra_paths:
                return additional_handler.handle_subscription(self, head)
            return super().respond(head)

    return CombinedHandler


def handler_or_legacy(legacy, config_path):
    try:
        with open(config_path, encoding="utf8") as source:
            config = json.load(source)
        return make_combined_handler(legacy, config)
    except Exception:
        # Keep the existing BWH behavior available if the addition is invalid.
        print("Additional subscription disabled; existing bridge retained", file=sys.stderr)
        return legacy.Handler


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: legacy_wrapper.py ORIGINAL_SCRIPT PRIVATE_CONFIG LISTEN_PORT")
    spec = importlib.util.spec_from_file_location("mmwx_existing_bridge", sys.argv[1])
    if spec is None or spec.loader is None:
        raise SystemExit("existing bridge unavailable")
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[3])), handler_or_legacy(legacy, sys.argv[2])).serve_forever()


if __name__ == "__main__":
    main()
