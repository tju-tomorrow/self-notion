/** drawio 预览块（D-0216）。颜色跟 `nodes.css.ts` 同一套中性值。 */
import { globalStyle } from '@vanilla-extract/css'

const LINE = 'rgba(128, 128, 128, .4)'
const WASH = 'rgba(128, 128, 128, .12)'
const MUTED = 'rgba(128, 128, 128, .85)'

globalStyle('.sn-drawio', {
  position: 'relative',
  margin: '6px 0',
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  background: WASH,
  overflow: 'hidden',
  cursor: 'pointer',
  userSelect: 'none',
})

globalStyle('.sn-drawio:focus-visible', {
  outline: '2px solid var(--sn-accent, #1e96eb)',
  outlineOffset: 2,
})

globalStyle('.sn-drawio-frame', {
  width: '100%',
  height: 220,
  overflow: 'hidden',
  pointerEvents: 'none',
})

globalStyle('.sn-drawio[data-empty="true"] .sn-drawio-frame', { height: 120 })

globalStyle('.sn-drawio-frame svg', { display: 'block' })

globalStyle('.sn-drawio-open', {
  position: 'absolute',
  top: 8,
  right: 8,
  padding: '2px 8px',
  borderRadius: 999,
  background: 'rgba(0, 0, 0, .35)',
  color: '#fff',
  fontSize: 12,
  opacity: 0,
  transition: 'opacity .15s',
  pointerEvents: 'none',
})

globalStyle('.sn-drawio:hover .sn-drawio-open', { opacity: 1 })

globalStyle('.sn-drawio-empty', {
  display: 'none',
  position: 'absolute',
  inset: 0,
  alignItems: 'center',
  justifyContent: 'center',
  color: MUTED,
  fontSize: 13,
})

globalStyle('.sn-drawio[data-empty="true"] .sn-drawio-empty', { display: 'flex' })
