# Website and game-world deployment boundaries

The website and RuneScape world are separate services with different scaling and storage requirements.

| Service | Transport | Persistent state | Scaling model |
| --- | --- | --- | --- |
| Website | HTTP on container port 3000, exposed through Service/HTTPS Ingress | Shared PostgreSQL announcements and admin sessions | Multiple stateless web pods |
| Game world | RuneScape TCP on port 43594 | Authoritative in-memory world plus account saves | One authoritative process per world |
| Game cache/JS5 | Existing HTTP service on port 43595 and game-protocol requests | Locally supplied cache/assets and keys | Separate endpoint; cache files can be read-only |
| Database | PostgreSQL protocol | Database-managed persistent storage and backups | Managed independently of website replicas |

## Website replicas

All website replicas must use the same PostgreSQL database and administrator configuration. Opaque sessions and CSRF state are database-backed; a request can reach a different pod after login. The readiness endpoint runs `SELECT 1`, while liveness remains independent of database availability. Startup schema creation is coordinated by the application.

The website uses SQLite for convenient single-process local development. Do not increase replica count while leaving `DATABASE_URL` on its SQLite default: separate pod files would diverge, and sharing one SQLite file over a network volume is not the supported production arrangement. The provided Deployment requires a PostgreSQL URL from a Secret and uses no website database PVC.

An HTTPS Ingress routes browser traffic to the website's ClusterIP Service. The example is controller-specific and needs a real DNS name and TLS Secret. Game status and downloads are environment-configured integrations; the website never imports a sibling game checkout at runtime or assumes the world is online.

## Game worlds

A RuneScape world's client TCP stream is not HTTP and cannot pass through an ordinary HTTP Ingress route. A future game deployment needs a TCP-aware load balancer or Service for port 43594, plus separately configured cache/JS5 access. A generic website reverse proxy does not convert the original Java client into a browser/WebSocket client.

The current game server uses local account files and an in-memory authoritative world. Multiple replicas pointing at the same save directory would race and would not share world state. Keep one process per world; scaling the website does not scale that process. A future Kubernetes world deployment should prevent overlapping authoritative processes during replacement, preserve its saves, and handle player disconnect/reconnect explicitly.

The game repository's `local/` includes account/runtime data, RSA material, cache files and other uncommitted assets. A world container would need carefully separated persistent writable saves, restricted key material and read-only cache/assets supplied outside the image. They must not be copied from the developer's machine into a published build context. This website image and its `.dockerignore` exclude all of those files.

## Deployment ownership

The manifests supplied here cover the website only. Database provisioning, backups, TLS, DNS, ingress-controller installation and any future game-world deployment are infrastructure operations performed separately. No cluster apply, Docker-engine startup or game-server restart is part of local website checks.
