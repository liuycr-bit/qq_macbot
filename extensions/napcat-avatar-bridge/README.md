# NapCat QQ Avatar Bridge

This local plugin exposes NapCat's authenticated `NodeIKernelAvatarService` to QQ Agent Mac. It is intentionally limited to loopback requests and requires a generated bearer token.

Install it with `npm run setup:avatar-bridge`. The installer copies the plugin and its token-bearing configuration to NapCat's application-data directory, enables the plugin, and adds its plugin ID to the local NapCat 4.18.x plugin allowlist. It does not write into `QQ.app`.
