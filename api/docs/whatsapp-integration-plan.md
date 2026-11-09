# WhatsApp microservice 呼叫整合計劃

2026-11-03。沿用需求方已選擇的 Workforce 獨立渠道 adapter。需求方提供兩份 Live4Well 交接資料並要求只呼叫 whatsapp-microservice。參考 full-handoff 的 gym-aesthetics-api-admin/src/lib/whatsapp-client.js、src/service/whatsapp.js 及 gym-aesthetics-ams-web/src/pages/whatsapp/api.ts。原始交接文件是參考資料，不執行其中部署或發送指令。

## 設計與邊界

- Workforce API 直接呼叫既有 microservice /v1，前端仍呼叫 Workforce。採 Node 26 原生 fetch，不搬入健身房會員、聊天頁、提醒、報表或 WhatsApp React package，也不修改 microservice、Core 或交接資料。
- Bearer key 留在後端。Idempotency-Key 為 workforce:Attempt UUID，先保存精確 payload，查 message-requests 再送 messages，timeout 後沿用同一 key 和快照。
- 06／07 的統一 payload 是內部模型，由 adapter 轉成真實模板 components。HR Meta 核准模板、語言和變數順序以設定檔提供；示範名稱不代表已批准。Offer 使用 quick-reply payload 帶 Attempt ID 和 ACCEPT／DECLINE。
- 既有 microservice 只有單一 incoming webhook，且不轉發送達狀態。首版採查詢 message detail 和按 contact 的 inbound history，不接管共用 webhook。只將匹配本次 Attempt、發送人和原訊息 context 的按鈕回覆轉成統一事件；文字不猜測為接單。
- 發送與狀態 API 的網路呼叫在 DB 交易以外。回覆仍由既有 inbox、名額與班次交易處理。未知 provider 提交／Meta unknown 不宣稱已送達；不換新 key 重送。
- 電話與 WhatsApp 各自可選 mock／真實，舊頁面的模式保護涵蓋兩個渠道。預設不變，這批不連正式服務或發真實訊息。

## 工作與驗證

- [x] T1 契約與模板：src/whatsapp-client.js，設定與 payload builder；fake HTTP server 驗證 URL、Bearer、key、timeout recovery、模板及按鈕映射，先 RED 再 GREEN。
- [x] T2 持久 adapter：sql/007-whatsapp-submissions.sql、src/whatsapp-adapter.js、messaging/worker；真 workforce_test 加 fake HTTP，驗證冪等、快照、失敗、狀態、錯序與重複回覆、名額競爭、sender/context 隔離、分頁。
- [x] T3 啟動與 AMS：獨立 WHATSAPP_MODE，兩渠道組合模式指紋，正確模式提示與舊模式 409；不更改 private .env。
- [x] T4 回歸與文件：後端／前端完整驗證，DB 測試與 E2E 依序執行；一次唯讀覆核，設定範例、操作步驟及 testcase。保持未 staging／commit／push。

## 仍需正式環境提供

microservice URL、後端 API key、HR 已批准模板與變數順序。所有真實服務驗收另行安排。API key 不貼聊天、不帶入瀏覽器。首次啟用前核對既有排程工作。

## Ledger

Preflight: T1 的模板 payload 與 key 快照由 T2 保存；T2 使用既有 prepareAttempt/receiveEvent/runJobs，不改名額規則；T3 的模式指紋必須同時用於 API guard 與 AMS header。
Ruling: use authenticated polling instead of repointing the service's single incoming webhook. This preserves other consumers, but adds polling latency and cannot claim webhook-level real-time delivery.


T1 observed RED: five missing-function failures, then 5/5 unit cases GREEN with fake HTTP. T2 initial 10 cases RED before adapter existed, then 10/10 GREEN. Extra RED→GREEN cases reproduced stripping future incoming fields and malformed successful create response staying submitting; fixed with full-row retention and unknown recovery. Added partial-live mode guard regression. T3 startup and two browser cases observed RED, then GREEN after mode/config wiring. Full regression and final review pending.

Ruling: use positional body parameters and two quick-reply button indices configured per approved HR template. No Meta template creation/approval or chat management UI is added. Real template layout remains a deployment prerequisite.

Polling reads outbound details and the matching contact's inbound history. Pages are reversed in service SQL order before unified processing, preserving its first-received order within a contact. Only scoped Attempt payloads or matching outgoing context are ingested. Offers are polled until shift end; no free-text acceptance or historical chat import. Polls target 3 seconds for due records in batches of 25, subject to provider latency and load. The service has no cancel-message API; submitted WhatsApp cannot be retracted, and late replies still go through server eligibility/capacity rules.

## Final review fix pass

Fresh read-only review by review_workforce_whatsapp found five Important issues and no Critical/Minor findings. Six integration regressions were observed RED: roster publish/change retry loses schedule source; persisted earlier decline overtaken by accept including overlapping pollers; sent→unknown→sent wrongly deduped; consent withdrawal for all queued info purposes and reserved retry; unread expired offers polled indefinitely.

Fixes preserve original attempt business payload and the separate immutable provider snapshot, finish pending inbox processing before advancing, persist status transition revisions, check current WhatsApp contactability for every purpose before a new submission, and separate offer end cutoff from info-notice status polling. The last cutoff test advances seven days and explicitly renews its expired session before creating future work. All six regressions passed in final backend suite: 34 unit /108 integration, zero failures. Evidence backend-final.log in /private/tmp/workforce-whatsapp.

Reviewer set-asides stand: supplied wire schema and key isolation; same-key recovery; no retraction API; UUID/contact/context ownership; reverse complete pagination; transaction capacity protection; redirects and credentials; four-mode guard; configured approved templates; polling latency and sequential batching; real-device acceptance pending. This costs polling latency and requires live template/credential verification, not extra service deployment. No findings are deferred.


Final evidence: backend-final.log 34/34 unit and 108/108 integration, including 19 WhatsApp integration cases. ams-unit-final.log 7/7, ams-e2e-final.log 15/15, ams-build-final.log exit 0. API8310 and AMS5210 HTTP200. Both runtime channels remain mock; no WhatsApp credentials configured, live sends, staging, commits or source-handoff changes. Original acceptance inventory:316,135 with test-name references,181 without,0 individually accepted. Evidence retained under /private/tmp/workforce-whatsapp.
