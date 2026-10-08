/** `templateButton` 的样式（CONVENTIONS §6.2：不 import 外壳的样式）。 */
import { globalStyle } from '@vanilla-extract/css'

const ACCENT = 'var(--sn-accent, #1e96eb)'
const LINE = 'rgba(128, 128, 128, .4)'
const WASH = 'rgba(128, 128, 128, .12)'
const MUTED = 'rgba(128, 128, 128, .85)'

globalStyle('.sn-template', { display: 'block', margin: '2px 0' })

globalStyle('.sn-template-btn', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: '100%',
  padding: '6px 12px',
  border: `1px solid ${LINE}`,
  borderRadius: 6,
  background: 'transparent',
  color: ACCENT,
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
})

globalStyle('.sn-template-btn:hover', { background: WASH })

globalStyle('.sn-template-icon', {
  display: 'inline-flex',
  flex: '0 0 auto',
  opacity: 0.9,
})

globalStyle('.sn-template-text', {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

// 空 docId（还没选模板）/ 目标页被删 —— 别装成一颗正常按钮。
globalStyle('.sn-template[data-state="empty"] .sn-template-btn', { color: MUTED })
globalStyle('.sn-template[data-state="empty"] .sn-template-text', { fontStyle: 'italic' })
globalStyle('.sn-template[data-state="missing"] .sn-template-btn', { color: MUTED, cursor: 'default' })

globalStyle('.sn-template-hint', {
  marginLeft: 8,
  fontSize: 12,
  color: MUTED,
})
