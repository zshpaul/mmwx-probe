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
| GET/HEAD for an identified additional subscription | Preserve panel body and return independent upstream usage header | Production nginx routing, normalization, rotation and behavior when the overlay is unreachable have not been verified. |
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
