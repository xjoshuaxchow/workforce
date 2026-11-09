# Workforce Docker Deployment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with one fresh whole-change review.

**Goal:** Provide a usable isolated Ubuntu Docker stack and clear server commands.
**Architecture:** Root Compose, separate service/volume namespace, loopback gateway, optional WhatsApp and speech profiles, existing API business logic.
**Tech Stack:** Node26, nginx, PostgreSQL17, Python3, Docker Compose2.33+.
**Spec:** docs/superpowers/specs/2026-11-09-docker-deployment.md

## Constraints / review focus
- Existing server ports/containers untouched; seed secrets absent from API environment; root env is ignored and non-overwriting.
- Models install on Linux; optional WhatsApp DNS must not prevent base gateway startup; proxy preserves webhook bytes/query.
- Existing accounts and encrypted settings survive restart. Fresh database requires deliberate initial seed. No live channels enabled by deployment.
- No production database restoration or migration from the Mac this step; original directories retained.

## Tasks
- [x] Red→green setup and Compose boundary checks; add containers/gateway/private setup and deployment guide.
- [x] Red→green seed rerun integration coverage; preserve database-owned login with removable initial seed inputs.
- [x] Build linux/amd64 images and verify disposable stack HTTP/login/restart and optional webhook; existing regression suites sequentially.
- [x] Fresh review, material fixes and source/secret audit; ready for publication to the user-authorized repository main.

## Verification ledger
- Private setup failed before implementation, then passed; rerun preserves bytes/mode0600 and never prints secrets.
- Seed removal failed before implementation, then passed. Full API integration passed159, one opt-in real-model case skipped. Root/AMS/API/WhatsApp unit checks passed101.
- Built real linux/amd64 API/web/WhatsApp images; base and optional WhatsApp API/Worker/database became healthy in the disposable workforce-verify stack. Dedicated service key worked with an empty database.
- Chromium on HTTP loopback logged in with production Secure cookies, authenticated /api/auth/me returned200, including after clearing both seed values and recreating containers.
- Review found missing /integrations routing: observed405 HTML before fix, then401 JSON from API after fix. WhatsApp GET challenge passed through gateway unchanged.
- First integration invocation from repository root found the wrong child src path; reran from API working directory and all passed.
- Speech installer is packaged and documented; full Linux model download/acoustic testing, resource usage under speech load, public HTTPS/DNS, server execution and old data restoration remain outside this first-start step.
