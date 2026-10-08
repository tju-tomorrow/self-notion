/**
 * 全屏遮罩的**共用形状**（搜索面板 / 设置弹窗 / 确认框三处）。
 *
 * ★ 磨砂留着，但要付得起 —— `backdrop-filter` 的代价是两条：
 *   1. **半径**：Chromium 会为它强制走 `saveLayer`（最贵的 Skia 路径），而且模糊要读邻居像素，
 *      所以任何改动都会把 damage 往外扩（≈ 3×sigma）。半径 4px 扩 12px，2px 只扩 6px。
 *      底色压深一档就够暗了，不用靠半径去"糊"。
 *   2. **底下别放常驻动画**：模糊面一旦被弄脏就是**整屏**重算（Chromium 的 damage 是并集，
 *      屏幕这头动一下、那头就一起重画）。Foundry 那次实测：一整屏 blur 把 4K 下的 58–60fps
 *      打到 18fps。所以宠物那两个 rAF 循环**见到遮罩就停**（`mascot/loop.ts` 认这个类）。
 *
 * 便宜到不要了的退路：删掉 `backdrop-filter`，把底色压到 `rgba(0,0,0,.5)`。
 */
import { style } from '@vanilla-extract/css'

/** 遮罩元素上的**稳定类名**（`style()` 出来的类名是哈希过的，认不出来）。
 *  它只有一个用途：让常驻动画知道"我上面盖了一层"。 */
export const SCRIM = 'sn-scrim'

export const scrim = style({
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.42)',
  backdropFilter: 'blur(2px) saturate(1.05)',
})
