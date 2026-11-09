# AMS 渠道與三語音檔設定實作計劃

2026-11-03，需求方已要求開始。獨立 Workforce API／AMS，工種不處理，既有角色與匹配規則不變。三語：粵語 yue、普通話 zh、英語 en。Twilio Say 禁用，改播放上傳音檔；需求方確認不接入外部 TTS，使用上傳的完整錄音。

## 設計

- 管理員 AMS 儲存 Twilio／WhatsApp 模式、連線資訊及每語言模板映射，後端加密保存 immutable 設定版本，API／Audit 不回傳密鑰。每次保存有 optimistic version 檢查；瀏覽器模式指紋同時檢查設定版本。
- 密鑰由 WORKFORCE_SETTINGS_KEY 或 .local/settings.key 提供，32 bytes；本機首次建立，之後必須與 DB 一起保留，遺失不靜默重建。原 .env 只在首個設定版本 bootstrap；沒有啟用／發送真實服務。
- 訊息 Attempt 在建立時保存設定版本，跟進通知沿用原調度版本。歷史 Call SID、微服務 UUID 與回調沿用當時帳號／origin；同帳號／同origin使用最新保存密鑰，撤銷舊Token不再接受；設定更新不重送舊工作，不將 mock 待發工作變真實。
- WhatsApp 三語各六個業務用途，支援核准模板清單、建立／修改／刪除與映射；呼叫既有微服務，服務 key 留後端。尚未核准或缺相應語言映射時阻擋真實發送，不默認英文。
- 音檔在 DB immutable bytea 保存，MP3／WAV、上限3MB、檔案內容驗證。管理員可建通用 ack/no_input/unavailable 音檔；HR 可在有權限的草稿調度上傳各語言完整 offer/confirmation/cancellation 音檔並試聽。錄音綁定到該調度，避免用其他班次日期。
- Twilio 只 Play + Gather。每個實際電話保存音檔 URL 快照，回覆播對應語言音檔；缺檔不撥、無 Say fallback。公開音檔 URL 使用不可猜 token，私有預覽與管理仍檢查角色／Site。
- 只使用錄音上傳、試聽及播放。外部 TTS 不在範圍內，也不列待辦；本次班次的地點、日期和時間必須錄進完整音檔。

## 任務與驗證

- [x] T1 settings：schema、AES-GCM、版本／遮罩、admin API、測試 RED→GREEN，私有 key 不進 Git。
- [x] T2 contents：三語模板及微服務管理、音檔上傳／私有預覽／不透明公開播放、草稿 Request 綁定；Site 權限與上傳驗證測試。
- [x] T3 runtime：設定版本 pinned Attempt、歷史 callback、Worker dispatch 與 mode revision；移除所有 Twilio Say，三語無 fallback，測試舊工作設定變更仍安全。
- [x] T4 AMS：設定頁、模板管理、音檔庫、員工三語選擇、調度錄音附件。Playwright 實際表單驗證。
- [x] T5 全套回歸、一次 fresh read-only review、修正及 testcase／操作文件。後端 DB 與 E2E 依序執行，保留開發庫與 8310／5210 服務，不 staging／commit／push。

## Ledger

Preflight: T1 version 與 key storage 由 T3 使用；T2 的 immutable audio URL 由 T3/PSTN snapshot 使用；T4 settings PATCH 與 API revision 必須一致。現有 *_test 僅測試庫，不重設 workforce_local。
Ruling: use database-managed versioned settings and encrypted secrets rather than editing .env from the web. This allows immediate controlled updates but requires keeping the settings encryption key with database backups.
Ruling: use complete uploaded recordings. Do not integrate external TTS or retain it as planned work. Record dynamic shift details into that request's audio.

## 實作 Ledger

T1/T2/T3/T4 source implemented. TDD evidence under /private/tmp/workforce-settings: settings-unit-red/green, settings-api-red/green, content-red/green, runtime-red/first, ui-red/first, approval-red, backend-first-full. First full backend 35 unit /120 integration all passed. Three new browser cases passed before full AMS regression. Source staging uses hash-guarded selective apply.mjs; do not sync older stages.

Runtime: channel-settings AES-GCM immutable versions + active singleton, persistent .local/settings.key ignored. Initial env bootstrap only; Attempt settings_version_id pinned in outbox, followups inherit original request profile. channel-runtime routes worker by profile and historical Twilio callbacks by voice_calls profile. mode status carries configuration_revision; request AsyncLocalStorage + transaction FOR SHARE prevents config racing a mutation. Twilio Say replaced entirely with Play; PSTN fixtures migrated to injected audioResolver and XML Play assertions. New language yue accepted; runtime WhatsApp selects per-employee map and verifies provider APPROVED/name/language/body/button shape before a new POST.

Audio: immutable DB bytea + opaque public token, admin global prompts, Site-scoped draft Request recordings, private authenticated previews. Missing language/audio blocks live send. External TTS is excluded by user instruction; use uploaded recordings. No job-type scope. Settings/admin backend and three browser scenarios verified; final fresh review and all-suite after fixes still required.

Manual development processes restarted because old sessions were gone: API session57595 with log /private/tmp/workforce-settings/api-dev.log; AMS session51696 with log ams-dev.log. Both intended to remain available. Do not start duplicates. No .env changes or real sends.

## 最終覆查與驗證

Fresh review一次完成，7 Important + 1 Minor。MP3 header-only驗證問題重新定為Important：損壞錄音能到達真實電話並造成無聲。全部當批修正，不重派review、不defer。

修正及RED→GREEN：設定canonicalize及origin；同帳號Twilio token／同origin微服務key輪替；封存音檔保留pinned工作；發送事務內選中且eligible預檢；WhatsApp同意撤回fallback完整錄音與語言快照；通用提示ownership/language/active驗證；saved設定restart忽略過時bootstrap env；MP3完整frame驗證。證據位於/private/tmp/workforce-settings的review-red、candidate-red、wa-rotation-red、review-green、backend-final、review-eligibility-final。

後端35單元／129整合全通過；AMS7單元／18瀏覽器／build通過。畫面已檢視，補設定表單padding後再跑瀏覽器及build。19個人工驗收保留未執行；真實電話／WhatsApp及音質仍待驗收；外部合成不在範圍內。沒有工種、Core改動、stage、commit、push或真實發送。
