/**
 * 结构这一面（D-0220）。纸色跟正文同一张，翻页才像同一本书。
 */
import { globalKeyframes, globalStyle } from '@vanilla-extract/css'

const PAPER = 'var(--sn-paper, var(--sn-paper-default, #fff))'
const TEXT = 'var(--sn-text, #333)'
const MUTED = 'var(--sn-muted, #8a8a8a)'
const ACCENT = 'var(--sn-accent, #1e96eb)'
const LINE = 'color-mix(in srgb, var(--sn-text, #333) 14%, transparent)'
const EASE = 'cubic-bezier(.16, 1, .3, 1)'

const turn = 'sn-verso-turn'
const cardIn = 'sn-verso-card-in'
const spineIn = 'sn-verso-spine-in'

globalKeyframes(turn, {
  from: { transform: 'rotateY(0deg)' },
  to: { transform: 'rotateY(-180deg)' },
})

globalKeyframes(cardIn, {
  from: { opacity: '0', transform: 'translate3d(-32px, 0, 0) rotateY(22deg)' },
  to: { opacity: '1', transform: 'none' },
})

globalKeyframes(spineIn, {
  from: { opacity: '0' },
  to: { opacity: '1' },
})

globalStyle('.sn-pane-main[data-verso="1"]', { position: 'relative' })

globalStyle('.sn-verso', {
  position: 'absolute',
  zIndex: 3,
  overflow: 'hidden',
  color: TEXT,
  fontFamily: "var(--sn-font-over, 'Inter', 'PingFang SC', 'Hiragino Sans GB', system-ui, sans-serif)",
})

globalStyle('.sn-verso-scene', {
  position: 'absolute',
  inset: 0,
  perspective: '1600px',
  perspectiveOrigin: 'left center',
})

globalStyle('.sn-verso-leaf', {
  display: 'none',
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  transformOrigin: 'left center',
  transformStyle: 'preserve-3d',
  pointerEvents: 'none',
})

globalStyle('.sn-verso-leaf[data-dir]', { display: 'block' })

globalStyle('.sn-verso-leaf[data-dir="open"]', {
  animationName: turn,
  animationDuration: '700ms',
  animationTimingFunction: 'cubic-bezier(.22, .7, .25, 1)',
  animationFillMode: 'forwards',
})

globalStyle('.sn-verso-leaf[data-dir="back"]', {
  animationName: turn,
  animationDuration: '640ms',
  animationTimingFunction: 'cubic-bezier(.22, .7, .25, 1)',
  animationDirection: 'reverse',
  animationFillMode: 'both',
})

globalStyle('.sn-verso-leaf-front', {
  position: 'absolute',
  inset: 0,
  background: PAPER,
  backfaceVisibility: 'hidden',
  boxShadow: '0 0 36px rgba(0, 0, 0, .14)',
})

globalStyle('.sn-verso-leaf-front::after', {
  content: "''",
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: 36,
  background: `linear-gradient(90deg, color-mix(in srgb, ${TEXT} 16%, transparent), transparent)`,
})

globalStyle('.sn-verso-map', {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  height: '100%',
  padding: '16px 20px 18px 16px',
  background: PAPER,
})

globalStyle('.sn-verso-crumbs', {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 0,
  minWidth: 0,
  marginBottom: 6,
  overflow: 'hidden',
})

globalStyle('.sn-verso-crumbs[hidden]', { display: 'none' })

globalStyle('.sn-verso-crumb', {
  maxWidth: 148,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: 'none',
  background: 'none',
  padding: '2px 0',
  color: MUTED,
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
})

globalStyle('.sn-verso-crumb:hover', { color: TEXT })

globalStyle('.sn-verso-slash', {
  flex: '0 0 auto',
  padding: '0 6px',
  color: MUTED,
  opacity: 0.55,
})

globalStyle('.sn-verso-board', {
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  alignItems: 'stretch',
})

globalStyle('.sn-verso-edge', {
  flex: '0 0 18px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 5,
})

globalStyle('.sn-verso-edge:empty', { display: 'none' })

globalStyle('.sn-verso-stripe', {
  flex: '1 1 auto',
  maxHeight: 28,
  minHeight: 22,
  border: 'none',
  padding: 0,
  background: `linear-gradient(${TEXT}, ${TEXT}) center / 100% 2px no-repeat`,
  opacity: 0.45,
  cursor: 'pointer',
})

globalStyle('.sn-verso-stripe:hover', { opacity: 0.9 })

globalStyle('.sn-verso-spine', {
  flex: '0 0 200px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 8,
  minWidth: 0,
  padding: '8px 16px 8px 6px',
})

globalStyle('.sn-verso-back', {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  margin: '0 0 10px',
  padding: '6px 10px 6px 2px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: TEXT,
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1.2,
  cursor: 'pointer',
})

globalStyle('.sn-verso-back::before', {
  content: "'‹'",
  fontSize: 22,
  lineHeight: 1,
  width: 18,
})

globalStyle('.sn-verso-back:hover', {
  background: `color-mix(in srgb, ${TEXT} 8%, transparent)`,
})

globalStyle('.sn-verso-back[hidden]', { display: 'none' })

globalStyle('.sn-verso-spine-title', {
  fontSize: 26,
  fontWeight: 600,
  lineHeight: 1.25,
  letterSpacing: '-0.02em',
  display: '-webkit-box',
  WebkitLineClamp: 5,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
})

globalStyle('.sn-verso-spine-title[data-root="1"]', { fontSize: 30 })

globalStyle('.sn-verso-spine-title[data-enter="1"]', {
  animationName: spineIn,
  animationDuration: '280ms',
  animationTimingFunction: EASE,
})

globalStyle('.sn-verso-spine-gist', {
  fontSize: 13,
  lineHeight: 1.4,
  color: MUTED,
})

globalStyle('.sn-verso-spine-actions', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  marginTop: 4,
})

globalStyle('.sn-verso-textbtn', {
  border: 'none',
  background: 'none',
  padding: '2px 0',
  color: ACCENT,
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
})

globalStyle('.sn-verso-textbtn:hover', { textDecoration: 'underline' })

globalStyle('.sn-verso-textbtn[hidden]', { display: 'none' })

globalStyle('.sn-verso-fan', {
  position: 'relative',
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  perspective: '900px',
})

globalStyle('.sn-verso-fan[data-mode="fan"]', { overflow: 'hidden' })

globalStyle('.sn-verso-fan[data-mode="column"]', {
  overflow: 'auto',
  overscrollBehavior: 'contain',
})

globalStyle('.sn-verso-links', {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
})

globalStyle('.sn-verso-fan[data-mode="column"] .sn-verso-links', { display: 'none' })

globalStyle('.sn-verso-links path', {
  fill: 'none',
  stroke: LINE,
  strokeWidth: 1.25,
})

globalStyle('.sn-verso-fan[data-mode="fan"] .sn-verso-cards', {
  position: 'absolute',
  inset: 0,
})

globalStyle('.sn-verso-fan[data-mode="column"] .sn-verso-cards', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 8,
  padding: '4px 8px 28px 0',
})

globalStyle('.sn-verso-empty', { display: 'none' })

globalStyle('.sn-verso-fan[data-empty="1"] .sn-verso-empty', {
  display: 'flex',
  alignItems: 'center',
  height: '100%',
  margin: 0,
  paddingLeft: 8,
  color: MUTED,
  fontSize: 14,
})

globalStyle('.sn-verso-card', {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: 10,
  rowGap: 2,
  boxSizing: 'border-box',
  margin: 0,
  padding: '9px 12px 9px 14px',
  border: `1px solid ${LINE}`,
  borderRadius: 3,
  background: `color-mix(in srgb, ${TEXT} 4%, ${PAPER})`,
  color: TEXT,
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1.35,
  textAlign: 'left',
  cursor: 'pointer',
  userSelect: 'none',
  touchAction: 'manipulation',
  transition: 'transform 160ms ease, background 160ms ease, border-color 160ms ease',
})

globalStyle('.sn-verso-card:not([data-branch="1"])', { cursor: 'default' })

globalStyle('.sn-verso-fan[data-mode="column"] .sn-verso-card', {
  width: 'min(420px, 100%)',
})

globalStyle('.sn-verso-fan:not([data-enter="1"]) .sn-verso-card:hover', {
  transform: 'translateX(5px)',
  background: `color-mix(in srgb, ${TEXT} 7%, ${PAPER})`,
})

globalStyle('.sn-verso-card[data-open="1"]', {
  borderColor: `color-mix(in srgb, ${ACCENT} 60%, transparent)`,
})

globalStyle('.sn-verso-card:focus-visible', {
  outline: `2px solid ${ACCENT}`,
  outlineOffset: -2,
})

globalStyle('.sn-verso-card[data-branch="1"]::after', {
  content: "''",
  position: 'absolute',
  top: 0,
  right: 0,
  borderWidth: '0 11px 11px 0',
  borderStyle: 'solid',
  borderColor: `transparent color-mix(in srgb, ${TEXT} 20%, transparent) transparent transparent`,
})

globalStyle('.sn-verso-fan[data-enter="1"] .sn-verso-card', {
  animationName: cardIn,
  animationDuration: '460ms',
  animationTimingFunction: EASE,
  animationFillMode: 'backwards',
  animationDelay: 'calc(var(--i) * 32ms)',
})

globalStyle('.sn-verso-ink', {
  position: 'absolute',
  left: 0,
  bottom: 0,
  width: 3,
  height: 'calc(var(--ink, .2) * 100%)',
  background: 'currentColor',
  opacity: 0.4,
  pointerEvents: 'none',
})

globalStyle('.sn-verso-label', {
  gridColumn: 1,
  gridRow: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-verso-card[data-kind="section"] .sn-verso-label', { fontWeight: 600 })

globalStyle('.sn-verso-card[data-kind="quote"] .sn-verso-label', { fontStyle: 'italic' })
globalStyle('.sn-verso-card[data-kind="callout"] .sn-verso-label', { fontStyle: 'italic' })

globalStyle('.sn-verso-card[data-kind="code"] .sn-verso-label', {
  fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  fontSize: 12.5,
})

globalStyle('.sn-verso-meta', {
  gridColumn: 2,
  gridRow: 1,
  alignSelf: 'center',
  fontSize: 12,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
})

globalStyle('.sn-verso-peek', {
  gridColumn: '1 / -1',
  gridRow: 2,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: MUTED,
})

globalStyle('.sn-verso-flap', {
  flex: '0 0 auto',
  alignSelf: 'stretch',
  boxSizing: 'border-box',
  width: 0,
  minHeight: 0,
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
  transition: `width 320ms ${EASE}, height 320ms ${EASE}, opacity 180ms ease`,
})

globalStyle('.sn-verso-flap[data-on="1"]', {
  width: 320,
  paddingLeft: 18,
  opacity: 1,
  pointerEvents: 'auto',
  boxShadow: `inset 1px 0 0 ${LINE}`,
})

globalStyle('.sn-verso-flap-inner', {
  height: '100%',
  minHeight: 0,
  minWidth: 220,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
})

globalStyle('.sn-verso-body', {
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'auto',
  overscrollBehavior: 'contain',
  margin: 0,
  fontSize: 16.5,
  lineHeight: 1.7,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
})

globalStyle('.sn-verso-body.sn-verso-code', {
  fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  fontSize: 12.5,
  lineHeight: 1.55,
  whiteSpace: 'pre',
})

globalStyle('.sn-verso-img', {
  display: 'block',
  maxWidth: '100%',
  maxHeight: 240,
  objectFit: 'contain',
})

globalStyle('.sn-verso-body video', {
  display: 'block',
  width: '100%',
  maxHeight: 220,
})

globalStyle('.sn-verso-body audio', { width: '100%' })

globalStyle('.sn-verso-table', {
  borderCollapse: 'collapse',
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: 'normal',
})

globalStyle('.sn-verso-table td', {
  border: `1px solid ${LINE}`,
  padding: '4px 8px',
  verticalAlign: 'top',
  maxWidth: 180,
})

globalStyle('.sn-verso-table th', {
  border: `1px solid ${LINE}`,
  padding: '4px 8px',
  verticalAlign: 'top',
  fontWeight: 600,
  textAlign: 'left',
})

globalStyle('.sn-verso-more', {
  margin: '8px 0 0',
  fontSize: 12,
  color: MUTED,
})

globalStyle('.sn-verso-flap[data-kind="quote"] .sn-verso-body', {
  borderLeft: `2px solid color-mix(in srgb, ${TEXT} 35%, transparent)`,
  paddingLeft: 12,
})

globalStyle('.sn-verso-flap[data-kind="callout"] .sn-verso-body', {
  borderLeft: `2px solid color-mix(in srgb, ${TEXT} 35%, transparent)`,
  paddingLeft: 12,
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-board', { flexDirection: 'column' })

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-edge', {
  flexDirection: 'row',
  flex: '0 0 auto',
  width: 'auto',
  height: 16,
  marginBottom: 4,
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-stripe', {
  maxHeight: 'none',
  height: 14,
  minWidth: 18,
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-spine', {
  flex: '0 0 auto',
  width: 'auto',
  padding: '2px 0 8px',
  justifyContent: 'flex-start',
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-spine-title', {
  fontSize: 22,
  WebkitLineClamp: 2,
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-flap', {
  width: 'auto',
  height: 0,
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-flap[data-on="1"]', {
  width: 'auto',
  height: '42%',
  flexBasis: '42%',
  paddingLeft: 0,
  paddingTop: 8,
  boxShadow: `inset 0 1px 0 ${LINE}`,
})

globalStyle('.sn-verso[data-narrow="1"] .sn-verso-flap-inner', {
  minWidth: 0,
  width: '100%',
})

const still = { animation: 'none' }

globalStyle('.sn-verso-leaf[data-dir]', {
  '@media': { '(prefers-reduced-motion: reduce)': { display: 'none', animation: 'none' } },
})

globalStyle('.sn-verso-fan[data-enter="1"] .sn-verso-card', {
  '@media': { '(prefers-reduced-motion: reduce)': still },
})

globalStyle('.sn-verso-spine-title[data-enter="1"]', {
  '@media': { '(prefers-reduced-motion: reduce)': still },
})

globalStyle('.sn-verso-card', {
  '@media': { '(prefers-reduced-motion: reduce)': { transition: 'none' } },
})

globalStyle('.sn-verso-flap', {
  '@media': { '(prefers-reduced-motion: reduce)': { transition: 'none' } },
})
