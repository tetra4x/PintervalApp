# Pinterval

Pinterestの画像を指定間隔で連続表示するシンプルな Web アプリです。  
左（設定）/ 中央（ビューワ）/ 右（カウントダウン＆履歴）の 3 カラム構成。  
状態は **スタンバイ** と **プレイ** の 2 つです。

## 主な機能

- 「テーマ」テキスト（Pinterest 検索ワード）
- 「表示間隔」プルダウン（10 / 15 / 20 / 30 / 40 / 50 / 60 / 90 / 120 / 180 秒）
- 「表示回数カウンター」自動加算（ユーザー操作不可）
- ビューワ中央下部に **再生/一時停止**・**停止**・**次へ** ボタン  
  （YouTube 風の UI で、ビューワにホバーしたときのみ不透明になります）
- 右カラム
  - 次の画像までのカウントダウン表示
  - これまで表示した画像のサムネイル一覧（最大 90 件）
  - 履歴はブラウザの Web ストレージ（`localStorage`）に保存され、再読み込み後も右カラムから参照可能
- ステート管理
  - **スタンバイ**：初期状態。左カラムの各種入力は操作可能。
  - **プレイ**：画像を自動スライドショー。左カラムは操作不可（自動で disabled）。

## 技術構成

- フロントエンド（`public/`）
  - プレーン HTML / CSS / JavaScript（ES モジュール）
  - シンプルなイベントバス（`eventBus.js`）で UI のイベントをフェーズ／優先度付きで制御
  - `app.js` で状態管理（mode / items / history / countdown など）と DOM 更新を実装
  - 再生履歴は `localStorage("pinterval:history")` に保存・読み込み

- サーバ（`server/`）
  - Node.js 18+ / Express
  - `index.js`
    - 静的ファイルの配信
    - `/api/search` エンドポイント
      - Pinterest 公式 REST API v5 の検索 API（`GET https://api.pinterest.com/v5/search/pins`）を呼び出して Pin を検索
      - レスポンスの `items` から `{ id, title, link, image }` 形式に正規化してフロントエンドに返却
      - 1 プロセス内で簡易キャッシュ（クエリ＋件数単位）を利用
      - `USE_MOCK=1` のときはネットワークアクセスを行わず `public/mock/sample.json` を返却

### 環境変数

- `PINTEREST_ACCESS_TOKEN`  
  Pinterest API v5 の OAuth2 アクセストークン。  
  Pinterest ビジネスアカウント + Developer Platform でアプリを作成し、OAuth 2.0 フローで
  `pins:read` など必要なスコープを付与したトークンを取得して設定してください。

- `USE_MOCK`（任意）  
  `1` をセットすると Pinterest API を呼び出さず、同梱のサンプル画像（Unsplash）だけで動作します。  
  例：`USE_MOCK=1 node server/index.js`

## 起動方法

```bash
npm install

# 開発モード（ポート 5173）
PINTEREST_ACCESS_TOKEN=xxx node server/index.js --dev

# 本番モード（ポート 3000）
PINTEREST_ACCESS_TOKEN=xxx node server/index.js
```

※ Pinterest API を使わず動作確認したい場合は `USE_MOCK=1` を付けてください。

## 注意事項

- 本アプリは Pinterest 公式 REST API v5 を利用する前提です。
  利用には Pinterest のビジネスアカウント作成・アプリ登録・OAuth2 によるアクセストークン取得が必要です。
- Pinterest の利用規約および Developer ポリシーに従ってご利用ください。
  コンテンツの取り扱い・保存・再配布などは必ず自社のポリシーとあわせて確認してください。
- 画像の著作権は各権利者に帰属します。本アプリは閲覧用途での利用を想定しています。

## ライセンス

MIT
