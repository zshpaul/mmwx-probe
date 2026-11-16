# Experimental subscription header bridge

This is an isolated review prototype. It is not deployed or configured by this
repository. It forwards RPC requests to the existing BWH bridge first and can
replace the selected additional subscription's usage after decrypting its
response. GET/HEAD returns the panel's subscription body with usage from the
additional subscription's independent upstream header. Production identities,
hostnames, paths, keys and configuration are intentionally excluded.

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

This dispatcher is not wired into a production entry point or a proven nginx
configuration. In particular, nginx selects locations after URI normalization:
an encoded namespace prefix or dot segment may bypass a simple `/x/` location.
The current nginx fixture is a negative example, not a validation of the
dispatcher. Neither this code nor its failure strategy is approved for
production without the combined routing tests and review described above.

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
