# 單一號碼 AI 電話測試

AMS 的「AI 電話測試」只對管理員顯示。啟用 Twilio 真實電話後，建立一份指定員工、單一名額、只選電話的草稿。該員工的手機須符合伺服器指定的測試號碼。候選人按工作流程接單會在 AMS 建立確認分配，所以請用專用測試班次。

Workforce 撥號、接收 Twilio 狀態並掛線。接聽後，Workforce 的 WebSocket 在 Twilio 和指定的 ElevenLabs Agent 之間傳送雙向音訊。Agent 唸出位置及香港時間，透過 client tool 請求寫入接受或拒絕。Workforce 核對錄入的明確口頭答覆，並執行既有的名額、截止時間及撞更規則。測試只撥一通電話，同一通內讀出結果。每通設有 90 秒上限。

## 帳戶與伺服器設定

1. 在 ElevenLabs 工作區取得 Agent `agent_3701m7hshn01e7rtqj5np2nn3c85` （Workforce Shift Pilot）的編輯權。Agent 已設為私人。實際接通時需使用可開啟該 Agent 會話的 API key。Twilio 憑證留在 Workforce。
2. 把 Agent 的輸入及輸出音訊設為 `ulaw_8000`。預設粵語，加入英文，允許通話選擇其中一種語言。兩種語言的首句都設為 `{{shift_opening}}`。開啟首句不可打斷，讓電話完整播報工作詳情。Workforce 會把該語言的完整邀請填入這個變數，並在 Agent 預覽使用虛構班次作為預設值。
3. 在 Agent 設定 client tool `record_shift_reply`，設定等待結果。參數只有必填字串 `reply`，值為 `accept` 或 `decline`。開啟音訊、用戶轉錄、打斷及 Agent 回覆完成等 client events。
4. 在 Agent 的 prompt 加上工作邀請規則。只在對方清楚回答「翻到」或「翻唔到」後呼叫工具。英文用 “I can work” 或 “I can't work”。含糊、有條件或詢問的句子須重新提問。工具回傳 `accepted`、`declined` 或 `too_late` 後，用當前語言簡短讀出已確認、已記錄拒絕或未能確認班次。工具出錯時請求對方澄清或說明未能確認。讀完結果後等待 Workforce 掛線。
5. 在 ElevenLabs Agent 的 **Advanced → Conversation flow**，把 **Take turn after silence** 設為 **20 秒**。這是沉默多久後讓 Agent 再問一次。停用沉默自動掛線（API 欄位 `silence_end_call_timeout: -1`），並從 Agent 工具停用 **End Call**。Workforce 收到已記錄的結果後，等 Twilio 確認播完回覆才掛線。總通話上限為 90 秒。[ElevenLabs 對話設定](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow) · [End Call 工具](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/end-call)
6. 在部署伺服器的私密 `.env` 加入以下兩行。測試號碼用含國際區號的完整 E.164 格式。

   ```dotenv
   WORKFORCE_ELEVENLABS_API_KEY=
   WORKFORCE_ELEVENLABS_TEST_NUMBER=
   ```

7. 更新 API 與 web 容器。外層反向代理在 `/integrations/twilio/voice/.../stream` 亦須轉送 WebSocket Upgrade。repo 的 web 容器已處理這一段。驗收時可先在本機執行模擬通話測試。

```bash
cd api
TEST_DATABASE_URL='postgresql://user@127.0.0.1:5432/workforce_test' node --test --test-name-pattern='ElevenLabs pilot returns' test/integration/channel-settings.test.js
```

模擬接受案例播完提問後實際等 15 秒，確認兩端仍連線及 AMS 尚無接單，再模擬「翻到」轉錄，核對 AMS 確認分配及播完回覆後掛線。測試使用獨立測試資料庫和模擬 Twilio／ElevenLabs WebSocket。實際通話才會把該通的音訊和工作詳情傳送到 ElevenLabs。Workforce 保存接單結果及稽核紀錄。ElevenLabs 工作區的通話資料保留由其 Agent 設定管理。
