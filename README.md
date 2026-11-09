# Workforce

Workforce 的單一 Git repository，包含管理介面、調度 API 及專用 WhatsApp microservice。三者各自運行，保留各自的 package-lock.json。

```text
ams/                     React 管理介面
api/                     Workforce API、背景任務、SQL 遷移及本機語音工具
whatsapp-microservice/    WhatsApp API、Worker、資料庫及 Docker Compose
deploy/                  部署與資料遷移說明
scripts/                 整套安裝、檢查與驗證入口
```

## 本機開發

使用 Node 26.12.1。從 repository 根目錄執行：

```sh
nvm use
npm run bootstrap
cp api/.env.example api/.env
```

先在 api/.env 設定本機 PostgreSQL、獨立的測試資料庫及管理員帳戶。參照 [API 說明](api/README.md)。沿用既有資料庫時，必須一併帶入原本的設定加密金鑰，詳見 [部署說明](deploy/README.md)。

```sh
npm --prefix api run db:migrate
npm --prefix api run db:seed
npm run dev:api
```

另一個終端執行 `npm run dev:ams`，開啟 http://127.0.0.1:5210。AMS 的 /api、/media 會轉送到 Workforce API 8310。

WhatsApp 參照 [微服務說明](whatsapp-microservice/README.md)，先填私有 `whatsapp-microservice/.env`，再用 `npm run whatsapp:up` 啟動。此入口使用獨立 Compose project name `workforce-whatsapp`，不會沿用舊目錄的 `whatsapp-microservice` 容器與 volumes；主機 8080 須可用。舊微服務已運行時，先按遷移安排處理連接埠及資料，不要同時啟動兩套。取得本專案 API key 用 `npm run whatsapp:key`；上游 README 的直接 Compose 指令預設使用原專案名稱。服務使用主機 8080；Workforce 在主機上運行時，AMS 內的 WhatsApp 服務網址填 `http://127.0.0.1:8080`，API key 使用微服務產生的值。填妥並核對模板前保持模擬模式。

本機語音模型另外安裝：

```sh
cd api
python3 scripts/install-local-tts.py
```

模型、私有設定及已生成音檔不會放入 Git。模型執行環境與伺服器平台有關，應在目標主機安裝。

## 驗證

```sh
npm run check:repository
npm test
npm run build
npm run test:integration
npm run test:e2e
```

`test` 包含根目錄指令隔離檢查、AMS/API 單元測試及 WhatsApp 的三個單元測試檔。API 的部分測試需要監聽本機 HTTP；WhatsApp 單元測試不需要 Meta 憑證。整合測試及瀏覽器測試需要 api/.env 中的本機 TEST_DATABASE_URL，會清空指定的隔離測試庫，兩者須依序執行。WhatsApp 的資料庫整合測試與 smoke 測試另見該服務 README。

## Ubuntu Docker 部署

根目錄 compose.yaml 已提供 AMS 靜態網站、API/背景任務、獨立 PostgreSQL、自動遷移及首次管理員初始化。WhatsApp 與語音安裝按需啟用。詳細步驟見 [部署指南](deploy/README.md)。

```sh
python3 scripts/setup-deploy.py
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8320/health
```

根目錄 .env 由初始化產生且不上 Git；不要只複製範例而留下空密鑰。API 容器不接收初始管理員密碼；帳號在資料庫內，seed 資料只供一次性初始化。第一次建立的是新資料庫，既有 Mac 資料需另外安排遷移。

預設只綁定 127.0.0.1:8320，公開網域、HTTPS 和現有 Nginx 的接入仍需按伺服器配置。初始電話/WhatsApp 保持模擬模式，啟動不會自動發真實通知。

整合前的歷史文件保留當時的專案名稱與本機路徑；日常操作使用本 README 和目前的 `ams/`、`api/` 目錄。

WhatsApp 目錄內的 `.github/workflows` 保留上游內容；GitHub 只會執行 repository 根目錄的 workflows，本次未啟用自動 CI，請使用上述驗證指令。
