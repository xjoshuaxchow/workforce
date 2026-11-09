# Workforce Monorepo Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-change review.

**Goal:** Import the three approved projects into the user-specified workforce repository without private runtime data.

**Architecture:** Separate ams/, api/ and whatsapp-microservice/ packages, existing lockfiles, root command entry points and explicit deployment handoff.

**Tech Stack:** Git, Node 26, React/Vite, PostgreSQL, TypeScript, Docker Compose.

**Spec:** docs/monorepo-design.md

## Constraints and review focus

- Originals and live services stay untouched; no credentials, private encryption key, models, production media or nested Git are published.
- Remote was checked empty. Recheck before the first push; do not force push.
- Preserve all 47 upstream microservice files and record its commit. Keep independent locks and runtime ownership.
- Relative test/spec paths resolve to sibling api/ and ams/. Database/browser tests run sequentially on the established isolated test database.
- This is repository integration, not production deployment or a real message/call test.

## Tasks

- [x] Import Git-visible sources into a fresh repository; capture a private SHA256 manifest.
- [x] Add root documentation/commands/audit, update relative paths and local instructions.
- [x] Run source/secret exclusion audits, build and existing unit/integration/browser verification.
- [x] Independent review, fix material findings, commit and publish the initial main branch.

## Ledger

- User explicitly approved one Git and supplied its SSH remote. This authorizes initial commit/push to that repository; no production publishing or real sends are authorized.
- Local work is on codex/monorepo in the new import repository; initial remote main is created only after verification. Original repositories are not staged, committed, moved or modified.
- Full server Compose/HTTPS remains a separate configuration step because no target server details were provided.

- Review fix: root Compose entry points use the dedicated workforce-whatsapp project, protecting the original stack. Two fake-Docker regression cases failed before the fix, then passed. Root docs explain the 8080 port and separate volume migration, root-only workflow discovery and fresh-clone API setup.

- Final checks: root 2 + AMS 7 + API 58 + WhatsApp 33 unit cases passed; builds passed; API integration 158 passed, 1 opt-in real-engine skip; browser 26 passed. Staged 218-file repository and exact-secret scans passed. All 47 upstream files unchanged. Temporary test-only environment removed after validation.

- Published initial import 5f78df5 to origin/main. The local checkout is handed over on main tracking origin/main. Original directories and their live processes remain in use; private settings, encryption key and local speech runtime must be migrated and verified before deleting them.
