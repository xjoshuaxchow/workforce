# Workforce implementation ledger

## 2026-11-06 本機 VITS 粵語與 Piper 英語

- 用戶聽過 VITS Cantonese 試聽後選用，另確認英文一併用本機 Piper；取代目前 Azure 模式，不使用 Say 後備。
- 已加入版本化 `local-mp3` 與語速、私有離線引擎、MP3 編碼、繁簡及數字／時區轉換、字元預檢；保留既有生成快取、共用提示、Site／草稿權限及發佈快照。
- 模型與套件在 `.local/onnx-tts`，固定 sherpa 1.12.35 以保留 Piper 前端；完整安裝約306 MB。安裝器核對模型及字典身分，可重跑而不重複下載。
- AMS 可切換本機模式、調整語速、編輯固定講稿、按語言生成及試聽。普通話在此模式明確阻擋，保留其原業務支援。
- API unit55、integration152；AMS unit7、build、browser25 均通過。真實兩語經 API 各生成六用途 MP3，保存／取回／重用及 fake Twilio Play smoke通過。Python normalization6及installer1通過。
- Fresh review指出的前導零及不支援符號漏過檢查已補回歸測試並修正；覆核無重要未解問題。已切換開發環境 active設定 `local-mp3`、正常語速1，憑證、講稿及舊版本保持。
- 沒有真實通話、雲端合成、提交或推送。模型商用權重條款未明，文件不作授權聲明。

## 2026-11-06 Azure 生成完整 MP3

使用者選擇 Azure Speech Neural，每工作／語言／用途生成完整 MP3 後供所有電話重用，不拼接日期片段。支援英文、粵語、普通話。通用稱呼，固定講稿可編輯，補充說明併入整份語音。共用回覆提示跨工作重用。AMS 新增加密 Key／Region／聲線設定，以及草稿文字預覽、明確生成、完整檔試聽和未知結果的計費重試確認。

私人帳戶可先測試，之後替換公司 Key／Region，既有檔案不重做。生成與發佈分開；雜湊保留防止並發重複提交，未知結果不自動重試，發佈與電話回調無合成行為。發佈快照沿用原完整音檔。未配置實際 Azure Key，不產生真實合成或電話，不自動切換保存的通訊設定。

驗證結果及覆查見 `azure-mp3-plan.md`，操作見 `ams-channel-settings.md`。先前的 Say 及手動片段模式保留為選項。

## 2026-11-06 MP3 片段電話

新增 Say／自備錄音兩種內容方式。管理員按語言、分類及片段上傳 MP3／PCM WAV 或配對既有錄音；清單附建議內容。草稿可查看需要的片段、按順序試聽及上傳補充說明。通用稱呼，不錄個人姓名。日期使用 Site 時區完整起訖日期時間及 UTC 時差。

發送前缺漏回409、保留草稿。確認／取消／額滿後備亦檢查；WhatsApp-only 不要求未使用的邀請片段。發佈時凍結全套錄音計劃；設定、地點變更及封存不影響舊調度。既有 Say／單檔錄音快照與 DTMF1／2／9 沿用。不自動修改保存的真實通訊設定，不發真實電話、不使用外部合成服務。

驗證及覆查結果見 `mp3-clips-plan.md` 的 ledger，操作見 `ams-channel-settings.md`。這項新增選項取代下方舊紀錄中只容許完整錄音或只有 Say 的描述。

## 2026-11-03 最新決定：不接入外部 TTS

需求方明確要求不接入外部TTS。使用AMS上傳、試聽和管理完整錄音，Twilio只播放及收取DTMF。地點、日期和時間由HR錄進本次調度音檔，系統不自動生成語音。外部TTS不再列為待選供應商或後續待辦。此決定取代下文較早的TTS方案及待確認描述。


## 2026-11-03 通訊設定批次完成

獨立 Workforce AMS 新增 admin「通訊設定」：Twilio／WhatsApp連線、三語六用途模板映射、既有微服務模板CRUD、音檔上傳與試聽。Request草稿保存三語完整邀請／確認／取消錄音；Twilio已移除Say，只Play/Gather。員工語言支援en/yue/zh。工種不新增。

設定加密及版本化，舊mock工作保持mock，舊調度固定內容、帳號／origin與語言；同帳號／同服務的Token/key更新供歷史工作使用。真實電話預檢在發送事務內依實際合資格選中候選人執行，並要求撤回WhatsApp同意所需fallback錄音。封存保留舊工作播放，不能新選。原.env僅首次bootstrap；資料庫已有版本時不再解析過時供應商環境變數。

驗證：後端35單元／129整合，AMS7單元／18瀏覽器及build通過；補充解除Site關聯案例後21個channel-settings案例再驗通過。一次fresh覆查的7項Important及1項原Minor均已修正並回歸；MP3完整性由Minor升級Important，因損壞音檔可能導致真實電話無聲。未defer。操作見ams-channel-settings.md，人工19項見ams-channel-settings-testcases.md，人工結果全部保留未執行。外部TTS未選定、未接入，真實電話／WhatsApp／Meta模板未驗收。預設保持mock，不修改Core，不stage／commit／push。


## 2026-11-03 job-type scope closed

User explicitly instructed: if the documents do not mention job types, ignore them. No job-type/accepted-trade fields, tables, filtering, roster changes or matching rules are to be added. Existing specs remain authoritative for staff and candidate eligibility. Active extension remains AMS channel settings, Cantonese/Mandarin/English content, WhatsApp template management and audio/recording management without Twilio TTS. This scope clarification changed documentation only.

## 2026-11-03 voice quality clarification

User explained that Twilio TTS sounds unsatisfactory. Other TTS is not prohibited by that answer; a provider is not yet chosen. Proposed direction: synthesize and preview a complete audio file outside Twilio, save it, and use Twilio playback/DTMF only. Azure and Google official lists both include Hong Kong Cantonese options, but quality needs a shared-script audition. Initial languages confirmed: Cantonese, Mandarin, English. User excluded job-type fields and matching because the original specs do not define them. No product code, external service configuration, paid synthesis or runtime mode changes.

## 2026-11-03 voice requirement correction

User explicitly disallowed Twilio TTS. Existing Say implementation and prior English-TTS verification are historical and do not meet this new audio requirement. Target is Twilio playback of audio files plus DTMF; source of audio is pending clarification: non-Twilio synthesis versus human recordings only. Requirement recorded in spec-addendum and AMS gap analysis. No product code or credentials changed in this clarification; runtime remains mock.

## 2026-11-03 WhatsApp consumer implementation

User supplied Live4Well backend/full handoffs and requested only calls to the existing whatsapp-microservice. Key source files in both packages match byte-for-byte. We implemented an independent Workforce HTTP client and persistent adapter, without importing the gym membership/AMS/chat package, modifying the service, forwarding webhook changes, or direct Meta calls.

Plan and rulings: docs/whatsapp-integration-plan.md. New migration 007 and configurable positional HR templates. URL/key/approved HR template details are deployment prerequisites; private .env remains mock. No live calls/messages, Git staging or commits.

Observed RED→GREEN: missing client/adapter functions; source-shape HTTP contract; raw inbound future fields stripped; malformed successful submission stuck submitting; startup ignored WhatsApp mode; AMS missing WhatsApp mode label/header. Final verification:34/34 unit and 108/108 integration, including 19 WhatsApp integration cases and prior PSTN. Frontend7/7 unit,15/15 browser,build passed. One fresh read-only review found five Important issues; six regressions observed RED then all GREEN in the final suite. No findings deferred. Testcase docs/whatsapp-testcases.md; setup docs/whatsapp-integration.md. Evidence /private/tmp/workforce-whatsapp. API8310/AMS5210 HTTP200, voice and WhatsApp remain mock, credentials unconfigured. Inventory316 total,135 with test references,181 without,0 individually accepted.

## 2026-11-03 PSTN implementation started

The user requested Twilio PSTN and then clarified that there is no separate Company Messaging Service project: that term meant existing Core PSTN and a colleague's WhatsApp implementation. Core PSTN source was inspected: its outbound path dials conferences and its DTMF handler can open doors. Do not reuse the intercom callback for HR.

Placement confirmed: independent Workforce adapter, using Core technical patterns without Core runtime or credentials. SDK config/gateway/TwiML/signature, durable voice_calls migration, worker routing, signed callbacks, cancel reconciliation, mode UI and explicit startup validation are implemented. Current .env remains mock. No real calls or tunnels were created.

Observed RED→GREEN: initial eight integration cases; cancellation intent lost when last_status was NULL; canceled/completed provider states missing; repeated terminal callback after interrupted inbox write; startup still rejecting PSTN mode; UI lacked mode status and hid no mock tools. Test logs are under /private/tmp/workforce-pstn. Full regression/review results are recorded below when verified.

Ruling: specs follow-up policy remains authoritative. The Gather callback acknowledges a recorded response; confirmation/unavailable/cancellation use existing follow-up Attempts. Voice follow-ups wait until the original call ends. WhatsApp-contactable staff still receive mock WhatsApp follow-ups until that adapter is supplied.

Ruling: uncertain Calls.create outcomes do not retry automatically. Persist submission_unknown and await a verified callback rather than risk duplicate paid calls. With no callback, manual inspection in Twilio Call Logs is required; automatic provider search/reconciliation is not implemented.

Twilio SDK 6.2.0 installed only in Workforce API, audit 0 at install. Plan: docs/pstn-implementation-plan.md. No commits/staging/push or Core changes.

## 2026-11-03 local completion batch (verified)

Scope: close the previously identified local P0 gaps without Core integration or live Messaging Service sends. Work in the existing standalone repositories, no worktree/staging/commit. Manual development services on 8310/5210 are running at the user's request; leave them available. Automated integration/E2E use workforce_test and 8311/5211, sequentially.

Observed RED then GREEN: AC-R-01-10 PATCH 404 instead of 409; missing per-attempt reply receipt time; AC-N-01-06 audit entity filter ignored; G-08 collection loader absent. New backend tests cover immutable requests without audit side effects, channel first-response preservation, and scoped audit access. All 3 passed after their fixes. Two collection loader unit tests passed after implementation.

Observed browser RED: staff direct-invite action absent, channel receipt times absent, searchable site picker absent with >200 rows. All 10 browser cases now pass. Source/test staging and hash-guarded selective copier: /private/tmp/workforce-local-completion. Do not sync the earlier /private/tmp/workforce-stage source; it predates the standalone correction.

Ruling: AC-R-01-10 requires open request edits to return 409; specs do not define a draft time/headcount editor. Request fields remain immutable and PATCH rejects after checking visibility. Cancel/recreate is the supported flow, without inventing an unspecified editor.

Ruling: record each channel's first valid reply receipt time, not client-supplied occurred_at. Preserve the first response within an attempt and the existing candidate-wide first-final-response rule. Migration 005 adds nullable timestamptz and backfills from stored valid processed events.

Ruling: keep API pagination capped at 200. Selector data follows all pages; display options and checklists in searchable 50-item pages, preserving selections across search/pages. This loads the whole directory into the POC browser; a future very large deployment may need server-side search instead.

Latest test logs: backend-red.log/backend-green.log/frontend-red.log/frontend-green.log under the batch staging directory. Final read-only review completed by review_local_completion. All three findings were reproduced RED and fixed GREEN. Final suite: backend 21 unit +72 integration; frontend 6 unit +10 E2E; build passed.

Spec authority: the nine files supplied in `/Users/joshua/Downloads/specs/` on 2026-11-02. Earlier audio and messages do not add P0 features.

Architecture corrected: standalone Workforce API and React AMS. Later on 2026-11-03 the user clarified that there is no separate Messaging Service and chose a standalone Workforce Twilio adapter. Earlier external-service pending items below describe the previous mock milestone, not current dependencies.

## Constraints and decisions

- Work directly in the new project directories. The user previously declined Git worktrees. No commits, pushes, staging, or existing Core dependency changes.
- WhatsApp production contract is pending. PSTN placement is confirmed. No real messages or calls are authorized by the local implementation test.
- Keep standalone email/password login and `admin` / `site_manager` permissions per the specs. Core SSO and module integration are outside scope.
- Use Node 26 for the new projects. Use the native Node test runner because it can prove the spec behavior without a second backend test runtime; README tools are suggestions.
- Database confirmed by the user: local Postgres, not MariaDB. Started the already installed Postgres 18 on loopback and created dedicated workforce_local / workforce_test databases and a limited project owner. Private credentials are in ignored .env, not this ledger.
- Workforce owns its users, Site grants and data. Core company/identity mappings are not a pending requirement.

## Preflight dependencies

- T1 provides transactions, errors, audit, clock and permissions used by T2/T4/T5.
- T3 owns attempt persistence and jobs; T5 creates business intents and T6 builds channel payloads. External sending occurs only after committing business changes.
- T4 and T5 must share staff overlap protection. Request-row locking alone does not protect different requests.
- T6 request cancellation and roster-change notices need a common notification idempotency key.

## Progress

- Setup started from empty new project directories; implementation is now in those projects, with package manifests and lockfiles installed under Node 26.12.1.
- T0: specs read and inventoried, 316 unique AC IDs. Missing FEATURES.md and Q1–Q8 remain recorded inputs.
- T1 local foundation implemented: opaque hashed sessions, password hashing, role/site checks, strict UTC input, record-time trigger and same-transaction audit.
- T2 local management implemented: staff/site CRUD, CSV atomic import, linkage, eligibility contactability, site-manager grants/revocation and warning responses.
- T3 local messaging implemented: raw receipts plus logical inbox dedupe, HMAC/timestamp validation, durable jobs, configurable mock outcomes and retry backoff. Live HTTP/Messaging Service contract remains pending; the provider behind that service is unspecified.
- T4/T5 local roster and dispatch implemented: Postgres overlap constraint, ordered staff advisory locks, broadcast/direct, draft candidates, accept/cancel/expiry, assignment/shift writes, Find staff, manual overrides.
- T6 local channel payloads and notification intents implemented; no real provider sends have occurred.
- T7 React staff/site/account/audit/request/weekly-roster screens implemented. Polling is 3 seconds. Local dev-only response simulator is available.
- T8 local milestone verified: backend 21 unit / 72 integration, frontend 6 unit / 10 E2E, Workforce AMS build and local startup smoke passed. See review-local.md. All 316 AC are inventoried, not individually certified.
- 2026-11-03: removed the earlier Core entry from both develop-staffing-and-roster branches after the user clarified standalone ownership. Restored eight unchanged pre-entry files and removed six agent-created files. Preserved the existing Core AMS lockfile and all Node 26 work. The four Core entry tests are retired, not part of Workforce coverage.

## Rulings and costs

- Ruling: keep Node native test runner for the backend instead of adding Vitest — spec tools are suggestions — a later shared testing standard may require a runner migration.
- Ruling: retain the specified standalone email/password login because this is an independent product. Workforce accounts and Site grants are owned by Workforce.
- Ruling: request-managed shifts are changed through Request actions, per the user's explicit answer — protects Assignment/Shift/count consistency — withdrawal of retained assignments after expiry remains a requirements gap.
- Ruling: use per-request and per-staff transaction locks plus a Postgres exclusion constraint — capacity and cross-request/manual overlap need separate protection — deployment requires the btree_gist extension.
- Ruling: cancel obsolete queued offer/confirmation intents but retain already-required cancellation/unavailable notices — closing a request must not suppress the final outcome already owed to staff — exact live-provider cancellation semantics still need its contract.
- Ruling: technical retry timing is tested with a configurable local mock and injected clock — avoids real messages — real 10-second HTTP timeout/provider idempotency behavior is not yet certified.
- Ruling: generated acceptance inventory reports test-name references, not pass coverage — combined tests do not prove every individual criterion — full AC sign-off is still required.
- Ruling: no automatic commits or staging — preserves the user's review/commit preference — new repositories will contain uncommitted project files.

## Independent review

One read-only fresh-context review was performed by review_workforce_local. Six Important findings were reproduced and fixed in one implementation pass: stale callback status, obsolete confirmation after assignment removal, overdue offer sends, stale draft open shifts, site edits with active work, and stale roster actions after a site switch. The corresponding backend regressions were observed failing before their fixes. The stale roster browser regression was also observed failing before its fix.

Reviewer baseline gaps for grant revocation, unlink warnings and programmable mock transport were added to the local implementation. Confirmation address and visible warning presentation were treated as required behavior rather than deferred polish. Production integration, expired-assignment withdrawal, and complete 316-AC sign-off remain explicitly outside this milestone's completion claim.

Final local batch: fixed search hiding at the 50-option threshold, non-retryable linkage save UI, and mismatched legacy response/time pairs. Each had a reproducing failed test and a passing regression after the fix. Added test-per-test Postgres isolation and reproduced/fixed same-Site roster selection clearing loaded shifts. AC-D-02-03 inline time validation was observed RED then passed in the full 10-case suite. No reviewer findings remain deferred.

Final evidence: final-backend.log (21/21 +72/72), final-unit.log (6/6), final-e2e.log (10/10), final-build.log (exit 0) in /private/tmp/workforce-local-completion. Acceptance inventory is 316 baseline,121 with test-file references,195 without,0 individually accepted. Manual dev services remain running on 8310/5210 at the user's request. No Core changes, Git staging, commits, pushes, live sends or development-data resets in this batch.

## PSTN final review fix pass

Fresh read-only review by review_workforce_pstn found no Critical issues, three Important issues and one recovery-state issue graded Minor by the reviewer. All were reproduced with failing tests before fixes.

Ruling: treat the permanently stuck submitting recovery state as Important operational correctness, because it defeats the intended restart-to-unknown behavior and can leave an operator waiting indefinitely. Defer reclaimed work until the submission threshold, then expose submission_unknown without another create. No new automatic redial policy is introduced.

Fixed: 429 retry endpoint snapshot now changes with the dialed payload; only createCall errors are classified as provider rejections. Slow provider cancellation is performed by Worker, and Gather returns after durable local processing. Browser mode refreshes every three seconds and on focus; non-auth browser mutations require a known observed mode and send X-Workforce-Messaging-Mode. API rejects a stale supplied mode with 409 before business changes or audit. Direct API callers without the browser header retain their authenticated contract.

Reviewer set-asides: retain explicit manual inspection for unknown outcomes with no callback, existing follow-up policy and offer-end wait, canonical signature/endpoint checks, and durable callback redelivery recovery. Actual provider delivery/audio/provisioning/retry remains unverified; WhatsApp and Core runtime integration are outside this addition. These decisions carry the cost of manual provider inspection and separate live testing, and do not imply complete AC acceptance.

No findings are left deferred. Final suite counts and evidence are appended after verification. No staging, commits or live calls.


Final PSTN verification: backend-final.log reports 28/28 unit and 89/89 integration, including 17 PSTN integration cases. ams-unit-final.log reports 7/7; ams-e2e-final.log reports 13/13; ams-build-final.log exits 0. Evidence is retained under /private/tmp/workforce-pstn because project files remain uncommitted. Original nine specs were hash-checked against Downloads/specs and unchanged. Acceptance inventory: 316 baseline,128 with test references,188 without,0 individually accepted. No live Twilio test is claimed. Existing development API8310 and AMS5210 returned HTTP200; local .env stays mock.

Language confirmation: Cantonese, Mandarin and English are required for the new AMS/channel configuration scope. No provider selected and no audio quality sign-off yet. This is a requirement update, not an implementation completion claim.


## 2026-11-04 Twilio Say

User replaced mandatory recordings with Twilio Say. New offer/confirmation/cancellation/unavailable calls use English, Cantonese or Mandarin based on pinned employee language. Speech snapshots contain Site-local complete start/end dates, times, offsets and address; XML text is escaped. DTMF 1/2/9, signature validation, call binding, cancellation and capacity rules remain. Removed new-send recording lookup/preflight and AMS upload steps. Existing submitted audio snapshots retain Play and historical public media remains readable. User-saved Twilio credentials and settings were not changed.

API 42 unit /132 integration and AMS 7 unit /18 E2E/build passed. Test logs and screenshots: /private/tmp/workforce-say . Initial no-audio request returned409, now200 with signed Say callback. Fresh read-only review found a main-only historical confirmation snapshot failing after cancellation; reproduced RED and fixed GREEN by preserving Hangup for absent optional historical prompts. No other findings. Existing dev API restarted with saved twilio-pstn / WhatsApp mock; no pending send attempts at restart. User subsequently authorized a separate one-shot live Say test to their own supplied number, using saved credentials and no business-data writes. Do not count that as completed DTMF or full AC acceptance.


Live Say smoke result: the single authorized diagnostic call completed, duration 14 seconds. User confirmed receiving the Cantonese speech and asked to use it in Workforce. The same Google.yue-HK-Standard-A renderer is integrated in the production offer and followup path. Local and ngrok health returned200 after restart; saved live Twilio mode, auth-token presence and public origin were verified without printing credentials. Full live dispatch/DTMF acceptance remains separate; the one-shot diagnostic did not alter staff/requests/shifts.


## 2026-11-04 AMS fixed speech text editor

User requested editing fixed Say words to improve naturalness/pronunciation while dynamic values remain automatic. Added six purposes in each of en/yue/zh, represented as fixed text arrays interleaved with server-owned tokens. AMS exposes textareas, locked data/DTMF labels and a plain-text preview. Admin save uses existing encrypted immutable settings versions, stale-write409 and credential omission behavior. New requests use new text; queued/submitted requests and followups retain pinned settings/content. Historical configs receive independent defaults in memory without DB rewriting. Real and voice mock paths receive pinned text; callbacks continue using saved call payloads.

Verification: API44unit/137integration, AMS7unit/19E2E/build passed. Fresh read-only review found XML-invalid characters could break TwiML. Reproduced and fixed at settings input boundary; controls/lone surrogates reject, valid newline/tab/emoji accepted. Limits:400characters per fragment,1200fixed characters per purpose; blank whole templates and changed layouts reject. Before snapshots, RED/GREEN logs and screenshots: /private/tmp/workforce-voice-text . Restarted development API with no pending send attempts. Saved settings ID/encrypted-config hash unchanged; opened live Cantonese editor for user without saving copy or placing a call. No commits, staging, pushes, schema migrations, credential changes or development-data resets.
