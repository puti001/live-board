# 即時雙向互動便利貼牆 — GitHub Pages 純靜態版

這個版本**完全不需要後端伺服器、免資料庫、免 Zeabur / Render**，直接上傳到 **GitHub Pages** 即可讓全場學員手機與講師大螢幕即時雙向互動！

## 如何 60 秒內上線到 GitHub Pages

1. 在你的 GitHub 建立一個公開 Repository（例如 `live-board`）。
2. 點選 **uploading an existing file**，把本資料夾內的所有檔案（`index.html`、`join.html`、`styles.css`、`host.js`、`join.js` 與 `vendor/` 資料夾）上傳並 Commit。
3. 到該 Repository 的 **Settings → Pages**：
   - **Source** 選 `Deploy from a branch`
   - **Branch** 選 `main`（`/ (root)`）→ 點 **Save**
4. 等約 30 秒重新整理，打開 `https://<你的帳號>.github.io/<repo名稱>/` 就能直接上台使用！
