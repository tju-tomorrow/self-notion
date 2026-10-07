/**
 * 给**同一个元素反复用**的地方来一次淡入（编辑器宿主、右侧那两列面板）。
 *
 * 为什么不用 `motion.css.ts` 里的类：加类不会重播动画 —— 元素一直在那儿，
 * 切文档时只是里头换了一批孩子，类名没变过，浏览器认为动画早就放完了。
 * 所以这里走 Web Animations：每次调用都是新的一段。
 *
 * 只做**透明度**，不做位移：这些元素要么会被 `getBoundingClientRect` 量（编辑器、面板），
 * 要么里头有绝对定位的孩子（目录刻度条、宠物），位移会让它们错一帧。
 */
export function appear(el: Element, ms = 160): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'ease-out' })
}
