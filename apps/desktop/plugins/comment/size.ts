/**
 * 卡片那一栏的尺寸 —— 样式和摆位都要读，所以单独一份（`.css.ts` 里只放样式）。
 *
 * ★ **和编辑器那一侧是同一组数**：`editor-prosemirror/comment.ts` 的 `COMMENT_CARD_W` /
 *   `COMMENT_GAP` 各有一份（插件之间不许互相 import，CONVENTIONS §6.2）——
 *   那边拿它算「够不够浮卡」和「正文让出多少留白」。改要一起改。
 */
export const CARD_W = 260
export const GAP = 16
