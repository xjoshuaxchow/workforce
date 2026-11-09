# Workforce 獨立項目實作計劃

更新日期：2026-11-03。需求基線仍為 2026-11-02 提供的九份 specs。需求方最新更正：本產品獨立運作，不接入 Core API 或 Core AMS。本計劃取代先前把 Core 列為入口或訊息接入點的解讀。

## 項目邊界

- ns-workforce-ams：React 工作台、獨立登入、員工與 Site 管理、調度、班表及輪詢。
- ns-workforce-api：Node 26 ESM、Postgres、登入與角色、交易、名額、班次、Audit、持久 jobs 及簽章事件。
- 渠道 adapter：Workforce 直接實作 Twilio PSTN；WhatsApp 專用 microservice 接口已由交接資料確認並實作，預設保持 mock。需求方已澄清沒有另一個獨立 Messaging Service。
- Core API、Core AMS、Core 身份映射與模組開關不在本任務內。先前的 Core 入口程式已撤回。

架構見 architecture.md。需求方已確認在 Workforce 獨立實作 PSTN，參考 Core 用法但不依賴 Core runtime。07 的統一事件提案保留為渠道邊界參考，原文不修改。

## 已完成的本機工作

| 工作 | 本機狀態 | 尚未完成的驗收 |
|---|---|---|
| T0 規格盤點 | 保存九份原文，316 個 AC，修正獨立邊界 | FEATURES.md 與 Q1–Q8 尚未提供 |
| T1 基礎 | Postgres、記錄時間、Audit、Session、角色及 Site 權限 | 逐項 AC 簽收 |
| T2 管理 | 員工、Site、關聯、授權、原子 CSV 匯入 | 大名單與細部畫面契約 |
| T3 訊息 | 本機 mock、持久 jobs、簽章 inbox、去重及重試 | PSTN／WhatsApp 真機驗收與 HR 模板設定 |
| T4 班表 | 手動／open 班次、警告、跨 Site 重疊保護 | 逐項邊界及畫面驗收 |
| T5 調度 | broadcast／direct、候選、原子接單、期限、取消、手動處理 | 逐項人工驗收 |
| T6 通知 | 渠道 payload、確認／額滿／取消、班表發布與變更 | WhatsApp 模板及真實渠道送達／回調 |
| T7 前端 | 獨立登入、管理、調度、輪詢及每週班表 | 逐項人工驗收。本批已補入口、各渠道時間與完整選擇器 |
| T8 驗證 | 2026-11-03 PSTN 後：28 unit、89 integration、7 前端 unit、13 E2E、建置及本機啟動 | 完整 316 AC 人工簽收與真機渠道驗收 |

測試引用不是 AC 完成率。保留既有驗證證據，只有改動或新問題才重跑相關檢查。不把已撤回的四個 Core 入口測試計入本項目驗收。

## 下一步

1. 本批已補上原列本機缺口：Request 修改的 409、員工頁直接邀請、各渠道首次回覆收到時間、完整清單載入與搜尋／分頁、跨 Site audit 篩選。亦修正審查發現的搜尋縮減、儲存重試及回覆回填問題，以及重選同一 Site 清空班表的回歸問題。
2. 依 48 個優先人工案例驗收本機流程，逐項核對全部 316 AC 原文。
3. 本批完成可切換 Twilio PSTN：持久提交、公開驗章回調、DTMF、狀態、取消及跟進電話。fake provider 整合結果與限制見 pstn-implementation-plan.md。
4. 取得專用 Twilio 憑證、主叫號碼與可公開的 HTTPS callback；由需求方安排真機試撥。現有 .env 維持 mock，沒有撥真實電話。
5. WhatsApp adapter 已按交接契約實作，取得 service URL、後端 key 與核准 HR 模板後安排試發。使用既有服務，不搬入健身房 AMS 或部署其 microservice。

## 環境與規則

本機 Postgres 位於 127.0.0.1:5432。workforce_local 為開發庫，workforce_test 為隔離測試庫。私有憑證保存在忽略的 .env，不進 Git。兩個項目用 Node 26，API 為 8310，AMS 為 5210。

UTC timestamptz、唯讀 ctime／utime、半開時段、最長 24 小時、E.164、soft delete、同交易 Audit、穩定分頁。第一次最終答覆為準。Request 管理的班次先取消再重建，手動班次可直接修改。

## 仍待需求確認

- expired Request 保留的已接班次如何撤回。
- 未來班次警告是否涵蓋 draft／published。
- Site 名稱唯一是否忽略大小寫。
- FEATURES.md 與原始 Q1–Q8。

本次更正不新增 React Native、錄音上傳、批次呼叫或 SSO。程式保持未提交，不自動 staging、commit、push 或部署。


WhatsApp 呼叫整合進度及實際設定見 whatsapp-integration-plan.md／whatsapp-integration.md。本批沒有啟用真實服務，也沒有發送訊息。


本批 WhatsApp 最終驗證：34 unit／108 integration、前端 7 unit／15 E2E、AMS build 通過。真實服務／模板與完整人工 AC 仍待驗收；詳見 WhatsApp 專項文件。


## 最新擴充範圍

2026-11-03 需求方排除工種，維持原規格員工／候選條件，不新增相關資料表或 UI。AMS 設定擴充聚焦 Twilio／WhatsApp 連線與模式設定、粵語／普通話／英語內容、WhatsApp 模板管理、電話錄音／音檔及試聽。Twilio TTS 不採用；不接入外部語音合成服務；使用上傳的完整錄音。新設定、三語映射、錄音管理及 Play-only 路徑已實作；本批驗證見 ams-channel-settings-plan.md，不以先前 mock／adapter 測試取代新功能驗證。
