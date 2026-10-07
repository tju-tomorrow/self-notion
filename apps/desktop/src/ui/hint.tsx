/**
 * 悬停提示：把一颗按钮包一层，鼠标停上去出一句「这颗是干什么的」。
 *
 * 顶栏那一行（总结 / ☆ / ⋯ / 朗读 / 网页版 AI / 评论 / 版本历史）**每颗都要有** ——
 * 那一行全是图标，没有提示就只剩猜。
 */
import type { ReactNode } from 'react'

import * as s from './hint.css'

export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className={s.wrap}>
      {children}
      <span role="tooltip" className={s.tip}>
        {text}
      </span>
    </span>
  )
}
