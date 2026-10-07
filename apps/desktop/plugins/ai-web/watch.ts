/**
 * **临时**看门狗：查「一开 web ai 为什么整个应用没响应」，查完删。
 *
 * 判据是**关系和差值**，不是一个数：单看「一次 IPC 用了几毫秒」看不出谁把主线程占了，
 * 要的是「帧间隔被撑到多少」×「这段时间压了多少次主线程命令」。两者一起才站得住。
 */
import { reportNote } from '../../src/kernel/errors'

let prev = 0
let from = 0
let count = 0
let total = 0
let worst = 0
let rect = ''

/** 面板那个 effect 每次重挂接都得对一次表 —— 不然上一段的 `prev` 会算出一个假的超大间隔。 */
export function reset(): void {
  prev = 0
  from = 0
  count = 0
  total = 0
  worst = 0
  rect = ''
}

/** 一遍摆位 IPC 回来了：多久、摆在哪个矩形。 */
export function put(ms: number, at: string): void {
  count++
  total += ms
  if (ms > worst) worst = ms
  rect = at
}

/** 推进一格。`due` = 这一拍本该在多少毫秒内回来（逐帧 16 / 兜底 250）—— 晚到的那些毫秒，
 *  就是主线程被别的东西占住的时间。 */
export function frame(due: number): void {
  const now = performance.now()
  const late = prev === 0 ? 0 : now - prev - due
  prev = now
  if (from === 0) from = now
  // 窗口被挡住 / 系统睡了：rAF 和定时器本来就停摆，那不是卡 —— 只重新对表。
  if (late > 4000) {
    from = now
    return
  }
  const span = now - from
  if (late < 250 && (count === 0 || span < 1000)) return
  reportNote(
    'webai',
    `主线程迟到 ${Math.round(late)}ms｜${Math.round(span)}ms 内摆位 ${count} 次（共 ${Math.round(total)}ms，最长 ${Math.round(worst)}ms）｜rect ${rect}`,
  )
  from = now
  count = 0
  total = 0
  worst = 0
}
