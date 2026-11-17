"""Experimental finite short-link dispatcher; not a production nginx config."""

from pathlib import Path
import json
import sqlite3
import sys
from urllib.parse import quote, urlsplit

from bridge_core import Mapping, normalize_request_path
from overlay import HOP_HEADERS


def load_snapshot(config):
    """Classify only paths present in one read-only database snapshot."""
    protected = set(config["protected_subscription_ids"])
    entries = config["mappings"]
    if not protected or len(entries) != 1:
        raise ValueError("invalid configured identities")
    entry = entries[0]
    sid, eid = entry["subscription_id"], entry["external_id"]
    if any(type(value) is not int or value <= 0 for value in (sid, eid, *protected)):
        raise ValueError("invalid configured identities")
    if sid in protected or eid in set(config["protected_external_ids"]):
        raise ValueError("protected identity collision")
    path = Path(config["database"]).resolve()
    db = sqlite3.connect("file:" + quote(str(path), safe="/") + "?mode=ro", uri=True)
    try:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        rows = db.execute(
            "SELECT f.id,f.filename,f.file_short_code,f.custom_short_code,"
            "u.user_short_code,u.custom_user_short_code FROM subscribe_files f "
            "LEFT JOIN user_tokens u ON u.username=f.created_by"
        ).fetchall()
        external = db.execute("SELECT url,user_agent FROM external_subscriptions WHERE id=?", (eid,)).fetchone()
        if not external:
            raise ValueError("external identity missing")
        mapping = {}
        additional_paths = set()
        found_additional = False
        for row_id, filename, file_code, custom_code, owner_code, custom_owner in rows:
            if row_id == sid:
                if filename != entry["rpc_filename"]:
                    raise ValueError("subscription identity mismatch")
                found_additional = True
            codes = {c for c in (file_code, custom_code) if c}
            paths = {"/x/" + c for c in codes}
            paths.update("/x/" + c + owner for c in codes for owner in (owner_code, custom_owner) if owner)
            for candidate in paths:
                if normalize_request_path(candidate) != candidate:
                    raise ValueError("ambiguous configured short code")
                category = "additional" if row_id == sid else "protected" if row_id in protected else "ordinary"
                existing = mapping.get(candidate)
                if existing is not None and existing != (row_id, category):
                    raise ValueError("ambiguous short code")
                mapping[candidate] = (row_id, category)
                if row_id == sid:
                    additional_paths.add(candidate)
        if not found_additional or not additional_paths or not protected.issubset({r[0] for r in rows}):
            raise ValueError("configured subscription missing")
        item = Mapping(sid, eid, frozenset(additional_paths), entry["rpc_filename"])
        return mapping, (item, external[0], external[1] or "", entry["approved_host"])
    finally:
        db.close()


def classify(raw_target, config):
    path = normalize_request_path(urlsplit(raw_target).path)
    if not path.startswith("/x/"):
        raise ValueError("outside subscription namespace")
    paths, record = load_snapshot(config)
    selected = paths.get(path)
    if selected is None:
        raise LookupError("unknown subscription")
    return selected[1], record


def make_dispatch_handler(overlay_module, instance, protected_handler=None):
    """Use only as an isolated fixture until nginx routing is proven."""
    class Handler(overlay_module.make_handler(instance)):
        def handle_subscription(self, head):
            try:
                category, record = classify(self.path, instance.config)
                if category == "protected" and protected_handler is not None:
                    return protected_handler(self, head)
                headers = {key: value for key, value in self.headers.items()
                           if key.lower() not in HOP_HEADERS | {"host", "accept-encoding"}}
                headers.update({"Accept-Encoding": "identity", "Host": instance.config["panel_host_header"]})
                port = instance.config["bwh_bridge_port"] if category == "protected" else instance.config["panel_port"]
                status, response_headers, body = instance.forward(port, "GET", self.path, headers)
                if category == "additional":
                    if status != 200:
                        raise ValueError("panel unavailable")
                    value = instance.header(record)
                    allowed = {"content-type", "content-disposition", "profile-title", "profile-update-interval",
                               "profile-web-page-url", "support-url"}
                    response_headers = [(k, v) for k, v in response_headers if k.lower() in allowed]
                    hours = instance.config["mappings"][0].get("profile_update_hours")
                    if hours is not None:
                        if type(hours) is not int or not 1 <= hours <= 168:
                            raise ValueError("invalid profile update interval")
                        response_headers = [(k, v) for k, v in response_headers if k.lower() != "profile-update-interval"]
                        response_headers.append(("profile-update-interval", str(hours)))
                    response_headers.extend([("Subscription-Userinfo", value), ("Cache-Control", "no-store")])
                self.send_payload(status, response_headers, body, head)
            except LookupError:
                self.send_error(404, "unknown subscription")
            except Exception:
                self.send_error(503, "subscription classification unavailable")
    return Handler


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: dispatcher.py PRIVATE_CONFIG")
    import overlay
    with open(sys.argv[1], encoding="utf8") as source:
        config = json.load(source)
    load_snapshot(config)
    instance = overlay.Overlay(config)
    overlay.ThreadingHTTPServer(("127.0.0.1", int(config["listen_port"])),
                                make_dispatch_handler(overlay, instance)).serve_forever()


if __name__ == "__main__":
    main()
