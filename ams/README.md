# Workforce AMS 本機開發

獨立 React 管理介面。Node 26；後端為旁邊的 `api/`。直接使用 Workforce 帳戶登入，不接入 Core API 或 Core AMS。需求方已確認沒有另一個獨立 Messaging Service；Workforce API 已加入獨立 Twilio PSTN adapter。本機預設仍為 mock，WhatsApp adapter 已接上現有專用 microservice 契約，正式環境待配置；預設 mock。

```sh
cd ams
nvm use
npm ci
npm run dev
```

開啟 `http://127.0.0.1:5210`。Vite 將 `/api` 及 `/media` 轉送到 `http://127.0.0.1:8310`。正式反向代理亦需提供這兩個路徑。登入電郵 `admin@workforce.local`，密碼在後端私有 `.env` 的 `SEED_ADMIN_PASSWORD`。

目前畫面包含員工、Site 與關聯、帳戶、稽核、調度與每週班表。頂部會標示電話真實／模擬模式與 WhatsApp mock，每 3 秒及回到視窗時更新。舊模式寫入會被後端 409 拒絕，須確認後再操作。調度詳情的本機測試工具只在 dev build 且後端為 mock 時顯示，用來模擬回覆，不會撥電話或發 WhatsApp。

```sh
npm test
npm run build
node node_modules/@playwright/test/cli.js test --reporter=line
```

E2E 會自行啟動 8311 的測試 API 與 5211 的 Vite，使用後端 `.env` 指定的專用 `workforce_test`；會清空測試資料。請先結束其他使用此測試庫的測試，再執行 E2E。首次使用 Playwright 時需執行 `node node_modules/@playwright/test/cli.js install chromium` 安裝對應瀏覽器。

時區由 Site 決定，API 收送 UTC。跨午夜請選擇次日的結束日期；遇到夏令時間重複／不存在的當地時間，表單會拒絕並要求修正，不會靜默移動時段。

需求基線、已確認的調度班次修改限制、驗收盤點與未完成項目，見後端 `docs/`。

## 2026-11-03 本機缺口修正

已補上員工頁直接邀請、各渠道首次回覆收到時間、完整清單搜尋與分頁、Request 修改回 409、Audit 實體篩選及表單時間提示。回歸驗證：後端 21 unit／72 integration，前端 6 unit／10 E2E，AMS 建置通過。此段是 PSTN 前一批紀錄。PSTN 設定、最新驗證及真機 testcase 見後端 README、docs/pstn-implementation-plan.md 及 docs/pstn-testcases.md。完整人工驗收仍待簽收。詳情見後端 docs/review-local.md。


## WhatsApp microservice

前端仍只呼叫 Workforce API。service key 不進瀏覽器，不需要匯入交接資料的 WhatsApp React package。後端可獨立設定 WhatsApp mock／service，頂部會分別標示兩個渠道，舊模式操作回 409。只有完全 mock 的本機 dev 才顯示模擬工具。設定及真機案例見後端 docs/whatsapp-integration.md。


## 通訊設定與電話語音

管理員可在「通訊設定」管理 Twilio／WhatsApp 連線，以及粵語、英文模板。電話內容可選本機完整 MP3、Twilio Say 或自備錄音。草稿會自動準備本機 MP3，試聽及修改均為可選；按一次「發送邀請」才會聯絡員工。邀請按完整講稿內容快取，確認、取消及按鍵提示使用跨工作共用的固定短句。Azure 設定及生成已移除，歷史已存音檔仍可播放。所有 AMS 時間以香港時間輸入及顯示。員工通知同意只需明確勾選一次，來源、時間和操作人由系統記錄。

Say 可編輯固定字句，動態資料與按鍵鎖定。自備錄音庫按語言、分類及片段配對，依 Site 時區自動選完整起訖日期時間。使用通用稱呼，手動模式在草稿另上傳補充說明。缺音檔不可發佈，兩種 MP3 模式皆無 Say 後備。接受按1、拒絕按2、重聽按9。儲存後只影響新工作，已發邀請及跟進保留原內容。

Token／key 儲存後不回傳，留白保留。公開回調網址前綴只填 ngrok HTTPS 網域，不加 /api 或 DTMF 路徑。現有電話保留原內容快照；舊 mock 工作不會因啟用真實模式而發真實通知。操作見後端 docs/ams-channel-settings.md。
