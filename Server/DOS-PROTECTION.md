# Local DoS protection

These are per-process safeguards, not volumetric DDoS protection.

- HTTP: 600 requests/minute/IP, before body parsing, in addition to existing route limits.
- Limiter state: at most 10,000 keys per limiter; new keys get 503 when full.
- Headers timeout: 15 seconds; request receipt: 120 seconds; keep-alive: 5 seconds; 100 requests/socket.
- Compressed JSON/form bodies are rejected; JSON remains 30 MiB for legacy media messages. Forms: 64 KiB, 100 parameters, no nested parsing.
- ZIP and URL music imports return 503, intentionally disabled until moved into isolated workers with CPU, memory, disk, egress and concurrency quotas. No downloader timeout implementation is claimed.
- WebSocket: default packet limit 12 MiB; settings offers 512 KiB; 600 events/minute/user, shared across connections; disconnect on excess. 8 connections/user, 20/transport IP, 30 namespace connection attempts/minute/transport IP.
- WS attempt/event state is bounded and periodically cleaned up.

## Deployment requirements

`TRUST_PROXY` is a comma-separated list of trusted proxy IPs/CIDRs (Express syntax). Default is false. Configure the actual infrastructure addresses; do not trust all addresses. Firewall the origin so clients cannot bypass the proxy. Proxies must overwrite untrusted forwarding headers.

WebSocket limits deliberately use the transport peer, NOT forwarded headers. Behind a shared reverse proxy all its users share the 20 connection/30 attempt limits: this must be addressed with a verified proxy-aware Engine.IO admission policy before large-scale deployment. Namespace limits do not protect the initial Engine.IO handshake.

Place the service behind a DDoS-capable CDN/provider, enable WAF/rate limits including `/socket.io`, and enforce connection, upload bandwidth and request body limits at the edge. Use managed challenges selectively, not for all API or WebSocket requests. Limit origin ingress to the proxy/CDN. For multiple instances use a shared limiter store; current counters reset on restart.

Tune HTTP_* timeout variables and WS_MAX_BUFFER_BYTES conservatively. These values are numeric milliseconds/bytes, respectively. Reduced packet/settings sizes can reject existing large inline media/themes; migrate those to HTTP uploads with file references.

Remaining risks include 30 MiB JSON allocation, synchronous JSON database writes, unauthenticated Engine.IO handshakes, missing global workload concurrency and disk quotas. Load-test in a staging environment, monitor 429/503 rates, CPU, memory, disk and event-loop delay. Do not run attack traffic against production.