# YouTube 英文學習 Chrome Extension 設計規格

日期：2026-08-03  
狀態：已完成需求設計，等待使用者審閱

## 1. 產品目標

建立一個個人自用的 Chrome Extension，協助使用者在觀看 YouTube 英文影片時學習英文。使用者可在 Chrome Side Panel 的字幕面板中反白英文字幕，選擇想查詢的資訊，並直接使用自己的 OpenAI API Key 取得回答。

第一版的核心價值是：使用者可以針對同一段字幕，自由選擇翻譯、單字、文法、同義詞／反義詞或自訂問題，而不是被固定的單一翻譯流程限制。

## 2. MVP 範圍

### 包含

- Chrome Extension Manifest V3。
- Chrome Side Panel。
- 一般 YouTube 影片的英文人工字幕與英文自動產生字幕。
- 顯示完整字幕並依照影片播放時間同步高亮目前句子。
- 在 Side Panel 字幕文字中反白選取。
- 反白後顯示查詢 MENU，但不自動呼叫 API。
- 「翻譯整句」作為主要快捷功能。
- 其他快捷功能：解釋選取文字、文法分析、同義詞／反義詞、更自然的英文說法、自訂提問、收藏。
- 將使用者反白文字、所在完整句子與設定允許的前後字幕作為查詢資料。
- 使用者自行輸入 OpenAI API Key，直接從 extension 呼叫 OpenAI API。
- 設定頁：API Key、模型、回答語言、回答詳細程度、上下文數量、字體大小、文字顏色、目前句子高亮顏色、自動跟隨播放位置。
- 查詢歷史與收藏。
- JSON 匯入與匯出。
- 本機錯誤提示與基本查詢狀態。

### 不包含

- YouTube 直播字幕。
- YouTube Shorts。
- 其他網站的字幕。
- 使用者登入與帳號系統。
- 自建後端或集中管理的 API Key。
- 雲端同步。
- 自動複習、測驗與完整間隔學習系統。

## 3. 使用者流程

1. 使用者在 YouTube 開啟影片與 Chrome Side Panel。
2. Extension 取得目前影片的英文字幕與時間軸。
3. Side Panel 顯示字幕，並隨播放進度高亮與滾動目前句子。
4. 使用者在字幕面板中反白文字。
5. Extension 顯示浮動 MENU。
6. 使用者選擇「翻譯整句」、其他快捷功能，或輸入自訂提問。
7. Extension 將查詢類型、反白文字、完整句子與設定允許的上下文交給 OpenAI。
8. 回覆顯示在 Side Panel 中。
9. 查詢內容與回覆保存到本機歷史；使用者可以收藏、刪除或稍後重新查看。

反白文字永遠是主要查詢目標。完整句子與前後字幕只作為輔助上下文，不能取代使用者實際選取的內容。

## 4. 系統架構

### Chrome Side Panel

負責字幕面板、反白行為、查詢 MENU、查詢結果、歷史紀錄入口與設定入口。查詢不在反白瞬間自動發送，只有使用者點擊功能後才執行。

### YouTube content script

負責在 YouTube 頁面取得影片識別資訊、字幕內容與播放時間，並處理影片切換或頁面導航。content script 不接收或保存 API Key。

### Background service worker

負責 Side Panel 與 content script 之間的訊息路由、OpenAI API 請求、查詢狀態與錯誤轉換。API Key 只由 extension 自己的受信任上下文讀取。

### 本機資料層

- `chrome.storage.local`：儲存 API Key 與小型設定。
- IndexedDB：儲存查詢歷史、收藏與完整 OpenAI 回覆。
- JSON：提供使用者主動匯出與匯入的可攜格式。

程式不依賴 Chrome 實際儲存檔案路徑。未來若改成 SQLite、雲端資料庫或其他媒介，只替換資料層實作，不改動 UI 與主要功能。

## 5. OpenAI 查詢設計

每個查詢功能都是一個獨立的查詢意圖與 prompt 模板，至少包含：

- `intent`：例如 `translate_sentence`、`explain_selection`、`grammar`、`synonyms_antonyms`、`natural_rewrite`、`custom`。
- `selectedText`：使用者反白的原文。
- `sentence`：反白文字所在的完整句子。
- `contextBefore` 與 `contextAfter`：設定允許的前後字幕。
- `outputLanguage`：預設繁體中文。
- `detailLevel`：回答詳細程度。
- `customQuestion`：自訂提問時使用。

第一版由 `LLMClient` 封裝 OpenAI 呼叫，模型 ID 由設定提供。API Key 不經過自建伺服器，只從本機直接送往 OpenAI。若沒有 API Key、Key 無效、額度不足、網路失敗或回覆逾時，Side Panel 顯示可理解的錯誤與下一步建議。

## 6. 未來 Harness／Loop Engineering 擴充

第一版只執行單次 LLM 查詢，但架構保留以下抽象層：

- `LLMClient`：替換模型或 API 實作。
- `PromptRegistry`：管理查詢意圖與提示詞模板。
- `ContextBuilder`：統一建立選取文字、句子、字幕上下文與歷史資料。
- `WorkflowRunner`：目前執行一次呼叫，未來可執行多步工作流。
- `Validator`：未來可檢查格式、翻譯品質或文法分析完整性。
- `EventLog`：記錄工作流事件、錯誤與結果，供未來評估與改進。

未來可加入翻譯後文法驗證、多步教學流程、依收藏內容調整解釋、回覆評分與自動改進。多步流程必須有步驟上限、時間上限與 API 呼叫上限，避免無限迴圈與非預期費用。

## 7. 歷史資料

每筆歷史至少保存：

- 唯一識別碼與建立時間。
- YouTube 影片網址、影片 ID、標題與字幕時間位置。
- 使用者反白文字。
- 完整句子與實際送出的上下文。
- 查詢意圖與自訂問題。
- 使用的模型 ID。
- OpenAI 回覆。
- 收藏狀態。

歷史頁支援依影片、日期與收藏狀態查看，並可重新開啟原始影片位置、收藏、刪除與匯出。匯入時需驗證 JSON 結構，避免損壞資料寫入資料庫。

## 8. 失敗與邊界狀況

- 尚未開啟 YouTube 影片：Side Panel 顯示操作提示。
- 找不到字幕：提示使用者開啟英文字幕或切換支援的影片。
- 影片沒有英文字幕：不嘗試將其他語言誤判為英文。
- YouTube 切換影片：清理舊字幕並重新載入新影片。
- 字幕載入中：顯示載入狀態，不允許提交未完成的查詢。
- API Key 錯誤：提供前往設定頁的入口。
- OpenAI 回覆失敗：保留使用者反白內容，允許重試。
- IndexedDB 寫入失敗：仍顯示查詢結果，並告知歷史未保存。
- Side Panel 關閉：不取消已完成的歷史資料；未完成查詢可在重新開啟後視情況恢復或標記為中斷。

## 9. 驗證計畫

### 單元測試

- 字幕資料解析與時間排序。
- ContextBuilder 的反白文字、完整句子與上下文組合。
- PromptRegistry 的各查詢意圖輸入輸出。
- IndexedDB repository 的新增、讀取、更新、刪除與收藏。
- JSON 匯入／匯出與資料驗證。

### 整合測試

- content script、service worker 與 Side Panel 的訊息傳遞。
- 使用模擬 OpenAI 回覆測試成功、逾時、無效 Key 與額度不足。
- YouTube 切換影片後字幕與播放同步狀態能重置。

### 手動驗收

- 一般人工英文字幕影片。
- 英文自動產生字幕影片。
- 無字幕影片。
- 反白單字、片語與整句。
- 翻譯、文法、單字解釋、自訂提問與收藏。
- 設定修改、API Key 清除、歷史刪除、JSON 備份與還原。
- 影片播放、暫停、跳轉與切換影片時的同步行為。

## 10. 成功標準

MVP 完成時，使用者應能在支援的 YouTube 英文影片中：

1. 開啟 Chrome Side Panel 並看到同步字幕。
2. 反白字幕文字並看到查詢 MENU。
3. 手動選擇翻譯、文法、單字或自訂問題。
4. 看到使用反白文字與上下文產生的 OpenAI 回覆。
5. 在本機歷史中重新查看與收藏結果。
6. 匯出與匯入自己的查詢資料。

