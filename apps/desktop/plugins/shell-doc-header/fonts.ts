/**
 * 三级字体落到 `<html>` 上的 `font-family` + 四个变量。**只有这一处写** —— 设置页、⋯ 菜单只负责改
 * `ctx.settings`，改完由订阅回到这里重算，不做第二份注入。
 *
 *   font-family                  全局：整个应用（弹到 body 下的浮层也吃得到）
 *   --affine-font-family         同上，给读变量的那些组件用（主题自己也用这个名字）
 *   --sn-font-doc                文章默认
 *   --sn-font-over               这一篇（= 单篇覆盖，没设就是文章默认）
 *   --affine-font-code-family    代码块；顺带把 mono 那个也指过去
 *   --sn-editor-width            版心宽度（720 / 全宽），`editor.ts` 那个 inline 的 `var()` 读它
 *
 * 顺带carry两个**单篇**的页面开关（D-0076）——它们和字体一样是「这一篇长什么样」，
 * 而且都要写 `<html>`、都要跟着当前文档走，放一个模块里最省：
 *   小字号 → 乘在 `--sn-font-scale` 上（和全局那档叠乘）
 *   全宽   → `--sn-editor-width`
 *
 * ★ 编辑器只在**一个**地方读它们：`editor.css.ts` 里 `.affine-page-viewport` 那条
 *   （把 `--affine-font-family` 重绑到 `--sn-font-over`）。不往 viewport 元素上写内联样式 ——
 *   那个元素每次打开文档都重建，跟着它的生命周期走一定会漏一拍。
 */
import type { Context } from 'cordis'
import {
  CODE_FONT_KEY,
  DOC_FONT_KEY,
  EDITOR_WIDTH_DEFAULT,
  EDITOR_WIDTH_WIDE,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_KEY,
  SMALL_TEXT_RATIO,
  UI_FONT_KEY,
  codeFamilyOf,
  docFontKey,
  docSmallKey,
  docWideKey,
  familyOf,
} from './config'

/** 跟着「当前是哪一篇」走的三个键 —— 换文档时一起换订阅（见 `track`）。 */
const docKeys = (id: string): string[] => [docFontKey(id), docSmallKey(id), docWideKey(id)]

/** 这个模块写下的全部变量，卸载时按这份名单清掉。 */
const VARS = [
  'font-family',
  '--affine-font-family',
  '--affine-font-code-family',
  '--affine-font-mono-family',
  '--sn-font-doc',
  '--sn-font-over',
  '--sn-font-scale',
  '--sn-title-placeholder',
  '--sn-editor-width',
]

export interface Fonts {
  /** 当前是哪一篇 —— 单篇覆盖只对它有。 */
  track(docId: string | null): void
  dispose(): void
}

export function createFonts(ctx: Context): Fonts {
  const root = document.documentElement
  let docId: string | null = null
  let offDoc: (() => void)[] = []
  function apply(): void {
    const ui = familyOf(ctx.settings.get<string>(UI_FONT_KEY))
    const doc = ctx.settings.get<string>(DOC_FONT_KEY)
    // 没设 = 键不存在或存的是 null（「跟随」那一行就是这样落库的，见 view.tsx）。
    const docStack = typeof doc === 'string' ? familyOf(doc) : ui
    const own = docId === null ? undefined : ctx.settings.get<string>(docFontKey(docId))
    const code = codeFamilyOf(ctx.settings.get<string>(CODE_FONT_KEY))

    root.style.setProperty('--affine-font-family', ui)
    // ★ `font-family` **本身**也写在 <html> 上：弹到 body 下的浮层（⌘K、设置页）不在外壳那棵
    //   树里，只给自定义属性它们拿不到 —— 不写这条，它们就掉回浏览器默认的衬线字体。
    root.style.setProperty('font-family', ui)
    root.style.setProperty('--sn-font-doc', docStack)
    root.style.setProperty('--sn-font-over', typeof own === 'string' ? familyOf(own) : docStack)
    root.style.setProperty('--affine-font-code-family', code)
    root.style.setProperty('--affine-font-mono-family', code)
    // 字号缩放： 读不到（没存过 / 存了个垃圾）就回 1，别把 calc 写成 NaN。
    const scale = Number(ctx.settings.get<string>(FONT_SCALE_KEY))
    const base = Number.isFinite(scale) && scale > 0 ? scale : FONT_SCALE_DEFAULT
    // 小字号（D-0076）：这一篇再缩一档，和全局那档**叠乘** ——
    // 全局调到 1.25 又开了小字号，实际是 1.09，不是把它按回 1。
    const small = docId !== null && ctx.settings.get<boolean>(docSmallKey(docId)) === true
    root.style.setProperty('--sn-font-scale', String(base * (small ? SMALL_TEXT_RATIO : 1)))

    // 全宽（D-0076）：`editor.ts` 那个 inline 写的是 `var(--sn-editor-width, 720px)`，读的就是这儿。
    const wide = docId !== null && ctx.settings.get<boolean>(docWideKey(docId)) === true
    root.style.setProperty('--sn-editor-width', wide ? EDITOR_WIDTH_WIDE : EDITOR_WIDTH_DEFAULT)
    // 标题的占位文字（`editor.css.ts` 里那条 `content:` 读它）—— 界面语言跟着走。
    root.style.setProperty('--sn-title-placeholder', JSON.stringify(ctx.i18n.t('doc.titlePlaceholder')))
  }

  function track(next: string | null): void {
    if (next !== docId) {
      // 换文档 = 换一批要盯的 key。不摘旧的，切来切去会攒一堆死订阅。
      for (const off of offDoc) off()
      offDoc = next === null ? [] : docKeys(next).map((key) => ctx.settings.onChange(key, apply))
      docId = next
    }
    apply()
  }

  const offs = [UI_FONT_KEY, DOC_FONT_KEY, CODE_FONT_KEY, FONT_SCALE_KEY].map((key) =>
    ctx.settings.onChange(key, apply),
  )
  apply()

  return {
    track,
    dispose() {
      for (const off of offs) off()
      for (const off of offDoc) off()
      // 拔插件时把变量收回：留着的话主题自己的字体栈就永远被这几个值盖住了。
      for (const name of VARS) root.style.removeProperty(name)
    },
  }
}
