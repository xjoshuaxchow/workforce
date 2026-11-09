# Local full-file speech

User selected the auditioned VITS Cantonese voice and separately approved Piper English. Keep the existing full-file generation and immutable dispatch plans. Generate locally once per work/language/purpose, reuse shared endings across works, and play saved MP3 through Twilio with existing DTMF 1/2/9. Never fall back to Say or Azure.

## Chosen approach

Add `voiceClips.mode=local-mp3` and `localSpeech.speed` (default 1, range 0.7–1.3). A small, pinned Python environment runs sherpa-onnx CPU inference, OpenCC traditional-to-simplified conversion for Cantonese, and LAME MP3 encoding. Existing Azure, uploaded clips, and historical Say settings remain readable. Old clients preserve omitted local settings.

Reuse `voice_syntheses` and `/requests/:id/voice-synthesis`, including access checks, draft-only generation, reservation, stale-hash rejection, immutable audio, and dispatch snapshot. Hashes include provider, model/normalization version, speed, scope, language and actual script; they exclude machine paths. Azure hashes must remain unchanged. Local mode supports only `en` and `yue`; other languages block generation/dispatch with an actionable message.

The Python boundary receives bounded JSON over stdin and writes one bounded MP3 to an isolated temporary directory. No shell invocation, network access, or user-supplied executable/model paths. Limit local jobs to one concurrent CPU synthesis, reject excess work with a retryable failure, kill overdue children and wait for exit before cleanup. Local failures carry no paid-service warning. Python validates input, converts Cantonese script, normalizes spoken numbers and time-zone text, checks lexicon coverage, and rejects unsupported characters rather than silently dropping them.

User correction after trying a real draft: local speech uses Site-local dates/times but omits spoken GMT/UTC offsets. Hong Kong address notation `28/F` becomes 二十八樓 and `G/F` becomes 地下; other slashes are spoken rather than rejected. Unsupported-character errors use a bounded structured diagnostic; Node exposes only validated single characters present in the original script, never raw stderr. Normalization-v3 invalidates affected local cache keys; legacy Azure/Say output and previously pinned audio remain unchanged.

## Interfaces and ownership

- `createLocalSpeechClient().status()` returns `{installed,languages}`; `.synthesize(descriptor)` returns an MP3 Buffer. The adapter owns process lifecycle and bounds.
- `localSynthesisDescriptors(localSpeech,language,site,request,voiceTexts)` owns deterministic hashes and voice selection.
- `scripts/local-tts.py` owns normalization, inference and MP3 encoding. `scripts/install-local-tts.py` installs pinned packages and verified model files under `.local/onnx-tts`; no global dependencies.
- Settings expose install status and speed. Shared generated-audio UI shows local generation and retry copy without Azure Key/billing requirements.

## Alternatives

CosyVoice was rejected by the user because its minimum model files exceed 5 GB. eSpeak was auditioned but its mechanical sound prompted the VITS choice. Browser-only speech cannot provide the reusable audio file required by Twilio. A separate always-running Python server would add another service to maintain; on-demand local processes fit the existing explicit generation flow and measured six-second inference time.

## Validation

Unit tests cover provider-separated hashes, changed speed/script invalidation, process failures and input bounds. Integration tests cover cache reuse, shared prompts, no Azure calls, stale content, unsupported language, local failures/retry and pinned `<Play>` with DTMF. Browser tests cover selecting local mode, saving speed, generation and preview. Finally exercise both real models and inspect actual MP3 playback before switching the saved development configuration. No real phone call is included.

## Scope and provenance

Use the auditioned model checksum `7d8d4f5550b607999417a99131b034c8cc2b8dca69f9e9fdefeff6655643c139`. Store model-source metadata and upstream notices alongside installation. The Cantonese upstream does not publish a model card/license in its converted repository; this integration does not assert a commercial license grant. Do not remove legacy business languages or unrelated voice tooling. Work in place without commits per existing user preference.
