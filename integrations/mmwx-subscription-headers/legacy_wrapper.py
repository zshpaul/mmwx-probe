"""Extend an existing BWH handler without replacing its RPC transport."""
import base64
import importlib.util
import json
from pathlib import Path
import sys

import dispatcher
import overlay


def make_handler(legacy, config):
    instance = overlay.Overlay(config)
    original_transform = legacy.transform_rpc

    def extended_transform(request, response):
        # Preserve the existing handler's failure and BWH behavior.
        legacy_response = original_transform(request, response)
        try:
            key = base64.b64decode(Path(config["rpc_key_file"]).read_bytes(), validate=True)
            return overlay.transform_rpc(request, legacy_response, key,
                                         overlay.load_records(config), instance.header)
        except Exception:
            # Preserve the legacy result on global additional-transform failure.
            return legacy_response

    legacy.transform_rpc = extended_transform
    dispatch = dispatcher.make_dispatch_handler(
        overlay, instance, protected_handler=lambda handler, head: legacy.Handler.respond(handler, head))

    class Handler(legacy.Handler):
        send_payload = dispatch.send_payload

        def respond(self, head):
            return dispatch.handle_subscription(self, head)

    return Handler


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: legacy_wrapper.py LEGACY_SCRIPT PRIVATE_CONFIG")
    spec = importlib.util.spec_from_file_location("legacy_subscription_bridge", sys.argv[1])
    if spec is None or spec.loader is None:
        raise SystemExit("legacy bridge unavailable")
    legacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    with open(sys.argv[2], encoding="utf8") as source:
        config = json.load(source)
    handler = make_handler(legacy, config)
    overlay.ThreadingHTTPServer(("127.0.0.1", int(config["listen_port"])), handler).serve_forever()


if __name__ == "__main__":
    main()
