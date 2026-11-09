# Standalone Workforce Docker deployment

User confirmed Ubuntu x86_64, Docker 28 / Compose 2.33, existing nginx on80/443, phpMyAdmin8080 and an unrelated WhatsApp8085. Run Workforce independently first; public DNS/HTTPS can follow. Use a new root Compose project and private volumes. Existing projects, ports and local Mac services stay untouched.

Base stack: built AMS served by nginx, Workforce API/background loop, PostgreSQL and one-shot schema/admin initialization. Only host binding is configurable loopback 127.0.0.1:8320. Optional whatsapp profile adds dedicated init/database/migration/API/worker; no host port or existing volumes reused. Its public webhook is proxied through the new web gateway when enabled. Default Workforce channels remain mock until operator configures and explicitly enables them in AMS.

PostgreSQL and voice bytes persist in the database; settings encryption key is generated into ignored private root .env. Speech models install on target Linux via an optional one-shot installer volume, not copied from Mac. Seed admin credentials only enter the one-shot init container; existing seeded accounts allow blank credentials on subsequent starts. Login always uses stored scrypt hashes. Root setup is idempotent, creates private secrets and never overwrites existing .env.

Use configured resource caps appropriate for the shared 4GiB host. Validate Compose with optional services absent, image builds for linux/amd64, base HTTP/login/persistence and webhook routing using disposable local fixtures. No real messages, server changes, public exposure, DNS changes, data restoration or deletion. Domain/HTTPS and any old database restoration remain separate operator steps.
