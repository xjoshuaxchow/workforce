# 呼叫現有 WhatsApp microservice

2026-11-03。參考需求方提供的 full-handoff，沿用 gym-aesthetics-api-admin 的 server-to-server 呼叫方式。Workforce 不需要 gym-aesthetics-ams-web、gym-aesthetics-api-admin 的執行環境、會員資料表或聊天 package。

## 實際鏈路

Workforce AMS → Workforce API／Worker → WhatsApp microservice `/v1` → Meta。電話仍可獨立使用 Twilio PSTN。

後端用 `Authorization: Bearer ...`。每個 Attempt 使用固定 `Idempotency-Key: workforce:<Attempt UUID>`；保存完整模板 payload 快照，先查 `/message-requests/:key` 再 `POST /messages`。HTTP timeout 為 10 秒，拒絕重新導向；錯誤不附帶 Bearer key 或完整請求設定。

`202` 及 `messageIds` 只代表微服務已入隊。Worker 查 `GET /messages/:id` 的 submission_status、delivery_status、meta_id，再轉成現有統一事件。狀態轉換有持久序號，sent → unknown → sent 可以恢復，避免把後來的恢復誤當重複事件。Meta unknown 會顯示提交結果待確認，不當作已送達。

回覆使用 `GET /messages?contact=...&direction=inbound&from=...&limit=100`，跟隨 nextCursor。只接受帶本次 Attempt ID 的 quick-reply payload，並核對電話及原始 Meta message context。按鈕文字、一般 Yes／No 文字不會被猜測成接單。事件依服務回傳的歷史順序處理；先完成已保存但尚未處理的舊回覆，再處理較新回覆。已處理 event ID 去重，名額與班次仍由 Workforce 交易分配。

現有微服務只有一個可選 incoming webhook，而且不轉發送達／已讀狀態。這批不改它的 webhook 設定，採查詢結果，避免影響其他使用者。目標每 3 秒讀取到期記錄，每批最多 25，實際更新受服務延遲及數量影響；會有輪詢延遲。已取得 message UUID 的邀請查到班次結束，其他通知查至終止狀態。尚未確認提交 identity 的記錄仍保留查 key 恢復，需人工核對無法確定的結果。

## 啟用前設定

在 Workforce API 的私有 `.env` 填入，API key 不放進任何 VITE_* 或前端檔案：

```dotenv
WHATSAPP_MODE=service
WHATSAPP_SERVICE_URL=https://your-existing-whatsapp-service.example
WHATSAPP_SERVICE_API_KEY=your-backend-service-key
WHATSAPP_TEMPLATES_FILE=./config/whatsapp-templates.json
```

URL 填服務 origin，不加 `/v1`。內網 HTTP 可用，請按部署環境選擇受信任的網路及 HTTPS。這裡是微服務 API key，不是 Meta Access Token。

```sh
cd /Users/joshua/ns-workforce-api
cp config/whatsapp-templates.example.json config/whatsapp-templates.json
# 編輯設定檔，填入已在 Meta 批准的 HR 模板名稱、語言與變數順序
npm run db:migrate
npm run dev
```

範例模板名稱不表示已建立或批准。設定檔的六個邏輯名稱對應現有業務，實際 `name` 可不同。`body` 按模板 {{1}}、{{2}} 的順序列出內部欄位；本版支援純文字 BODY 的位置參數。邀請模板需有兩個 quick-reply 按鈕，`accept`／`decline` 是從 0 開始的實際按鈕 index。資訊通知不附接單按鈕。必須核對必填欄位與可為空的 message 是否適用實際 Meta 模板。

電話模式仍由原有 `MESSAGING_MODE=mock` 或 `twilio-pstn` 決定，與 WHATSAPP_MODE 分開。AMS 頂部會分別顯示兩個渠道；瀏覽器寫入帶兩渠道模式指紋，切模式後舊頁面操作回 409，確認新提示後再操作。

啟用會處理既有待發／重試 WhatsApp 工作，先核對排程。第一次只用一位明確同意接收的測試員工，選 direct、渠道只選 WhatsApp。未啟用前保持 mock；目前私有 .env 沒有被本批修改。

## 取消、失敗與恢復

- 發送每種 WhatsApp 通知前都重查目前同意及可聯絡狀態；withdraw opt-in 後不建立新提交。已提交者仍可查回結果，無法撤回。未執行的 queued 邀請取消後不送。微服務沒有撤回訊息 API，已提交訊息無法從 Workforce 撤回；已取消／額滿的回覆按伺服器結果處理。
- 4xx 永久失敗，429 可重試；5xx／網路問題沿用固定 key 與 snapshot，使用既有 5 秒／30 秒／2 分鐘 backoff。請求回應遺失可查 key 恢復，避免重複入隊。
- 不明提交保留未知狀態；查詢可找回原 message UUID。沒有確認前不要用新 key 重送。Meta 自己的 unknown 結果需在微服務／Meta 查核，Workforce 不把它當新訊息重撥。
- 同一 Attempt 的收發號碼、模板與參數快照固定，重試不套用後來的員工或模板編輯。首次尚未提交前更正接收人，請取消再重建。

## 測試與尚待驗收

自動測試使用真本地 workforce_test 與 fake HTTP microservice，驗證路徑、Bearer、冪等鍵、timeout 後恢復、模板、分頁、原始事件、回覆隔離、競爭名額與模式保護。沒有呼叫正式微服務、Meta 或發送真實 WhatsApp。

真機仍需 microservice URL／後端 key、已批准模板，以及一個可接收的測試號碼。逐一核對：入隊 UUID、送達／已讀、按接受／拒絕、重複按鈕、額滿、取消後按鈕及後續確認／額滿／取消／班表通知。這些人工案例目前均未執行。


完整人工案例表見 [whatsapp-testcases.md](whatsapp-testcases.md)。覆核修正的六個回歸包含兩種班表通知重試、舊回覆恢復／重疊 poller、unknown 恢復、五種資訊通知及 reserved retry 的同意撤回，以及過期邀請輪詢截止。
