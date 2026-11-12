Production recovery artifact for main fb926e325ec7ccb6dbb17ede461f8c0e71e95504 (4.1.9).

Built locally using npm run build; source main CI passed. Archive and every file digest are in artifact.json. No credentials or node_modules included. One-time runner derives from that exact source deployment script, replacing the memory-intensive build with production-only dependency install and pinned, SHA-256-verified artifacts. Existing staging health checks, atomic switch, rollback and environment handling remain. Does not enable timers or install persistent controller changes.
