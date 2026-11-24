# 給本機 Antigravity 的自動部署任務說明

這個資料夾是已測試完成的 **GitHub Pages 純靜態雙向互動便利貼牆**：
- `index.html`、`host.js`、`styles.css`：講師大螢幕投影端（支援一鍵全螢幕大 QR Code、便利貼飛入、PNG／純文字匯出、推播文字給學員）
- `join.html`、`join.js`：學員手機互動端（接收講師文字一鍵複製、選色送出便利貼）
- `vendor/qrcode.min.js`、`vendor/mqtt.min.js`：已打包好的離線前端依賴（透過 `wss://broker.emqx.io:8084/mqtt` 跨網即時同步）

## 請本機 Antigravity 依序執行以下步驟

1. 在當前資料夾初始化 Git 並建立 **Public** GitHub Repository（例如 `live-board`；若名稱已存在可改為 `live-board-wall`）：
   ```bash
   git init -b main
   git add .
   git commit -m "feat: initial live-board static site for GitHub Pages"
   gh repo create live-board --public --source=. --remote=origin --push
   ```
2. 透過 `gh api` 直接為該 Repository 開啟 GitHub Pages（`main` 分支根目錄 `/`）：
   ```bash
   OWNER=$(gh api user --jq .login)
   gh api -X POST "repos/${OWNER}/live-board/pages" -f "source[branch]=main" -f "source[path]=/"
   ```
3. 等待約 15～30 秒確認 Pages 建置完成並取得正式網址：
   ```bash
   gh api "repos/${OWNER}/live-board/pages" --jq '{status, html_url}'
   ```
4. 測試 `index.html` 與 `join.html` 是否皆回傳 `HTTP 200`，並把最終可直接使用的網址回報給使用者。
