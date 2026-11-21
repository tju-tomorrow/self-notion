/**
 * 输入法上屏那一下不能当成回车提交。
 *
 * macOS 上有些输入法先发 `compositionend` 再发 `keydown`，这时 `isComposing` 已经是 false ——
 * 只看它会把选词的回车当成发送。
 */
import { useRef } from 'react'

export function useImeGuard() {
  const composing = useRef(false)
  const endedAt = useRef(0)

  return {
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
      endedAt.current = Date.now()
    },
    /** true = 这个键归输入法，调用方直接放行。 */
    blocked: (e: { key: string; nativeEvent: { isComposing?: boolean; keyCode?: number } }) =>
      composing.current ||
      e.nativeEvent.isComposing === true ||
      e.nativeEvent.keyCode === 229 ||
      (e.key === 'Enter' && Date.now() - endedAt.current < 60),
  }
}
