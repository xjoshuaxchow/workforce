# Twilio PSTN adapter 實作計劃

2026-11-03。需求方要求開始實作 Twilio PSTN，並澄清沒有另一個獨立的 Messaging Service。文件中的名稱實際指 Core 既有 Twilio PSTN 能力及同事實作的 WhatsApp。Workforce 仍是獨立業務項目，不接入 Core 登入或 AMS。

需求方已選擇「在 Workforce 獨立實作，沿用 Core 做法」。不用 Core HR endpoint，不重用對講／開門 callback。SDK gateway、設定、TwiML、按鍵、簽章、Worker、持久提交、專用公開回呼、取消與模式保護均已實作。原始九份文件不修改。

## 範圍與保留項目

- 只實作 PSTN 語音：建立外撥、英文 TTS、DTMF 1 接受／2 拒絕／9 重播、忙線／未接／失敗／無輸入、回呼去重及掛斷／取消。
- 名額、跨 Site 重疊、首次最終回覆及通知意圖仍由現有 Workforce 業務處理。
- 保持 specs 的後續通知規則。DTMF 收到後先確認已記錄回覆並結束；正式確認／額滿／取消通知仍透過既有 Attempt 流程發送。WhatsApp 仍為 mock，不宣稱已完成正式訊息整合。
- MESSAGING_MODE 預設 mock。新增 twilio-pstn 模式必須明確設定 Twilio 帳戶、Auth Token、主叫號碼及公開 HTTPS callback origin。實作／自動測試一律使用注入的 fake client，不撥真實電話、不借用 Core 憑證、不自動建立 tunnel。

## 設計

1. 使用 Twilio 官方 Node SDK 的 Calls、TwiML 及 validateRequest。所有 provider form 參數參與驗章，URL 使用明確設定的公開 origin 加原始路徑，不信任 Host 或轉發標頭。
2. voice_calls 持久記錄每個 Attempt 的唯一提交、Call SID、payload snapshot、取消請求和通話狀態。外部網路呼叫發生在資料庫交易以外。
3. 寫入提交記錄並提交後才呼叫 Twilio。建立通話逾時／不明網路失敗不盲目重試，保留 submission_unknown，等待經驗證的 callback 綁定 SID。重啟或工作 lease 到期不能重新建立同一個不明通話。
4. 只有明確拒絕且可以安全重試的結果才重新排程。持久 SID 一旦取得，後續只追蹤／更新現有通話。
5. provider callback 轉成既有統一事件，再走原本的 inbox、Audit、名額及班次交易。狀態晚到不能覆寫最終回覆。callback 不依賴 HR Session。
6. Request 關閉或候選已回覆後，停止不再需要的邀請。Call SID 尚未取得時保留取消意圖，取得後再取消；已接聽者的有效回覆仍按伺服器結果處理。

## 驗證順序與目前狀態

- P1 已完成：設定驗證、狀態映射、TwiML 跳脫、DTMF、SDK gateway、簽章與 URL 驗證。6 個單元案例使用 fake client，沒有撥電話。
- P2 已完成：17 個真 Postgres 加 fake Calls 整合案例。驗證單次提交、網路不明、callback 先到、重複／錯序、名額、取消、通知與重啟恢復。包含覆核發現的重試號碼更新、慢取消、租約時間差與舊模式寫入。
- P3 唯讀審查的 3 個重要問題及 1 個恢復狀態問題已重現並修正。完整後端 28 unit／89 integration 通過；前端 7 unit／13 E2E 與 AMS build 通過。測試使用 workforce_test，手動測試的 workforce_local 保留。
- 維持現有本機 AMS 5210、API 8310 和 mock 設定，不自行切換真實發送。真機測試另需有效帳號、號碼及外部 HTTPS callback。

## 技術依據

- https://www.twilio.com/docs/voice/api/call-resource
- https://www.twilio.com/docs/voice/twiml/gather
- https://www.twilio.com/docs/usage/webhooks/webhooks-security
- https://github.com/twilio/twilio-node

Calls 建立不是把相同 correlation_id 當作 Twilio 已保證的冪等鍵。SDK autoRetry 關閉，由本地持久提交記錄控制重試與不明狀態，避免重複撥號。

## Core 原實作的限制

Core 的 src/model/twilio/index.js 使用 TWILIO_INTERCOM 設定建立電話，TwiML 以 Dial／Conference 為主。src/api/route/display/index.js 的按鍵處理包含 remoteOpenDoor。可參考其 SDK 使用、號碼處理與部署設定，但 HR 的 Gather 1／2／9、接單及回呼必須獨立，不能直接呼叫現有開門路由。

## 覆核後補充

- 429 後可安全重試時，一併更新收發號碼快照。只有 SDK create 的拒絕才按 provider 錯誤分類。
- Gather／status 回調不等待 Twilio REST 取消；持久處理完即可回覆，Worker 處理外部取消。
- Job lease 與提交時間不同時先 defer，達提交門檻再顯示 unknown，不提早把工作標為 done。
- AMS 每 3 秒與 focus 更新模式。未知模式先阻擋寫入；攜帶觀察到的 X-Workforce-Messaging-Mode，API 若不符回 409，避免舊頁面誤撥。
- 新增 submitting／submission_unknown 及資訊通話 completed 狀態，原始 specs 不修改。真機人工案例見 pstn-testcases.md，均尚未執行。
