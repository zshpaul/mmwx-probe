# Subscription header bridge

This directory contains an experimental loopback overlay and isolated tests.
It has not been integrated with production routing, reviewed, or deployed.
It must not be deployed as a replacement for the existing service.

Mappings, approved upstream hosts, credentials and private RPC key paths must
remain outside this repository. The network integration must connect to a
validated public address without performing another DNS lookup, keep TLS
hostname verification enabled, reject redirects, and preserve existing BWH
behavior. The overlay forwards encrypted RPC to the existing BWH bridge first,
then updates only its configured additional subscription. Reverse-proxy
routing, independent end-to-end verification, rollback and deployment
procedures remain to be implemented and reviewed.

The private JSON configuration contains `database`, `rpc_key_file`,
`panel_host_header`, `listen_port`, `panel_port`, `bwh_bridge_port`,
`protected_subscription_ids`, `protected_external_ids`, and `mappings`.
Each mapping contains numeric `subscription_id`, numeric `external_id`,
`rpc_filename`, and `approved_host`. Both protected identity lists are
required and nonempty; a mapping that overlaps either list is rejected.
Configure the listener on an unused local port. `panel_port` and
`bwh_bridge_port` refer only to loopback services; the overlay always binds to
`127.0.0.1`. Keep the configuration and existing RPC key private.

For a production rollout, first verify the real profile-to-subscription
identity and nginx routes without logging path codes, then back up the current
service and nginx configuration. Route only the additional subscription
paths and the shared encrypted RPC through this overlay. Confirm the existing
BWH service remains the RPC upstream, test nginx configuration before a
reload, and preserve a tested rollback to the prior routes. No rollout or
configuration changes are performed by this repository.

An unavailable additional upstream causes its quota fields in a decoded RPC
response to become unknown while preserving other entries. If the encrypted
RPC cannot be verified or its configuration cannot be loaded, the overlay
returns an error instead of relaying a potentially misleading aggregate.
This can affect the shared subscription list and must be considered during
review and any rollout.

Run the isolated tests with:

```sh
python -m unittest discover -s integrations/mmwx-subscription-headers -p 'test_*.py' -v
```
