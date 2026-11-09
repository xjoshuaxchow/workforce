# Mixed Cantonese/English speech and independent audition

User approved: route English phrases within Cantonese speech through Piper, keep VITS for Cantonese, encode one complete reusable MP3; add Site English spoken name/address; allow English/Cantonese audition without changing employee language. Different voices at language transitions are accepted in the approved proposal. No cloud model or additional download is required.

## Shape

- Private Python worker identifies Latin-word phrases before Cantonese number normalization, keeping `tech nine` together. HK floor notation is converted first, so `28/F` remains 二十八樓. Each required engine loads once, PCM is normalized to 22050Hz with short fades/pauses at transitions, and LAME encodes the complete file once. Bound total duration and retain the existing process timeout/output validation. Bump local normalization fingerprint so draft caches do not reuse spelled-letter output; published plans remain immutable.
- SQL013 adds optional `voice_name_en` and `voice_address_en` to Sites. Existing name/address remain unchanged; omitted fields preserve saved values on PATCH. English local scripts use these aliases, falling back to already-English original fields. Chinese data without an English alias yields an actionable preview/generation issue. Arbitrary Chinese supplemental text still requires English wording; no automatic translation is promised.
- Draft local-voice GET preview accepts `?language=en|yue`, returns the requested audition language alongside real required languages, and marks preview-only plans. Default response/dispatch readiness still follow eligible employees. `previewOnly:true` explicitly permits local generation for the selected audition language without an employee-language change; it does not queue attempts. All existing Site permissions, draft/hash checks and scoped cache rules apply. Azure mode retains its existing generation eligibility.
- AMS Site form exposes the two English spoken fields. Draft voice panel offers 按員工語言 / 粵語試聽 / 英語試聽; selected audition is clearly separate from actual call language. Non-audition required-language readiness remains visible. Per-card fixed text editing and locked dynamic values continue to work.

## Ownership

Worker owns language segmentation/PCM; descriptors own English alias resolution, issues and cache identity; preview route owns requested vs required language sets; synthesis route owns explicit preview authorization. Dispatch always computes languages from real employees and ignores the UI audition selector.

## Alternatives

Letter spelling is the current defect. Phonetic Cantonese aliases would force users to approximate every English name; changing the whole call to English would not satisfy Cantonese staff. A large multilingual model was rejected earlier for size. Combining the two already installed engines preserves the small deployment and reusable whole-file contract.

## Validation and limits

Test phrase grouping, HK floors/acronyms, unsupported characters and one-file output; real `地點係tech nine` audition; Site field persistence and legacy compatibility; forced English preview with only Cantonese candidates; explicit preview generation without changing staff; English alias changes invalidate only English content; missing English data blocks affected generation; dispatch/pinned files stay based on real employee languages. DB/E2E run sequentially. No real calls, publish, cloud synthesis, commits or worktrees.
