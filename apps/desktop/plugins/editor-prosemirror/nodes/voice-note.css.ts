/**
 * 语音笔记块（D-0215）。微信那条语音条的形状：灰底圆角，左播放、中波形、右时长。
 * 颜色跟 `nodes.css.ts` 同一套中性值，不认 `--affine-*`。
 */
import { globalStyle, keyframes } from '@vanilla-extract/css'

const ACCENT = 'var(--sn-accent, #1e96eb)'
const LINE = 'rgba(128, 128, 128, .4)'
const WASH = 'rgba(128, 128, 128, .12)'
const MUTED = 'rgba(128, 128, 128, .85)'
const DANGER = '#e5484d'

const pulse = keyframes({
  '0%, 100%': { transform: 'scale(1)', opacity: 1 },
  '50%': { transform: 'scale(.72)', opacity: .45 },
})

const bounce = keyframes({
  '0%, 100%': { transform: 'scaleY(.35)' },
  '50%': { transform: 'scaleY(1)' },
})

globalStyle('.sn-voice', {
  margin: '6px 0',
  maxWidth: 460,
  lineHeight: 1.4,
})

globalStyle('.sn-voice-idle, .sn-voice-rec, .sn-voice-main, .sn-voice-unsupported', {
  display: 'none',
})

globalStyle('.sn-voice[data-phase="idle"] .sn-voice-idle', { display: 'inline-flex' })
globalStyle('.sn-voice[data-phase="recording"] .sn-voice-rec', { display: 'flex' })
globalStyle(
  '.sn-voice[data-phase="ready"] .sn-voice-main, .sn-voice[data-phase="transcribing"] .sn-voice-main',
  { display: 'block' },
)
globalStyle('.sn-voice[data-phase="unsupported"] .sn-voice-unsupported', { display: 'block' })

/* ── 空块：一颗麦克风 ── */

globalStyle('.sn-voice-idle', {
  alignItems: 'center',
  gap: 7,
  padding: '8px 12px',
  border: `1px dashed ${LINE}`,
  borderRadius: 10,
  background: 'transparent',
  color: MUTED,
  font: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
})

globalStyle('.sn-voice-idle:hover', {
  borderColor: ACCENT,
  color: ACCENT,
})

/* ── 录音中 ── */

globalStyle('.sn-voice-rec', {
  alignItems: 'center',
  gap: 9,
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  background: WASH,
})

globalStyle('.sn-voice-dot', {
  flex: '0 0 8px',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: DANGER,
  animation: `${pulse} 1s ease-in-out infinite`,
})

globalStyle('.sn-voice-wave', {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  height: 22,
  flex: '1 1 auto',
  minWidth: 60,
  overflow: 'hidden',
})

globalStyle('.sn-voice-wave i', {
  display: 'block',
  width: 2,
  borderRadius: 1,
  background: 'currentColor',
  opacity: .35,
  transformOrigin: 'center',
})

globalStyle('.sn-voice[data-phase="recording"] .sn-voice-wave i', {
  animation: `${bounce} .7s ease-in-out infinite`,
})

globalStyle('.sn-voice-wave i.sn-on', {
  opacity: 1,
  background: ACCENT,
})

globalStyle('.sn-voice-time', {
  fontSize: 12,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
})

globalStyle('.sn-voice-stop', {
  flex: '0 0 26px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: DANGER,
  color: '#fff',
  cursor: 'pointer',
})

/* ── 语音条 ── */

/* 宽度按时长走（`--sn-voice-w` 由 NodeView 写），像一条真的微信语音。 */
globalStyle('.sn-voice-bar', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  width: 'var(--sn-voice-w, 210px)',
  maxWidth: '100%',
  padding: '7px 14px 7px 8px',
  background: WASH,
  borderRadius: 18,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background .15s, box-shadow .15s',
})

globalStyle('.sn-voice-bar:hover', {
  background: 'rgba(128, 128, 128, .18)',
})

/* 播放中：气泡加深一圈，波形只留已播过的那些亮着。 */
globalStyle('.sn-voice[data-playing="true"] .sn-voice-bar', {
  background: 'rgba(128, 128, 128, .2)',
  boxShadow: 'inset 0 0 0 1px rgba(128, 128, 128, .35)',
})

globalStyle('.sn-voice[data-playing="true"] .sn-voice-wave i', {
  opacity: .4,
})

globalStyle('.sn-voice[data-playing="true"] .sn-voice-wave i.sn-on', {
  opacity: 1,
})

globalStyle('.sn-voice-play', {
  flex: '0 0 26px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: ACCENT,
  color: '#fff',
  cursor: 'pointer',
})

globalStyle('.sn-voice-bar .sn-voice-wave', {
  minWidth: 96,
  color: 'inherit',
})

globalStyle('.sn-voice-dur', {
  flex: '0 0 auto',
  fontSize: 12,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
})

/* ── 转文字 / 结果 ── */

globalStyle('.sn-voice-tools', {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 6,
  fontSize: 12,
})

globalStyle('.sn-voice-transcribe', {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: MUTED,
  font: 'inherit',
  cursor: 'pointer',
})

globalStyle('.sn-voice-transcribe:hover:not(:disabled)', { color: ACCENT })

globalStyle('.sn-voice-transcribe:disabled', {
  opacity: .6,
  cursor: 'default',
})

globalStyle('.sn-voice-hint', {
  color: DANGER,
  fontSize: 12,
})

globalStyle('.sn-voice-text', {
  width: 'fit-content',
  maxWidth: '100%',
  marginTop: 6,
  padding: '8px 12px',
  borderRadius: 12,
  background: WASH,
  fontSize: 14,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
})

globalStyle('.sn-voice-unsupported', {
  padding: '8px 10px',
  border: `1px dashed ${LINE}`,
  borderRadius: 10,
  color: MUTED,
  fontSize: 12,
})
