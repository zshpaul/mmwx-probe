# Subscription header bridge

This directory currently contains only isolated selection, validation, RPC
transformation and per-source cache helpers. It is not a runnable bridge and
must not be deployed as a replacement for the existing service.

Mappings, approved upstream hosts, credentials and private RPC key paths must
remain outside this repository. The network integration must connect to a
validated public address without performing another DNS lookup, keep TLS
hostname verification enabled, reject redirects, and preserve existing BWH
behavior. HTTP and encrypted RPC integration, reverse-proxy routing, rollback
and deployment verification remain to be implemented and reviewed.

Run the isolated tests with:

```sh
python -m unittest discover -s integrations/mmwx-subscription-headers -p 'test_*.py' -v
```
