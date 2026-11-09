# 規格補充

## 2026-11-06 Azure 完整 MP3 及私人帳戶測試

使用者改選「每份工作以 AI 生成完整 MP3，所有電話重用」，不需逐段組裝。確認英文亦採相同操作，並委託選擇服務後採用 Azure Speech Neural。支援粵語、英文、普通話；一般稱呼不讀個別員工姓名。邀請、確認、取消各保存一份完整講稿，收妥／無輸入／額滿提示可跨工作共用。固定用詞沿用講稿編輯器。沒有 Azure Key 時可以預覽文字及設定，但不能生成或發佈缺檔工作。

使用者可先用私人 Azure 帳戶的 Speech 資源測試，之後以公司 Key 和 Region 替換。既有 MP3 保存在 Workforce，憑證／Region 更換不觸發重新合成；改動聲線或實際講稿才需要另生成。Key 加密、不回傳原值，空白保留。

生成僅由草稿內明確操作觸發；電話、worker 及回調不生成。內容雜湊去重、並發保留、完整 MP3 驗證、不可覆寫資產及發佈快照保證重播不再次合成。無法確定生成結果時停止自動重試，重試須確認可能再次使用額度或收費。沒有實際帳戶、Key 或合成驗收，不進行真實 Azure 請求或電話。

## 2026-11-06 自備 MP3 片段模式

需求方新增無語音合成的方案，選擇預錄數字、日期、時間及各地點，由系統自動拼接；員工用通用稱呼，補充說明需要時在草稿另外上傳。保留 Say 為另一選項，不自動切換現有真實設定。MP3 模式只 Play，無 Say 後備。錄音庫按語言保存固定提示、年份數字、月份、日期、24 小時、分鐘、UTC 時差及 Site 名稱地址。各片段有錄音範例；不要求一次錄齊全部清單。

開始及結束各讀完整 Site 當地日期時間與時差，含跨午夜、跨年及夏令時間重複時段。發佈事務內檢查合資格候選人的實際邀請及電話跟進需要，缺少錄音回409、保留草稿。WhatsApp-only 邀請只預檢確認／取消／額滿等電話後備，不要求未使用的電話邀請及補充錄音。錄音及設定不可覆寫，發出時保存整套播放計劃，之後配對、Site 資料或封存不改變原調度的電話內容。

實作與操作見 `mp3-clips-design.md`、`mp3-clips-plan.md`、`ams-channel-settings.md`。瀏覽器試聽不會撥電話。自動測試使用假 Twilio；真人錄音品質及實際 Twilio 片段連播仍需另行真機驗收。

## 2026-11-04 固定講稿可編輯

需求方要求可在AMS修正Say固定用詞及錯讀字，動態資料不作人工更改。採用三語、六用途的固定字句編輯，姓名／地點／日期時間／補充說明及DTMF鍵由系統鎖定。沿用admin權限、版本409保護及憑證保存；新邀請套用新講稿，已發邀請及跟進保留原版本。不在本次加入聲線切換或自動真機試撥。

## 2026-11-04 最新決定：改用 Twilio Say

需求方已配置真實 Twilio，明確要求不再上傳錄音，改用 Twilio Say。新電話邀請、按鍵提示、收妥／無輸入／無法接單、接單確認及取消均使用員工的英語／粵語／普通話。後端按 Site 時區產生地點、地址及完整起訖日期時間。DTMF 1／2／9、簽章與 Call SID 驗證沿用。這取代先前禁止 Twilio TTS、強制錄音的決定；不新增其他合成服務。已提交電話保留原內容快照，歷史音檔仍可讀取。

基線為 `docs/specs/` 的 9 份文件。以下是需求方在實作期間確認及更正的補充。2026-11-03 的獨立項目邊界取代之前 Core 接入的解讀。

## 架構與本機環境

- `ns-workforce-api` 與 `ns-workforce-ams` 是獨立項目，不需要接入 Core API 或 Core AMS。Core 入口、SSO、模組 entitlement 及 Core 身份／公司／Site 映射均不列為此任務工作。
- 依基線使用本機 Postgres。現有 MariaDB 不用於本功能；建立專用開發與測試資料庫。
- 2026-11-03 需求方再次澄清：沒有另一個獨立的 Messaging Service。specs 06／07 的名稱實際指 Core 既有 Twilio PSTN 及同事實作的 WhatsApp 能力。Workforce 維持統一 Attempt、Job、事件及渠道 adapter。
- 需求方已選擇「在 Workforce 獨立實作，沿用 Core 做法」。PSTN 直接使用 Twilio SDK，Core 登入／AMS／電話接口均不是執行依賴。預設 mock；測試不發真實電話。WhatsApp 接口已於後續交接資料提供，見下方補充。

## AC-OWN-01 調度管理的班次

需求方已選擇「調度班次先取消再重建；手動班次可直接修改」。

- 由 Request 建立或填入的班次，不可在 Roster API 直接換人、改時段或取消，回 `409`、`reason=request_managed_shift`。
- 仍由 open Request 補位的 open shift，同樣不可直接改動人員／時段或取消。
- 備註可修改。一般手動班次維持原有編輯、警告及通知規則。
- 使用 Request 的取消／移除名額動作保持 Assignment、Shift、名額及通知一致。
- 基線規定 expired Request 不可取消，故已 expired 但保留的接單班次後續如何撤銷，仍需補充規則；目前不允許繞過 Request 修改其分配。

## 尚未關閉的輸入

- FEATURES.md 與原始 Q1–Q8 未提供。
- 本項目維持 specs 的獨立 email／password、admin／site_manager 與 Site 授權。Core 對接不是未完成需求。
- PSTN 真機測試需有效號碼、憑證及公開 HTTPS 回呼；WhatsApp 仍需正式 URL、key 與已批准 HR 模板。

本機可操作閉環不等於 316 個基線 AC 已全部驗收。以 coverage inventory 與測試紀錄核對。

## PSTN 技術狀態補充

在 specs 的 Attempt 狀態外，增加 submitting／submission_unknown 描述尚未取得確定 Call SID 的提交。這些是防重撥的技術狀態，不佔用名額。資訊通知電話結束記為 completed；邀請電話無有效按鍵結束仍是 no_input。明確 429 才安全重試，不把模糊 timeout／5xx 當作未撥出。


## WhatsApp 現有服務呼叫

2026-11-03 需求方提供 live4well-whatsapp-backend-handoff 與 full-handoff，要求只呼叫現有 whatsapp-microservice。Workforce API 直接使用其 Bearer／v1／Idempotency-Key 契約。前端不持有 service key，不引入 gym-aesthetics 的會員／提醒／聊天 package 或 runtime。沒有綜合 Messaging Service；WhatsApp 使用已存在的專用 microservice。

微服務不轉發送達／已讀狀態，且 incoming webhook 只有一個。為保留原 consumer，首版查回訊息 detail 及 scoped inbound history，接受輪詢延遲。原 07 的提案由渠道 adapter 轉換，業務回覆仍走既有統一模型。Meta 模板名稱、語言、BODY 位置參數與 quick-reply indices 必須依批准版本設定。模板建立／批准不由本批處理。

## 禁止 Twilio TTS

2026-11-03，需求方明確要求不能使用 Twilio 自帶 TTS。此限制取代原始 06 英文 TTS 與先前建議的 Twilio Say 路徑。電話改以音檔播放為目標；音檔來源仍待確認，是其他 TTS 服務產生還是完全人工錄音。現有 PSTN voiceTwiml／voiceMessage 尚使用 Say，替換前不能將其作為符合新限制的真實電話功能。維持 mock，不修改或啟用實際服務憑證。

### 語音品質澄清

需求方其後說明 Twilio TTS 效果不理想。將其解讀為不採用 Twilio 語音合成，而不是禁止一切 TTS。其他 TTS 供應商尚未選定；外部服務產生音檔、AMS 試聽後交 Twilio 播放為目前建議，不視為已完成或已選定服務。未購買／設定外部 TTS，語言清單待確認。

### 首版語言

需求方確認首版粵語、普通話、英語。此補充取代原始 P0 只用英文的限制。電話及 WhatsApp 均須依員工語言選擇相應內容；Twilio TTS 禁用，外部 TTS 供應商仍未選定。缺少相應語言內容的處理方式須在新設計中明確定義，不默認已完成多語言。

## 工種排除

2026-11-03，需求方確認工種原文檔沒有描述就不處理。本次不新增工種或可接受工種欄位、資料模型、篩選或候選匹配。維持原始 02、04、05 的員工／調度／班表規則。這項決定關閉先前的工種問題，不列為交付缺口。AMS 渠道設定、粵語／普通話／英語內容與錄音管理要求保留。

## 2026-11-03 通訊設定批次完成

獨立 Workforce AMS 新增 admin「通訊設定」：Twilio／WhatsApp連線、三語六用途模板映射、既有微服務模板CRUD、音檔上傳與試聽。Request草稿保存三語完整邀請／確認／取消錄音；Twilio已移除Say，只Play/Gather。員工語言支援en/yue/zh。工種不新增。

設定加密及版本化，舊mock工作保持mock，舊調度固定內容、帳號／origin與語言；同帳號／同服務的Token/key更新供歷史工作使用。真實電話預檢在發送事務內依實際合資格選中候選人執行，並要求撤回WhatsApp同意所需fallback錄音。封存保留舊工作播放，不能新選。原.env僅首次bootstrap；資料庫已有版本時不再解析過時供應商環境變數。

驗證：後端35單元／129整合，AMS7單元／18瀏覽器及build通過；補充解除Site關聯案例後21個channel-settings案例再驗通過。一次fresh覆查的7項Important及1項原Minor均已修正並回歸；MP3完整性由Minor升級Important，因損壞音檔可能導致真實電話無聲。未defer。操作見ams-channel-settings.md，人工19項見ams-channel-settings-testcases.md，人工結果全部保留未執行。外部TTS未選定、未接入，真實電話／WhatsApp／Meta模板未驗收。預設保持mock，不修改Core，不stage／commit／push。

