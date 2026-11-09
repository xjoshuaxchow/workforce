# 本機版本驗收紀錄

測試與範圍更新日期：2026-11-03。本文件保留 PSTN 前一批本機 mock 驗收紀錄。後續 PSTN 實作、渠道邊界更正及最新測試請看 pstn-implementation-plan.md、spec-addendum.md 與 progress.md。歷史上的外部 Messaging Service 待辦已由需求方澄清，不再等待另一項目；不代表全部 316 項 AC 已驗收。

## 獨立審查與修正

一次唯讀審查提出六個重要問題，均先用測試重現，再修正：

| 問題 | 修正與驗證 |
|---|---|
| 併發 callback 以舊 snapshot 覆寫 replied | 先鎖 Request，再重讀並鎖 Attempt；以 Postgres 鎖屏障重現 delivered／failed 競爭 |
| 移除名額後舊確認仍待發 | 取消 queued confirmation，worker 再核對 Assignment 是否有效 |
| worker 停機後先發出已逾期邀請 | 發送前在 Request 鎖內判斷期限並 expire；測試跳過截止後再執行工作 |
| draft Find staff 的班次已變動仍可發送 | Send 時鎖定並重驗 Site、時段、status、staff_id 及全部原缺額 |
| Site 變更破壞未來工作 | 有 open Request 不可停用；有未來班次／open Request 不可改時區；建立工作時鎖 Site |
| 切換班表 Site 仍可操作舊資料 | 僅顯示與 Site／週期匹配的資料；載入中清除舊班次及表單；延遲網路測試重現 |

另補上 Site 授權撤銷、解除員工關聯的未來班次警告、WhatsApp 確認地址，以及 mock 的 400／503／timeout 結果與重試時序。

## 本機驗證命令

後端在專用 Postgres 測試庫執行，前端 E2E 與後端整合測試依序執行，不共用同時寫入。

```sh
npm run test:all
```

前端：

```sh
npm test
npm run test:e2e
npm run build
```

最後一輪在 Node 26.12.1 執行：後端單元 21／21、Postgres 整合 72／72；前端單元 6／6、Playwright E2E 10／10；Workforce AMS 建置通過。72 包含 3 個父測試組，不等於 72 項獨立 AC。

2026-11-03 已撤回先前 Core 入口及其四個測試。這是需求範圍更正，不是測試失敗。Core AMS 原有 lockfile 修改與 Core 的 Node 26 工作保持不變。

真實本機服務啟動後，健康檢查、未登入拒絕、seed 帳戶登入、session、登出撤銷、前端 HTTP 200 均已驗證。2026-11-03 應需求方要求保留 8310 API 與 5210 AMS 運行，供手動測試。不要重複啟動相同埠。Postgres 留在本機運行。

重複啟動另重現 Express 5 在 listen 錯誤時仍調用 callback，導致誤印成功並短暫啟動 worker。已改為只在 listening 事件啟動 worker；新增回歸測試先失敗、修正後通過，埠衝突的新程序退出碼為 1。

盤點結果：316 項基線 AC，121 項有測試檔引用、195 項沒有引用，逐項人工簽收為 0。引用不能換算成整項驗收通過，未引用亦不代表沒有實作。

## 尚未驗收

- 公司 Messaging Microservice 的實際 Send API、認證、模板與簽章事件回呼。文件未指定其底層供應商，Workforce 不直接對接 Core Twilio。
- 真實 HTTP 10 秒 timeout、網路失敗後對方已發出的核對，以及跨服務取消。
- Expired Request 保留班次的後續撤銷規則。
- 完整 316 項 AC 的逐項簽收；acceptance-inventory.json 僅是引用盤點。
- I-04 的獨立 mock HTTP Send 契約尚未提供；目前用 in-process mock。Audit 實體篩選與跨 Site 404 已補上並通過測試。

## 本次驗收交付

獨立項目修訂版提供四頁 Excel：範圍核對、48 個優先人工案例、全部 316 項 AC 原文與來源、109 筆自動測試清單（含父測試組）。Core 入口案例與四個測試已移除。人工結果留空，不把自動測試結果代填成需求方簽收。

需需求方決定的項目包括：expired Request 保留班次的撤銷方式；未來班次警告是否涵蓋 draft／published；Site 名稱唯一是否不分大小寫。React Native app、錄音上傳和 3–5 人批次不從舊討論帶入本次新 specs。

Core 的登入、公司／Site 映射、模組開關及入口已排除本項目範圍，不再當作交付缺口。正式訊息依 specs 經 Messaging Service；07 的契約仍須與該團隊確認。

## 2026-11-03 本機缺口修正

- Request PATCH 檢查可見範圍後回 409，測試核對資料和 Audit 沒有副作用。規格未定義的 draft 時段／人數編輯器不另新增，變更以取消再重建處理。
- 員工頁「直接邀請」帶入員工及可用關聯 Site；未關聯啟用 Site 時顯示原因。
- Attempt 新增 response_at，保存每渠道首次有效回覆收到時間，後續不同答覆不改寫首次結果或時間。005 migration 成對回填歷史 response 和時間，並驗證重跑不改變結果。
- 選擇器完整跟隨 API 分頁載入，再以每頁 50 筆搜尋／選取。以超過 200 名員工及 Site 的實際測試資料驗證。
- Audit 可用 entity_type 與 entity_id 配對篩選；無權限實體回 404，參數不完整或非法 ID 回 400。
- 結束時間不晚於開始時，表單即時顯示錯誤並禁止建立草稿。
- 一次唯讀審查指出搜尋框消失、儲存錯誤不能重試、歷史回覆配對不一致，均先重現 RED 再修正為 GREEN。整體回歸另重現並修正重選相同 Site 清空班表。
- 各瀏覽器案例獨立初始化 workforce_test，避免大名單影響其他案例。開發 workforce_local 保留不重設。

本批原列缺口已修正，不代表全部 316 AC 已由需求方簽收；正式 Messaging Service、完整人工驗收及原有未定需求仍待後續。
