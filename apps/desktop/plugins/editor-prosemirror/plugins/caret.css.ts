/**
 * 短光标（`caret.ts`）。原生光标藏起来，只在自己这条上留 caret 的样式。
 */
import { globalStyle, keyframes } from '@vanilla-extract/css'

const blink = keyframes({
  '0%, 49%': { opacity: 1 },
  '50%, 100%': { opacity: 0 },
})

globalStyle('.ProseMirror', { caretColor: 'transparent' })

// 块里的输入框（图片说明 / 公式 / 代码语言）还是原生的：它们的光标本来就贴着字。
globalStyle('.ProseMirror input, .ProseMirror textarea', { caretColor: 'auto' })

globalStyle('.sn-caret', {
  position: 'fixed',
  width: 1.5,
  borderRadius: 1,
  pointerEvents: 'none',
  background: 'currentColor',
  zIndex: 20,
  animation: `${blink} 1.06s steps(1, end) infinite`,
})
