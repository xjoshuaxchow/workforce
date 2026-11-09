# Workforce API 本機開發

這是新的 HR 員工調度與排班後端，使用 Node 26 與 Postgres。需求基線在 `docs/specs/`，實作期間的確認在 `docs/spec-addendum.md`。

目前可本機操作登入、角色／Site 權限、員工與 Site、CSV 與關聯、排班、調度、模擬回覆、名額與班次分配及通知工作。這是可試用的本機版本，尚未完成全部 316 項 AC，真實 PSTN 已有可切換的 Twilio adapter；本機預設 mock，WhatsApp 現有可設定的 microservice adapter，真實環境尚待配置與試發。

## 啟動

首次取回專案請先按根目錄 [README](../README.md) 安裝依賴、複製 `.env.example`，設定自己的私有 `.env`、PostgreSQL 開發資料庫及隔離測試資料庫。`.env` 不進 Git；不要將現有正式資料庫用於自動測試。

```sh
cd api
nvm use
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

後端位於 `http://127.0.0.1:8310`，健康檢查為 `/health`。前端另在旁邊的 `ams/` 啟動。

本機登入電郵為 `admin@workforce.local`，密碼查看私有 `.env` 的 `SEED_ADMIN_PASSWORD`。Seed 不覆蓋已存在帳戶的密碼，也不建立預設員工或 Site。

若 Postgres 停止，可先檢查並啟動本機已安裝的服務：

```sh
pg_isready -h 127.0.0.1 -p 5432
pg_ctl -D /opt/homebrew/var/postgresql@18 -l /private/tmp/workforce-postgres.log -o '-h 127.0.0.1 -p 5432' start
```

## 本機操作順序

1. 建立 Site，填入 IANA 時區。
2. 建立員工與電話號碼；若使用 WhatsApp，填妥 opt-in 與來源。
3. 在 Site 的「管理員工」建立關聯。
4. 建立調度草稿，檢查候選人，確認發送。
5. 開啟詳情底部的本機測試工具，模擬接受／拒絕／未接。看板每 3 秒輪詢；名額滿後停止未發邀請。
6. 到班表核對 confirmed shift。也可先建 open shifts，選相同時段缺額後 Find staff。

`MESSAGING_MODE=mock` 為預設。管理員可透過 `/api/mock/config` 設定下一批結果為 `202`、`400`、`503` 或 `timeout`，以 `/api/mock/sent` 查看模擬發送；`/api/mock/reset` 只重設模擬服務記錄。

## AMS 通訊設定

管理員登入後選「通訊設定」，可管理 Twilio／WhatsApp 連線、英語／粵語／普通話模板映射及三語電話語音。設定以加密版本儲存，敏感 Token／key 儲存後不回傳瀏覽器。首次從 .env bootstrap；之後以 AMS 保存版本為準，無須重啟。

2026-11-06 需求方試聽後改用本機 VITS 粵語及 Piper 英語。每份工作、每語言、每用途生成一份完整 MP3，通用回覆提示跨工作共用，所有電話重用已存音檔。到「通訊設定 → 電話語音」選「本機生成完整 MP3（粵語／英語）」，儲存後在調度草稿生成及試聽，音檔齊備才可發佈。DTMF 1／2／9 沿用，無 Say／Azure 後備。普通話仍保留原有業務設定，但本機模式不支援普通話員工。

安裝本機語音只需在後端執行 `python3 scripts/install-local-tts.py`，套件及模型放在 `.local/onnx-tts`，不改全域 Python；安裝時需要網路，生成時不呼叫雲端語音。需 Python 3.9+ 與可用的對應平台二進位套件。固定 sherpa-onnx/core 1.12.35、NumPy 2.0.2、lameenc 1.8.1、OpenCC 0.1.7，勿直接升級至已移除內置 Piper 音素前端的 sherpa 2。這台 arm64 Mac 實測約 306 MB，其他平台可能不同。可用 `node scripts/local-tts-samples.js` 重新產生兩語本機 MP3 試聽。

粵語講稿內的英文詞組由 Piper 朗讀，與 VITS 粵語合成同一個 MP3，中英聲線不同。Site 可填英文朗讀名稱及地址，原資料保留；草稿可獨立選擇粵語或英語試聽，員工與實際發送語言仍按原設定。修改後的草稿須重新生成相應 MP3，已發工作保留原音檔。此更新需執行 SQL013 遷移。

草稿每段音檔旁的「修改這段講稿」可由用戶自行調整固定用詞，儲存並只生成該段，其他 MP3 保留。地點、日期時間、補充說明及 DTMF 數字由系統填入。修改只影響本工作，可恢復預設並重用原錄音；已發佈工作保持原快照。

WhatsApp 仍由 Workforce 後端呼叫既有 microservice，AMS 可查模板、建立／修改／刪除支援的純文字模板，再設定三語各六用途對應。真實發送前核對 Meta 核准狀態及參數／按鈕，前端不持有服務 key。

舊 Attempt 與原調度跟進保留原設定版本，mock 工作不會因模式切換而轉為付費發送。舊頁面寫入與同時編輯設定有版本409保護。歷史 Call SID／訊息保持其來源與內容快照。

完整設定與 key 備份操作見 [ams-channel-settings.md](docs/ams-channel-settings.md)，人工驗收見 [ams-channel-settings-testcases.md](docs/ams-channel-settings-testcases.md)。Azure、Say 及自備錄音仍可選擇，歷史工作保留原設定。

預設仍 mock；真實測試另需服務憑證、Meta 核准模板、專用接收號碼與 Twilio 可存取的公開 HTTPS 回調／音檔網址。既有 .env 私有密碼不變。金鑰在 WORKFORCE_SETTINGS_KEY 或 .local/settings.key，還原 DB 時需保留原金鑰。

## 驗證

```sh
npm test
npm run test:integration
npm run specs:coverage
```

整合測試只允許 loopback 上名稱以 `_test` 結尾的獨立資料庫，會清空該測試庫內的業務資料。不要改成開發庫或正式庫。前端 E2E 也使用同一測試庫，請依序執行，不與後端整合測試並行。

`docs/acceptance-inventory.json` 盤點全部基線 AC 及測試名稱中的引用。它不是通過報告；一個測試提到 AC 不代表已完整覆蓋該 AC 的每項前提及結果。

## 主要程式

- `src/app.js`：HTTP、登入、使用者與基本管理入口。
- `src/management.js`：CSV 匯入與管理補充接口。
- `src/roster.js`：班次、重疊保護、發布及變更通知。
- `src/dispatch.js`：候選人、Request、接受交易、取消及名額。
- `src/outbox.js`：持久 Attempt 與 Job 建立。
- `src/messaging.js`：渠道預備、mock、簽章事件、原始接收、去重及工作執行。
- `src/twilio-pstn.js`、`src/pstn-adapter.js`：Twilio SDK、驗章、持久提交、TwiML、回調及取消。
- `src/whatsapp-client.js`、`src/whatsapp-adapter.js`：微服務 HTTP、模板映射、固定快照／key、狀態與回覆查詢。
- `src/worker.js`：發送／期限工作與每 5 分鐘完成班次；重啟後繼續到期工作。
- `sql/`：可重跑 migration；班次重疊由 Postgres exclusion constraint 作最後保護。

## 待接入與待完成

- WhatsApp 呼叫契約已由交接程式確認並完成 adapter；正式 service URL、API key、HR Meta 核准模板與真機送達仍待配置／驗收。沒有綜合 Messaging Service 執行依賴，WhatsApp 使用專用 microservice。
- PSTN 真機試撥、外部 HTTPS 回調和目的地權限尚待配置與驗收。Workforce 直接使用 Twilio SDK，沒有 Core runtime 依賴。
- 逐一補齊 316 項 AC 的完整測試證據、邊界和畫面細節。
- mock 重試與 PSTN 不同。mock 的 503／timeout 仍測試 5 秒／30 秒／2 分鐘 backoff；PSTN 不明提交不重撥，依持久記錄及回調恢復，不能把 correlation_id 當作 Twilio 保證的冪等鍵。
- 已 expired Request 保留的接單班次如何撤銷，需補充規則。其餘未定義事項見規格補充與 progress ledger。

尚未部署、發送真實通知或提交 Git。

## 獨立項目邊界

2026-11-03 需求方更正：Workforce 不接入 Core API 或 Core AMS。前端、後端、登入、角色與 Site 資料都由本項目管理。先前加入 Core 的入口已撤回，Core SSO、模組開關及身份對照不列為待辦。架構見 `docs/architecture.md`，修訂計劃見 `docs/implementation-plan.md`。

## 2026-11-03 本機缺口修正

已補上員工頁直接邀請、各渠道首次回覆收到時間、完整清單搜尋與分頁、Request 修改回 409、Audit 實體篩選及表單時間提示。回歸驗證：後端 21 unit／72 integration，前端 6 unit／10 E2E，AMS 建置通過。這是 PSTN 前一批驗證紀錄；目前預設仍是 mock，PSTN 本批結果見專項計劃。完整人工驗收仍待簽收。詳情見後端 docs/review-local.md。
