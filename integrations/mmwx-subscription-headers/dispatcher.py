"""Experimental finite short-link dispatcher; not a production nginx config."""

from pathlib import Path
import sqlite3
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


def make_dispatch_handler(overlay_module, instance):
    """Use only as an isolated fixture until nginx routing is proven."""
    class Handler(overlay_module.make_handler(instance)):
        def handle_subscription(self, head):
            try:
                category, record = classify(self.path, instance.config)
                headers = {"User-Agent": self.headers.get("User-Agent", ""),
                           "Accept-Encoding": "identity", "Host": instance.config["panel_host_header"]}
                port = instance.config["bwh_bridge_port"] if category == "protected" else instance.config["panel_port"]
                status, response_headers, body = instance.forward(port, "GET", self.path, headers)
                if category == "additional":
                    if status != 200:
                        raise ValueError("panel unavailable")
                    value = instance.header(record)
                    allowed = {"content-type", "content-disposition", "profile-title", "profile-update-interval",
                               "profile-web-page-url", "support-url"}
                    response_headers = [(k, v) for k, v in response_headers if k.lower() in allowed]
                    response_headers.extend([("Subscription-Userinfo", value), ("Cache-Control", "no-store")])
                self.send_payload(status, response_headers, body, head)
            except LookupError:
                self.send_error(404, "unknown subscription")
            except Exception:
                self.send_error(503, "subscription classification unavailable")
    return Handler
