# Ubuntu Docker 部署

目標為 Ubuntu x86_64、Docker Compose 2.33+。新專案名稱為 workforce，與既有 whatsapp-microservice 容器和 volumes 分開。只公開伺服器 loopback 的 8320，避開現有 80/443/8080/8085。這一階段先讓網站及 API 運行；正式網域與 HTTPS 稍後接到現有網站入口。

## 先啟動 AMS、API 及資料庫

在伺服器的 joshuachow 帳戶：

```sh
cd ~/workforce
git pull
python3 scripts/setup-deploy.py
sudo docker compose up -d --build
sudo docker compose ps
curl -fsS http://127.0.0.1:8320/health
```

設定產生器建立權限 0600 的根目錄 .env，產生獨立的資料庫密碼、設定加密金鑰、訊息簽章秘密、首次管理員密碼及 WhatsApp Verify Token。重跑會保留已有檔案，不會輪換金鑰。自行查看/編輯 .env 取得首次登入資料，不要把它或 docker compose config 的完整輸出貼到聊天。

初始化會自動建立 PostgreSQL 的 workforce 資料庫、執行 SQL 遷移及建立管理員。帳號和 scrypt 密碼雜湊在 users 資料表，登入不依賴 seed 欄位。首次登入確認後，可將 SEED_ADMIN_EMAIL 和 SEED_ADMIN_PASSWORD 兩欄清空。之後重跑 init 保留既有帳號，不會重設密碼/權限；若沒有現存管理員，仍須先提供初始資料。

第一次是全新的伺服器資料庫，並不自動帶入 Mac 員工/工作。不要將本機 .env 直接覆蓋到這裡，容器內的資料庫主機名與主機安裝的 PostgreSQL 不同。若要遷移既有資料，需另排備份/還原與停用舊 Worker 的切換流程，並保留原設定加密金鑰。

網站只供伺服器本機存取。要先在電腦看畫面，可於電腦另一個終端以你原本的 SSH 連線方式加上轉送：

```sh
ssh -L 8320:127.0.0.1:8320 joshuachow@你的伺服器SSH位址
```

然後開啟 http://127.0.0.1:8320。未提供網域時保持 AMS_ORIGIN=http://127.0.0.1:8320。不要為此新增 public 80/443 綁定去取代已有 nginx。

## 安裝本機粵語及英文

初次啟動可先登入和管理資料；安裝語音模型另外執行一次：

```sh
sudo docker compose run --rm speech-install
```

安裝使用 Linux Python、已固定版本及校驗模型，不移用 Mac 的 venv。模型放在本專案的 speech_runtime volume；之後重建 API 不必重新下載。安裝完成回 AMS 重新檢查語音。首次安裝要能連網，並會使用 CPU/記憶體，宜避開這台共用伺服器的繁忙時段。

## 啟動 Workforce 專用 WhatsApp

在根目錄 .env 填好 META_APP_ID、META_APP_SECRET、META_GRAPH_API_VERSION、WHATSAPP_BUSINESS_ACCOUNT_ID、WHATSAPP_PHONE_NUMBER_ID、WHATSAPP_ACCESS_TOKEN、WHATSAPP_WEBHOOK_VERIFY_TOKEN。Verify Token 可自行產生，但要和同事在對應 Meta webhook 填的值一致；若已交付一個值，請沿用它。

```sh
sudo docker compose --profile whatsapp up -d --build
sudo docker compose --profile whatsapp ps
```

這會建立自己的 whatsapp-api、worker、PostgreSQL 及 volumes，不使用伺服器既有的 8085 服務。微服務不發布主機連接埠，API 與 Worker 可由 Docker 內網互通。新的公開 webhook 路徑保留為 /webhooks/whatsapp；在 HTTPS 入口配置好前，不交給 Meta 作正式回調。

取得這一套微服務的 API key，在自己的終端查看：

```sh
sudo docker compose exec whatsapp-api node dist/cli.js api-key
```

在 AMS 設定 WhatsApp 服務網址為 http://whatsapp-api:3000，填入此 API key、核對已批准模板及按鈕。確認目標號碼和 Meta App 是為這份部署安排後才啟用真實發送。預設部署保持電話/WhatsApp 模擬模式，不會因容器啟動自動啟用真實渠道。INBOUND_WEBHOOK_URL 與 INBOUND_WEBHOOK_SECRET 不需要填，Workforce 定時讀取回覆。

根目錄的 npm run whatsapp:up/key 保留為獨立微服務的本機開發入口。正式整套部署一律使用本節根目錄的 docker compose 指令，不混用舊的微服務目錄 Compose。

## 持久資料及更新

- workforce_database：員工、工作、加密通訊設定與已生成語音資料。
- speech_runtime：Linux 語音執行環境及模型。
- whatsapp_database、whatsapp_config、whatsapp_media：WhatsApp 訊息、私有 API key/資料庫密碼及媒體。
- 根目錄私有 .env 中的 WORKFORCE_SETTINGS_KEY 必須連同資料庫保存；換掉它會無法讀取既有通訊設定。

更新程式：git pull 後，再執行之前使用的 compose up -d --build 指令，啟用 WhatsApp 的部署需保留 --profile whatsapp。一般停止用 docker compose --profile whatsapp down，保留 volumes；不要附加 -v，避免刪除資料。

以現有 Nginx 建立正式 HTTPS 入口時，將 AMS 的 /、API 的 /api/、訊息/電話回調 /integrations/、音檔 /media/ 及 /webhooks/whatsapp 一併轉送到本專案 web。既有 Nginx 若本身也在 Docker 中，127.0.0.1 指向它自己，需按實際網路加入共用代理網路或設定可到達的上游；確認網域與現有 Nginx 網路後再配置。此步不自動修改現有 Nginx、防火牆、DNS 或憑證。公開網址確定後，更新 AMS_ORIGIN 及 AMS 中 Twilio 的公開回調基底並核對 MP3 存取。

## 可以傳給公司管理員

請替 Workforce 分配一個子網域並指向這台 testing server 的 HTTPS 入口，配置 TLS 憑證及現有 Nginx 轉送至新 Workforce web。AMS/API 透過相同入口使用；Meta webhook /webhooks/whatsapp、Twilio 回調 /integrations/twilio/ 及音檔 /media/voice/ 需供外部存取。資料庫與 WhatsApp /v1 API 保持 Docker 內網，不新增公網資料庫或 API 專用連接埠。現有 Nginx 本身是容器，請協調它與新 web 的 Docker 網路，上游不能直接使用該容器自己的127.0.0.1。
