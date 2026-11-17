# Experimental subscription header bridge

This is an isolated review prototype. It is not deployed or configured by this
repository. `legacy_wrapper.py` retains the existing BWH handler and its RPC
transport, and extends a successfully transformed response for the selected
additional subscription. GET/HEAD returns the panel's subscription body with
usage from that subscription's independent upstream header. Production
hostnames, subscription paths, keys and configuration are intentionally excluded.

The private configuration identifies an additional subscription by both
subscription ID and filename, its separate external record and an explicitly
approved HTTPS upstream hostname. Protected BWH IDs must be configured.
Each upstream has an independent short cache; the upstream fields are parsed
and validated, not scaled or replaced with fixed allowances.

| Case | Experimental behavior | Important limit |
| --- | --- | --- |
| GET/HEAD for an identified additional subscription | Preserve panel body and return independent upstream usage header; decode one safe encoding layer for matching | Production nginx routing, rotation and behavior when the overlay is unreachable have not been verified. |
| Successful RPC decryption and independent upstream fetch | Keep the legacy bridge response's BWH values; update only the exact additional ID and filename with upload + download and total | The encrypted response is re-encoded; BWH field values are preserved, not ciphertext bytes. |
| Additional upstream fails after RPC is decoded | Set that entry's usage and total to null; preserve its expiry and BWH fields | Real installed MeowX null handling has not been validated in an isolated end-to-end test. |
| Global key, configuration, decryption or parsing failure | Return the original legacy bridge response unchanged | It can contain an incorrect aggregate for DMIT. This deliberately retains legacy fallback semantics and does not guarantee correct DMIT usage. |
| Overlay or its route unavailable | Not established | Depending on routing, callers may receive an error or an unmodified aggregate. No production route is provided here. |

The prototype is not an accepted deployment plan. Before considering deployment,
verify the actual legacy interface, per-record identity and live DNS/route
behavior without disclosing secrets; review GET and RPC routing and failure
isolation; test the installed client's handling and refresh behavior; prepare
backup and rollback; and obtain review of the exact change. Do not enable
DMIT quota upload based solely on this prototype.

The opt-in `test_nginx_fixture` runs nginx together with this actual overlay and
synthetic upstreams. It demonstrates that an exact location routes an encoded
known path by its normalized value while the overlay receives the original
request target. With an exact-only route, a rotated or double-encoded path can
instead fall through to the panel and expose its aggregate header. The fixture
asserts this negative result to prevent mistaking it for a safe route.

`dispatcher.py` is an experimental alternative that reads subscription identity
and short codes in a single read-only database transaction, classifies matching
paths as additional, protected or ordinary, and fails unknown paths and database
errors closed. Reassignment is reclassified on the next request rather than
permanently exempting old protected codes. If the mapping cannot be read, even
ordinary `/x/` subscriptions fail until it is readable again.

The dispatcher and legacy wrapper have loopback entry points using an external
private configuration. The included nginx files are examples, not installed
production configuration.
An opt-in fixture uses nginx's raw request URI to reject selected ambiguous
encoding and dot-segment forms before selecting `/x/`, and tests synthetic
identities 4/9 and 5/10, rotation, reassignment, collisions, a 307 response
and an unavailable database. The fixture rejects encoded subscription paths,
including singly encoded forms, rather than assuming future short-code formats.
When `LEGACY_FIXTURE_PATH` names an existing legacy script, the nginx fixture
uses that script's extracted BWH handler with synthetic settings and synthetic
upstream responses; the legacy production service is not contacted.
It exercises only the included cases: it does not establish coverage of every
possible raw URI or prove that the inferred path construction exactly matches
the production panel. A double-encoded separator and dot segment before `/x/`
is an explicit fixture counterexample that still reaches the catch-all; the
production panel's handling of a corresponding valid subscription is unknown.
Non-subscription paths and RPC need separate routing.
Neither this code nor its failure strategy is ready for production without
the combined routing tests and review described above.

## Narrow deployment and rollback plan

The example nginx `map` belongs in `http {}`; the example locations belong
only in the intended panel's TLS `server {}`. Preserve existing BWH exact
short-link locations pointing at the same legacy listener and preserve its
exact secure-RPC location and named upstream, including their existing fallback.
The wrapper handles those BWH exact paths via the original handler after
reclassifying current short codes. Other methods under `/x/` are passed back to
the panel for the prefix location. Existing exact BWH locations still use the
legacy handler for other methods, preserving their original behavior, even
after a short code is reassigned. First check the current nginx configuration,
existing location precedence and all referenced ports.

Create private JSON outside Git with restricted permissions. Set the database and
RPC-key paths from the existing deployment, the verified file identity and the
approved DMIT upstream hostname. Never put subscription URLs, secret keys,
tokens or private short codes in Git, logs, PRs or shell output. The original
BWH upstream and credentials remain with the legacy script. The additional
source must be HTTPS, pinned to an approved public address and host, and
redirects are not followed.

Before changing anything, save access-restricted copies and hashes of the
legacy script, its unit and drop-ins, the panel's nginx configuration and
included files, and any private config. Make a consistent SQLite backup using
its backup API with a read-only source. Record running service versions and
configuration paths. Retain these recovery files outside the repository.

After review and CI, install the reviewed modules and private JSON, adapt the
example systemd override and nginx includes, and validate the complete
candidate nginx configuration with `nginx -t` before applying it. Restart only
the BWH bridge, reload nginx, and verify original BWH GET and RPC, ordinary
subscriptions and DMIT with a targeted refresh. Keep probe quota upload
disabled until its separate source contract is verified.

On failure, restore the backed-up unit/drop-in and nginx files, verify hashes
and `nginx -t`, then reload nginx and restart the bridge with its original
unit. Confirm original BWH and ordinary subscription behavior. The database
backup is recovery material: do not overwrite live changes during a routine
code rollback.

Run the synthetic, loopback-only tests with Python and `cryptography` installed:

```text
python -m unittest -v test_bridge_core test_overlay
```

An optional `test_legacy_fixture` reads the source snapshot named by
`LEGACY_FIXTURE_PATH` without copying it into the repository. It loads only
imports, functions and classes, substitutes synthetic identity, keys and
network inputs, and exercises the legacy BWH GET/HEAD handler and the legacy
RPC transform followed by the overlay transform. It does not exercise a full
HTTP chain or prove that the supplied snapshot matches a running deployment.
