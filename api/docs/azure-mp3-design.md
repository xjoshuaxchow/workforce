# Azure 完整 MP3

使用者選擇 Azure Speech Neural，粵語、英文及普通話採相同流程。每份工作每語言的完整邀請只合成一次，所有接聽者重用。姓名用通用稱呼。完整講稿包含 Site 名稱地址、兩邊日期時間及 UTC 時差、補充說明和 DTMF1/2/9，不拼接日期片段。確認、取消是各自不同的完整講稿，另外生成一次；收妥、無輸入、額滿提示按語言／聲線／文字跨工作共用。

保留現有 Say／手動片段模式，新增 azure-mp3。Azure Key 加密及遮蔽，空白保留；Region 僅允許 Azure 區域代碼，端點固定微軟域名。三語聲線明確對應，內容使用現有固定講稿編輯器，通用稱呼固定。實際生成須使用者在草稿明確按按鈕，不在發佈、worker 或電話回調生成。

方案比較：背景生成工作可跨重啟續辦，但需要額外調度及不確定提交管理。選擇單檔同步生成，先在資料庫原子保留內容雜湊，再離開事務呼叫 Azure，最後將驗證過的 MP3 與 ready 狀態同事務保存。按鈕可依序產生所有缺檔，狀態在重新整理後仍可查。這讓付費動作直接對應使用者操作。

voice_syntheses 記錄 hash、scope、language、purpose、voice、script、狀態、generation、開始時間、設定版本及 immutable asset_id。不儲存 Key。hash 含工作範圍、語言、聲線、格式和實際文字，不含 Key、Region 或員工。使用者要求先私人帳戶測試再換公司帳戶，故僅換 Key／Region 可繼續重用音檔。共用提示使用 shared 範圍。ready 重複生成直接返回原檔；並發 submitting 不再提交。網路／5xx／不完整成功回應列 unknown，不自動重試。401／403／400／429 是明確拒絕，可重新操作。submitting 超過90秒視為待人工確認；重試 unknown 須帶當次 generation，UI 明示可能再次收費，防止重複的重試命令重複扣費。

發佈仍須全部所需語言及跟進檔齊全，凍結 request_voice_plans。回調只有 Play，沒有 Say 後備；設定及 Site 變更不能修改舊工作音檔。WhatsApp-only 只要求電話跟進用途。

尚缺實際 Azure 帳戶／Key，測試只用假 Azure HTTP 回應。不得建立帳戶、產生實際合成、撥電話或變更現有真實配置。UI 提供帳戶設定提示，真機聽感留待 Key 填妥後驗證。
