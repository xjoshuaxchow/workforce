# 部署與資料遷移

## 目前可用的內容

本 repository 匯集 AMS、Workforce API 與 WhatsApp microservice。微服務的 Dockerfile、Compose、API/Worker 及 SQL 遷移保留在自己的目錄。正式的一鍵整套部署入口尚未配置；需先確認伺服器系統、CPU、Docker 及網域。

建議同一台伺服器運行三個服務，由 HTTPS 反向代理提供 AMS 靜態檔、Workforce 的 /api 及 /media，以及 WhatsApp 的 /webhooks/whatsapp。AMS 執行 `npm run build` 後使用 dist 靜態產物；開發用 Vite proxy 不會自動成為正式代理。跨容器呼叫需用容器服務名稱，不能沿用主機的 127.0.0.1。

## 另外準備並保存

- api/.env、whatsapp-microservice/.env：在目標機器私下配置，或安全移轉現有值。
- Workforce PostgreSQL 資料庫：包含工作、員工、設定版本和已保存錄音資料；先備份，目標機器執行版本遷移。
- Workforce 設定加密金鑰：沿用 WORKFORCE_SETTINGS_KEY 或 api/.local/settings.key，必須與原資料庫一起保存，否則無法解密既有通訊設定。
- 本機語音：在伺服器的 API 目錄重新執行 scripts/install-local-tts.py。不要直接移用 Mac 的 Python 執行環境。
- WhatsApp 的 postgres_data、service_config、media_data volumes：保存訊息、產生的 API key/資料庫密碼及媒體。重建容器時保留 volumes。
- 若歷史人工測試的音檔另有存於檔案系統，另行備份；不提交生成音檔或資料庫備份到 Git。

本 repository 的根目錄啟動指令使用 `workforce-whatsapp` 作為 Compose project name，與舊目錄的 `whatsapp-microservice` 隔離。舊 volumes 不會自動掛到新 stack；正式切換前需另外備份及遷移，並確認主機 8080 未被舊服務佔用。

## 接入檢查順序

1. 建立私有環境設定、資料庫與持久儲存，確認 API 和背景 Worker 健康。
2. 準備 HTTPS 網域及反向代理，核對 AMS 的 /api 和 /media 轉送。
3. 啟動 WhatsApp，取得微服務 API key；在 AMS 設定可到達的服務網址及 key。
4. 將 WhatsApp 的 `https://微服務網域/webhooks/whatsapp` 及同一份 Verify Token 交給 Meta 管理者驗證與訂閱訊息事件。
5. 核對已批准的 WhatsApp 模板名稱、語言、變數及接受/拒絕按鈕，先以明確同意的測試收件人驗收。
6. 更新 AMS 內 Twilio 的公開回調基底網址；核對 DTMF、通話狀態及公開 MP3 都能在新網域存取。

WhatsApp 的 INBOUND_WEBHOOK_URL / INBOUND_WEBHOOK_SECRET 目前保持空白。Workforce 從微服務定時查詢狀態及回覆。
