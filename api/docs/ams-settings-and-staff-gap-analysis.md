# AMS 渠道設定、多語言、錄音與工種差異核對

> 最新狀態：以下早期差異表保留為歷史設計輸入。AMS通訊設定、三語模板／錄音及Twilio純播放已實作，操作以 [ams-channel-settings.md](ams-channel-settings.md) 為準。需求方已確認不接入外部TTS，使用上傳錄音；工種明確排除。下文TTS候選及待確認描述是歷史記錄，已被此決定取代。

2026-11-03。需求方要求在 Workforce AMS 增加 WhatsApp 和 Twilio 設定、多語言 WhatsApp、不同語言／不同錄音撥打，並核對員工及可接受工種。這是新增補充，不改寫九份原始 specs。下列「建議」尚不是已實作功能。

## 原始 specs 與目前程式

| 項目 | 原始文件 | 目前實作 |
|---|---|---|
| 員工基本資料 | 02-staff.md:7–15 列 name、mobile、landline、language、preferred_channel、status、whatsapp_opt_in、whatsapp_opt_in_at、whatsapp_opt_in_source | 表單已有可輸入欄位；同意時間由系統記錄 |
| 工種／可接受工種 | 02-staff.md 未定義，其他八份也沒有職種模型 | 沒有工種欄位或關聯 |
| 調度工種 | 04-requests.md:7–15 未定義 job title | 沒有按工種匹配 |
| 候選匹配 | 04-requests.md:75–79：Site 關聯、active、渠道可聯絡、無班次重疊 | 已按上述規則，不含工種 |
| 語言 | 員工有 ISO639-1 language，但 06 的 W-01/V-01 指定 P0 en | 英文內容；Twilio 固定 en-GB，WhatsApp 每類業務一個已設定語言；未依員工自動分流 |
| 電話內容 | 06:94–104 定義英文 TTS | Gather／Say，沒有錄音上傳、選擇或試聽 |
| WhatsApp 模板管理 | HR specs 定義訊息模板；交接的 gym-aesthetics AMS 另有 templates 頁 | Workforce 只有 server adapter 與 JSON 映射，沒有管理頁 |
| 渠道連線設定 | HR specs 未定義 AMS 設定頁 | 目前均由後端 .env 設定 |

早期 user flow 提過 Job Title；需求方後來指定以較新九份 specs 為主，所以當時未將早期欄位另行加進資料模型。需求方現在重新提出，應作新的明確需求補充。不能把既有 316 AC 的測試引用當作本次新功能已涵蓋。

## WHATSAPP_* 值目前在哪裡

Workforce 後端根目錄 /Users/joshua/ns-workforce-api/.env。npm run dev／start 由 Node --env-file-if-exists=.env 載入。.env.example 是設定範例，不是私有設定值。

- WHATSAPP_MODE：mock 為本機模擬，service 才呼叫現有微服務。未設定時預設 mock。
- WHATSAPP_SERVICE_URL：既有 WhatsApp microservice origin，不加 /v1。來源是服務部署地址；不是 AMS5210 或 Workforce API8310。交接 Compose 的預設 host port 是8080，只有服務真的在本機啟動時才可填 http://127.0.0.1:8080。
- WHATSAPP_SERVICE_API_KEY：該微服務的 Bearer API key，由服務管理者提供。交接 CLI api-key 會讀取既有 service-config/api-key；不等於 Meta Access Token 或 Twilio Token。這次沒有執行 CLI、讀取真 key、部署或連線服務。
- WHATSAPP_TEMPLATES_FILE：目前 HR 名稱／語言／變數及按鈕映射 JSON。之後需由 AMS 業務設定取代人工改 JSON。

## AMS 擴充方向

需求方已要求補設定。建議延續獨立 Workforce API／AMS，透過既有 WhatsApp microservice 管理模板，Twilio 由 Workforce adapter 執行。

1. 管理員渠道設定：Twilio／WhatsApp 啟用模式、連線配置及狀態。敏感 Token／API key 只供後端使用，前端只顯示是否已設定及遮罩；與已存在的兩渠道模式變更保護保持一致。具體保存／套用方式需在設計中定義，不能讓表單看似儲存但仍只有 .env 生效。
2. 語言與內容：員工偏好語言；依語言及業務用途選 WhatsApp 核准模板和變數／按鈕映射；電話內容可管理、試聽及選擇。邀請、按鍵提示、無輸入、拒絕／收妥、確認、額滿、取消都需使用一致語言。不能只翻譯邀請。
3. 語音方案需確認：共用錄音提示加動態班次內容、每次調度完整錄音，或兩種都支援。地點／日期／時間變動時，固定完整錄音不能自行插入新資料。需求方其後明確禁止使用 Twilio TTS。若允許其他 TTS，可在 Workforce 產生音檔；若全部 TTS 都不可，則使用人工錄音。需求方已澄清主要是 Twilio TTS 聲音效果不理想；其他服務未被禁止，供應商仍待試聽選擇。
4. 工種不納入本次。需求方確認原文件沒有就不用處理；保留原員工欄位、Site 關聯、狀態、渠道可聯絡與班次重疊規則，不新增職種目錄、員工可接工種或調度工種篩選。
5. 語言資料須支援區分粵語、普通話等實際需求；原 ISO639-1 的 zh 無法表達所有變體。應建立內部語言設定與各渠道 provider code 的映射，避免直接把 Twilio code 當作 Meta template language。

## 尚待答覆

- 錄音採共用提示加動態內容、每次完整錄音，或兩者都需支援？

工種問題已由需求方關閉並排除。本文是差異核對和設計輸入，不代表設定頁或多語言功能已實作。現有 runtime 仍為 mock，沒有變更私有憑證、發送真實通知或提交 Git。

## 2026-11-03 最新語音限制

需求方明確表示「不能用 Twilio 本身的 TTS」。撤回以 Twilio Say 合成動態班次內容的建議。Twilio 僅作電話傳輸、播放既有音檔及 DTMF；此處是目標設計，現有 Say 程式仍待替換。

已詢問限制只針對 Twilio TTS，還是所有 TTS。前者可由其他語音服務先產生音檔再播放；後者需選每次完整人工錄音，或人工預錄日期／時間／地點片段再組合。不能默認某種音檔產生方式已獲確認。現有 mock 設定不變。

## TTS 效果澄清與方案候選

需求方補充「twilio 的tts 效果不理想」，因此限制針對 Twilio 合成聲音的品質，不擴大解讀為禁止全部 TTS。電話仍以播放音檔為目標。建議由外部服務先合成整段音檔，在 AMS 試聽、確認後保存；Twilio 撥號時播放同一份音檔並收集按鍵，不再用 Say 即時合成。也保留人工上傳錄音。這是待定設計，尚未新增外部 TTS 呼叫。

可試聽候選為 Azure Speech 與 Google Cloud TTS，官方都列有香港粵語聲線；不能只靠服務名稱保證聲音好，需用同一份包含日期、跨午夜時間、地址及按鍵提示的腳本比較。未啟用付費服務或產生試聽音檔。需求方已確認首批語言為粵語、普通話、英語；需求方已確認工種不納入本次。

來源：https://learn.microsoft.com/azure/cognitive-services/speech-service/language-support?tabs=tts 、https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=en

## 首版語言已確認

需求方確認先支援粵語、普通話、英語。每種語言需分別管理電話邀請／按鍵及結果提示、WhatsApp 各業務模板。電話採預先產生或上傳的音檔，Twilio 僅播放及收鍵；不採 Twilio TTS。員工語言、各語音服務 code 及 Meta template language 應分開映射。聲線與合成供應商仍需試聽比較，不能宣稱已選定或音質已驗收。

## 工種範圍已關閉

需求方最新確認：「工種文檔沒有講過就不用理會」。工種不是待補功能，也不是待確認項目；不新增員工、調度、班表的工種欄位、管理頁、資料表或匹配規則。上文對原文件缺少工種的核對只保留為查證記錄。後續工作集中 AMS 渠道設定、三語 WhatsApp 模板、電話錄音／外部音檔及試聽。
