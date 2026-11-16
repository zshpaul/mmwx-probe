# Subscription header bridge

This experimental single-process wrapper adds exact-match GET/HEAD handling
for separately configured subscriptions. It imports the existing BWH bridge
and delegates all other paths and all POST/RPC handling to its unchanged
handler. The original bridge's configuration, upstream scheme, credentials
and 30-second cache remain its own. The additional source has an independent
cache and must use a configured HTTPS hostname and public resolved address.

The wrapper has not been deployed or verified against the installed client.
Its configuration, approved hostnames, identifiers and path codes are
private and must not be committed. The private JSON configuration contains
`database`, `panel_host_header`, `panel_port`, `protected_subscription_ids`,
`protected_external_ids`, and `mappings`. Each mapping contains integer
`subscription_id`, integer `external_id`, and `approved_host`. Both protected
identity lists are required and nonempty. A mapping that overlaps either
list, or a path overlapping a legacy BWH path, is rejected.

The wrapper uses the existing handler unchanged when the additional
configuration is invalid at startup. During operation, an added-subscription
error affects only that subscription's GET/HEAD response; BWH and RPC continue
through the legacy handler. The shared RPC response itself is deliberately
unchanged and must not be treated as evidence that the added subscription's
aggregate quota is correct. Enable client quota upload only after a successful,
verified refresh of the specific added subscription's header.

Run the isolated tests with:

```sh
python -m unittest discover -s integrations/mmwx-subscription-headers -p 'test_*.py' -v
```

Before any production rollout, verify the exact subscription route and backup
the current script, service configuration and relevant nginx configuration.
Test in an isolated process, validate nginx before reload, retain a tested
rollback, and compare BWH and added subscription behavior. Do not enable
quota reporting from an existing aggregate cache.
