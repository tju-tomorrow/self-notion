/**
 * 斜杠菜单的**中文 / 拼音搜索**（D-0089）。
 *
 * 上游那 13 条基本项（正文 / H1–H6 / 引用 / 代码 / 分割线 / 圆点列表 / 数字列表 / **待办**）
 * 名字全是英文，而且**一个 `searchAlias` 都没有**（`affine-rich-text/src/conversion.ts` 里
 * `searchAlias` 出现 0 次）—— 中文界面下打 `/待办` 一个字都对不上，看着就像「没有待办这个功能」。
 * 和当时「子页面 / 链接页面」是同一个坑（见 `editor.ts` 那段注释）。
 *
 * ★ **名字保持英文不动**（用户 2026-10-07 定的）：只往里加别名，菜单长相一点不变。
 * ★ 这份是**整条重建**，不是打补丁：那 13 条挂在一个 id 下（`SlashMenuConfigExtension('affine:note', …)`），
 *   DI 的 `override` 是全有或全无。下面每一行都照抄
 *   `affine-block-note/src/configs/slash-menu.ts`，**唯一的差别是多了 `searchAlias`** ——
 *   上游那份改了（版本升级）这里要跟着看。
 * ★ 代价（如实记）：上游那层的 `tooltips`（悬停提示）**不在包的公开出口里**，够不着，
 *   所以这几项重建之后没有悬停提示了。`description`（那一行说明）照旧保留。
 */
import {
  formatBlockCommand,
  textFormatConfigs,
  type TextFormatConfig,
} from '@blocksuite/affine/inlines/preset'
import { textConversionConfigs, type TextConversionConfig } from '@blocksuite/affine/rich-text'
import { updateBlockType } from '@blocksuite/affine/blocks/note'
import { BlockSelection } from '@blocksuite/affine/std'
import {
  SlashMenuConfigIdentifier,
  type SlashMenuActionItem,
  type SlashMenuConfig,
  type SlashMenuItem,
} from '@blocksuite/affine/widgets/slash-menu'
import { type ViewExtensionContext, ViewExtensionProvider } from '@blocksuite/affine/ext-loader'
import { HeadingsIcon } from '@blocksuite/icons/lit'

/**
 * 别名表，key 用菜单项的**英文名**（上游那么叫的，这儿对得上就行）。
 *
 * 中英文都铺：中文让你打 `/待办`，拼音让你在中文输入法下打 `/daiban` 不用切键盘。
 * 「列表」这种两个都沾的词故意同时挂在圆点和数字上 —— 两行都出来比一行都不出来好。
 */
const ALIAS: Readonly<Record<string, string[]>> = {
  Text: ['正文', '文本', '段落', 'wenben', 'wen zi', 'zhengwen', 'duanluo', 'paragraph'],
  'Heading 1': ['一级标题', '标题一', '标题', 'biaoti', 'yijibiaoti', 'heading1'],
  'Heading 2': ['二级标题', '标题二', '标题', 'biaoti', 'erjibiaoti', 'heading2'],
  'Heading 3': ['三级标题', '标题三', '标题', 'biaoti', 'sanjibiaoti', 'heading3'],
  'Heading 4': ['四级标题', '标题四', '标题', 'biaoti', 'sijibiaoti', 'heading4'],
  'Heading 5': ['五级标题', '标题五', '标题', 'biaoti', 'wujibiaoti', 'heading5'],
  'Heading 6': ['六级标题', '标题六', '标题', 'biaoti', 'liujibiaoti', 'heading6'],
  'Other Headings': ['更多标题', '其他标题', 'gengduobiaoti', 'qitabiaoti', 'headings'],
  'Bulleted List': ['圆点列表', '无序列表', '项目符号', '列表', 'liebiao', 'yuandian', 'wuxu', 'bullet'],
  'Numbered List': ['数字列表', '有序列表', '编号列表', '列表', 'liebiao', 'shuzi', 'youxu', 'number'],
  'To-do List': [
    '待办',
    '待办列表',
    '任务',
    '任务列表',
    '清单',
    '复选框',
    'daiban',
    'dai ban',
    'renwu',
    'qingdan',
    'fuxuankuang',
    'to-do',
    'todo',
    'task',
    'checkbox',
  ],
  'Code Block': ['代码块', '代码', 'daima', 'daimakuai', 'codeblock'],
  Quote: ['引用', '引述', 'yinyong', 'quote'],
  Divider: ['分割线', '分隔线', '分界线', '横线', 'fengexian', 'hengxian', 'divider'],
  Bold: ['加粗', '粗体', 'jiacu', 'cuti', 'bold'],
  Italic: ['斜体', 'xieti', 'italic'],
  Underline: ['下划线', 'xiahuaxian', 'underline'],
  Strikethrough: ['删除线', 'shanchuxian', 'strikethrough', 'strike'],
}

/** 上游那条「换成这种块」的动作，一字不改，只多一个 `searchAlias`。 */
function conversionItem(
  config: TextConversionConfig,
  group?: SlashMenuItem['group'],
): SlashMenuActionItem {
  const { name, description, icon, flavour, type } = config
  return {
    name,
    group,
    description,
    icon,
    searchAlias: ALIAS[name],
    when: ({ model }) => model.store.schema.flavourSchemaMap.has(flavour),
    action: ({ std }) => {
      std.command.exec(updateBlockType, { flavour, props: { type } })
    },
  }
}

/** 行内样式那几条（加粗 / 斜体 / 下划线 / 删除线）—— 同上，只多一个 `searchAlias`。 */
function formatItem(
  config: TextFormatConfig,
  group?: SlashMenuItem['group'],
): SlashMenuActionItem {
  const { name, icon, id, action } = config
  return {
    name,
    icon,
    group,
    searchAlias: ALIAS[name],
    action: ({ std, model }) => {
      const { host } = std
      if (model.text?.length !== 0) {
        std.command.exec(formatBlockCommand, {
          blockSelections: [
            std.selection.create(BlockSelection, {
              blockId: model.id,
            }),
          ],
          styles: { [id]: true },
        })
      } else {
        // 空行上就跟格式栏一样，直接开个样式
        action(host)
      }
    },
  }
}

function buildBasicSlashMenu(): SlashMenuConfig {
  let basic = 0
  return {
    items: [
      ...textConversionConfigs
        .filter(i => i.type && ['h1', 'h2', 'h3', 'text'].includes(i.type))
        .map(config => conversionItem(config, `0_Basic@${basic++}`)),

      {
        name: 'Other Headings',
        icon: HeadingsIcon(),
        group: `0_Basic@${basic++}`,
        subMenu: textConversionConfigs
          .filter(i => i.type && ['h4', 'h5', 'h6'].includes(i.type))
          .map(config => conversionItem(config)),
      },

      ...textConversionConfigs
        .filter(i => i.flavour === 'affine:code')
        .map(config => conversionItem(config, `0_Basic@${basic++}`)),

      // ★ 上游这儿还挂了一条 `!isInsideBlockByFlavour(…, 'affine:edgeless-text')` ——
      //   那是给白板模式挡的，而我们**没有白板**（schema 里连 affine:edgeless-text 都没有），
      //   那条恒为真。省掉它，少一个够不着的 import。
      ...textConversionConfigs
        .filter(i => i.type && ['divider', 'quote'].includes(i.type))
        .map(config => conversionItem(config, `0_Basic@${basic++}`)),

      ...textConversionConfigs
        .filter(i => i.flavour === 'affine:list')
        .map((config, index) => conversionItem(config, `1_List@${index}`)),

      ...textFormatConfigs
        .filter(i => !['Code', 'Link'].includes(i.name))
        .map((config, index) => formatItem(config, `2_Style@${index}`)),
    ],
  }
}

/** 整条配置只在模块装载时建一次 —— 里面的 `group` 序号是构建时算的，不能每次现算。 */
export const basicSlashMenu: SlashMenuConfig = buildBasicSlashMenu()

/** 把上面那份盖到上游那份头上。键是块名，两边同一个键（`affine:note`）。 */
export class SlashMenuZhProvider extends ViewExtensionProvider {
  override name = 'self-notion-slash-menu-zh'

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register({
      setup: di => {
        di.override(SlashMenuConfigIdentifier('affine:note'), () => basicSlashMenu)
      },
    })
  }
}
