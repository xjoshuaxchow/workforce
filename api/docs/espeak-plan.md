# eSpeak NG English and Cantonese

User selected a local eSpeak NG trial and integration. Only en/yue in this mode; desktop browser remains the interface. No cloud accounts, keys, paid synthesis or real calls. Keep existing generated assets and historical snapshots.

Architecture: extend synthesis descriptors and the existing durable generation service with an explicit local provider. Pinned provider/version/voice/rate/script form cache identity. Child process receives plain UTF-8 via stdin, fixed voice args, no shell, bounded time/output. Output is a complete PCM WAV, accepted by existing asset and Twilio Play paths. A local installer and sample/benchmark script make installation and actual output repeatable.

Scope: install eSpeak1.52.0 under .local; generate en/yue samples and measure time/size; add local mode and English/Cantonese controls to AMS; preserve per-work full-file cache, shared prompts, DTMF and preflight; no Azure fallback. Local failures can retry without a billing warning. English/Cantonese TTS only for the new mode, no removal of other staff/business languages.

Tasks:
- [ ] Install and generate real sample WAVs; record runtime size and synthesis time.
- [ ] RED/GREEN provider and descriptor tests; wire cache/settings/runtime with en/yue guards.
- [ ] RED/GREEN browser flow for local generation without credentials, full WAV preview and unsupported-language blocking.
- [ ] Full unit/integration/E2E/build, independent review, update docs, safe local restart and switch active content mode to local after successful checks.

Ledger:
Ruling: WAV is the output format. Existing playback already supports it; avoids an unnecessary MP3 encoder and its dependencies.

Audition complete: eSpeak1.52.0 installed locally, runtime19,410,724 bytes. English12.14s waveform generated in74ms, Cantonese15.38s in57ms on this Mac. Samples at /private/tmp/workforce-espeak/samples.
User rejected the sound quality before AMS integration. Unfinished production integration and its tests were restored from this task's baseline; standalone install/sample utility retained. Active configuration was never switched to eSpeak. CosyVoice3 is only being evaluated; user explicitly requires confirming its size before any model download or installation.
