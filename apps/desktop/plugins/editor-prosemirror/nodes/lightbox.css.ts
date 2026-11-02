/**
 * 图片灯箱的样式。跟 `nodes.css.ts` 同一套规矩：不吃 `--affine-*`，颜色写死成中性值。
 *
 * 遮罩**不用 `backdrop-filter`** —— 代价写在 `src/ui/scrim.css.ts`：全屏模糊会被任何改动
 * 弄脏成整屏重算，底色压深一档就够暗了。
 */
import { globalStyle } from '@vanilla-extract/css'

globalStyle('.sn-lightbox', {
  position: 'fixed',
  inset: 0,
  // 900 = 全屏查看器那一档（version-history 也是 900），压在搜索 / 设置那些弹窗（1000）底下。
  zIndex: 900,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  background: 'rgba(0, 0, 0, .88)',
  cursor: 'default',
})

globalStyle('.sn-lightbox-img', {
  display: 'block',
  // 正文那条 `max-width: 100%` 不能跟进来 —— 灯箱就是要放大。
  maxWidth: 'none',
  maxHeight: 'none',
  userSelect: 'none',
  cursor: 'grab',
})

globalStyle('.sn-lightbox-img[data-dragging="true"]', { cursor: 'grabbing' })

globalStyle('.sn-lightbox-close', {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: 'rgba(255, 255, 255, .12)',
  color: 'rgba(255, 255, 255, .9)',
  fontSize: 15,
  lineHeight: 1,
  cursor: 'pointer',
})

globalStyle('.sn-lightbox-close:hover', { background: 'rgba(255, 255, 255, .22)' })
