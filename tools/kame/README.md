# 亀の甲データ（水車選定図）

`src/data/kame/kame_50hz.json`・`kame_60hz.json` が、亀の甲（マニュアル図4.3-8／4.3-9）の枠のデータです。
アプリは `src/lib/kameNoKou.ts` でこれを読み込み、`findKame()` で判定します。

## データの形（schemaVersion 1）
- メタ情報: `id`、`frequency`、`title`、`source`（文書・図・ページ・表）、`version`、`status`（draft / reviewed / standard）、
  `createdAt`、`method`、`accuracy`、`axes`
- `blocks[]`: `id`（`枠番@回転速度`）、`label`（例 F475）、`series`（n_s シリーズの英字）、`d2mm`、`rpm`、
  `vertices`（4頂点 `{q, h}`。順は 上左・上右・下右・下左（時計回り）。q は m³/s、h は m）

形式は `validateKameDataset()` で検査できます（開発時は読み込み時に自動で警告します）。

## データを作り直す（パラメータから）
```bash
python3 tools/kame/generate_kame_dataset.py            # 50Hz・60Hz を生成して src/data/kame/ に出力
python3 tools/kame/generate_kame_dataset.py --check    # 出力済みのJSONと再生成結果の差を確認
```
`params_50hz.json`・`params_60hz.json` に、図の較正値、列の並び（n_s シリーズ × D₂）、回転速度ごとの n₁₁、
存在する枠の一覧（`frames`）が入っています。枠の追加・削除・位置の調整は、ここを直して再生成します。

## 標準化などで枠を再定義するとき
1. `frames`（存在する枠）と `columns`（列の位置）、`n11`（縦の位置）を新しい定義に合わせて直す。
2. 再生成して、`version` と `status` を更新する（`generate_kame_dataset.py` の `dataset()` 内）。
3. 将来 DB（Supabase）に置く場合も、JSON と同じ形のレコードにすれば、`findKame(H, Q, f, tol, blocks)` の
   `blocks` 引数に渡すだけで使えます。
