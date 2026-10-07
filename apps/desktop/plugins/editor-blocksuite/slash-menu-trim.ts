/**
 * 斜杠菜单里**不该有的那几条**。
 *
 * 用户报的现场：打 `/pa` 想过滤，回车却把那一行复制了一份（看着像「回车换行」）。
 * 原因是模糊匹配是「按顺序命中」——`pa` 命中了 **D-u-p-l-i-c-a-t-e**，回车执行的就是它。
 * Duplicate 这一条对我们没用（要复制行有拖手柄那套），留着只会被误伤。
 *
 * 为什么盖到 `SlashMenuExtension` 这一层，而不是盖 `SlashMenuConfigIdentifier('default')`：
 * 那一份 config 不在包的公开出口里（`index.ts` 只导出 consts / extensions / types），
 * 要盖就得把上游那 9 条整条抄下来 —— 从此升级要对两份。这里只筛名字，
 * 上游加条目 / 改动作都不用管。
 */
import { type ViewExtensionContext, ViewExtensionProvider } from '@blocksuite/affine/ext-loader'
import type { ServiceIdentifier } from '@blocksuite/affine/global/di'
import { StdIdentifier, type BlockStdScope } from '@blocksuite/affine/std'
import { SlashMenuExtension } from '@blocksuite/affine/widgets/slash-menu'

/** 按 `name`（配置里那个英文名）丢。要再少几条，往这里加。 */
const DROPPED = new Set(['Duplicate'])

class TrimmedSlashMenu extends SlashMenuExtension {
  constructor(std: BlockStdScope) {
    super(std)
    const base = this.config
    this.config = {
      ...base,
      items: (ctx) => {
        const items = typeof base.items === 'function' ? base.items(ctx) : base.items
        return items.filter((item) => !DROPPED.has(item.name))
      },
    }
  }
}

/**
 * ★ 必须排在 `SlashMenuViewExtension` **后面**（`editor.ts` 里 viewProviders 的顺序）：
 *   它 `context.register(SlashMenuExtension)` 那一下会 `di.add`，先 override 再 add 会撞
 *   `DuplicateServiceDefinitionError`。
 */
export class SlashMenuTrimProvider extends ViewExtensionProvider {
  override name = 'self-notion-slash-menu-trim'

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register({
      setup: (di) => {
        // ★ 这个 cast 只是补类型的口子：`override` 的签名只收 `ServiceIdentifier`，而类在运行时
        //   也是合法标识 —— `di.add(SlashMenuExtension, [StdIdentifier])` 走的就是类名那条路，
        //   两边传的是**同一个类对象**，名字怎么变（压缩过后）都还是同一个 key。
        di.override(
          SlashMenuExtension as unknown as ServiceIdentifier<SlashMenuExtension>,
          (provider) => new TrimmedSlashMenu(provider.get(StdIdentifier)),
        )
      },
    })
  }
}
