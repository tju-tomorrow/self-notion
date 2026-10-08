/**
 * 出现时那一点点过渡。**全是入场** —— 界面里没有一处「消失动画」：
 * 该走的东西等它淡出，只会让每一次点击都慢半拍。
 *
 * 三条纪律（不然「自然」会变成「卡」）：
 *  1. **短**：160–180ms。超过 200ms 就从「顺滑」变成「磨蹭」。
 *  2. **位移极小**：4px。大了像在滑幻灯片，而且会让眼睛重新找一遍焦点。
 *  3. **别给会被测量的东西加 `transform`**：动画里的 transform 会让那个元素变成新的包含块，
 *     量出来的矩形会挪一帧（编辑器、右侧那些会被 `getBoundingClientRect` 量的面板都用 `fadeIn`）。
 *
 * 系统开了「减弱动态效果」时，这批动画由 `shell.css.ts` 里那条全局规则统一关掉
 * （连同光标闪烁、宠物弹跳）。样式表里的动画自动吃那条规则，`ui/appear.ts` 那条手动判。
 */
import { keyframes, style } from '@vanilla-extract/css'

const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

const rise = keyframes({
  from: { opacity: 0, transform: 'translateY(4px)' },
  to: { opacity: 1, transform: 'none' },
})

const fade = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })

/** 浮层 / 弹窗（⌘K、设置）：从下面轻轻抬上来。 */
export const riseIn = style({ animation: `${rise} 180ms ${EASE} both` })

/** 整页 / 整块换来换去的地方（外壳第一帧、主区在「主页 ↔ 编辑器」之间切）。 */
export const fadeIn = style({ animation: `${fade} 160ms ease-out both` })
