/**
 * `ctx.tools` —— agent 的工具面（D-0042 / D-0087）。
 *
 * **六条**：读三条（`vfs_list` / `vfs_grep` / `vfs_read`）+ 写三条（`doc_create` /
 * `doc_append` / `doc_replace`）。`ToolSpec.parameters` 就是给模型看的 JSON Schema ——
 * **一份定义**，唯一的消费者是 `plugin-ai`（D-0084 把 MCP 改成进程外只读 bin 之后，
 * 「一个定义两处导出」那句作废了）。见 `docs/ai.md` 第三节。
 *
 * 读走 `ctx.get('vfs')`（**软依赖**：vfs 没装就那三条报一句清楚的话，而不是假装能读）。
 * 写走 `doc.ts`（懒装载 —— 不写文档的人不该为块包付冷启动费）。
 *
 * ★ **写工具的第一件事是 `version:checkpoint`**（`docs/ai.md` 第六节）：先打版本点，再动
 *   Y.Doc。这是「先快照后写」的**第二层**，第一层在 Rust（`docs.rs::apply`，`origin != 'user'`
 *   就一定先快照，躲不掉）。漏了这一句不至于丢可撤销性，但版本点会缺 `label` / `group_id`，
 *   于是「一个回合一次撤销」就残了 —— 所以它只写在这一个文件里，不散开。
 *
 * ★ `groupId` 由 **`plugin-ai` 每个回合生成一个、塞进 args**（`ToolSpec.run(args)` 只有一个
 *   参数）。模型看不见它：它不在上面那些 `parameters` 里，是调用方加的。
 */
import type { Context } from 'cordis'
import type { DocMeta, ToolSpec, ToolsService } from '../../src/kernel/contract'

export const name = 'plugin-tools'

// rpc：`version:checkpoint` / `doc:apply` / `doc:create`；docs / editor：load + reload。
// vfs 是软依赖，不走 inject（`ctx.get('vfs')`）。
export const inject = ['rpc', 'docs', 'editor']

export function apply(ctx: Context) {
  const specs: ToolSpec[] = []

  const tools: ToolsService = {
    register(spec) {
      specs.push(spec)
      // 逆函数即 register 的返回值（D-0033），幂等。
      return () => {
        const at = specs.indexOf(spec)
        if (at >= 0) specs.splice(at, 1)
      }
    },
    list: () => [...specs],
  }
  ctx.effect(() => ctx.provide('tools', tools))

  const add = (spec: ToolSpec) => ctx.effect(() => tools.register(spec))
  add(listTool(ctx))
  add(grepTool(ctx))
  add(readTool(ctx))
  add(createTool(ctx))
  add(appendTool(ctx))
  add(replaceTool(ctx))
}

/* ─────────────────────────── 读 ─────────────────────────── */

function listTool(ctx: Context): ToolSpec {
  return {
    name: 'vfs_list',
    description:
      '列一个虚拟目录里有什么（文件或子目录）。入口是 /index.md（全库地图）——先看它再进来。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，例如 "/" 或 "/tree" 或 "/outline"' },
      },
      required: ['path'],
    },
    async run(args) {
      const a = obj(args)
      return needVfs(ctx).list(str(a, 'path'))
    },
  }
}

function grepTool(ctx: Context): ToolSpec {
  return {
    name: 'vfs_grep',
    description: '在整棵目录里按关键字找，返回命中的路径 + 行号 + 那一行。定位一篇最快的路。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '要找的字（不是正则）' },
        ignoreCase: { type: 'boolean', description: '忽略大小写，默认 false' },
      },
      required: ['pattern'],
    },
    async run(args) {
      const a = obj(args)
      return needVfs(ctx).grep(str(a, 'pattern'), { ignoreCase: a['ignoreCase'] === true })
    },
  }
}

function readTool(ctx: Context): ToolSpec {
  return {
    name: 'vfs_read',
    description:
      '读一个文件的正文（Markdown）。长文档用 offset / limit 分页读，别一次灌满上下文。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径，例如 "/tree/某某.md"' },
        offset: { type: 'number', description: '从第几行开始（默认 0）' },
        limit: { type: 'number', description: '读几行' },
      },
      required: ['path'],
    },
    async run(args) {
      const a = obj(args)
      const offset = num(a, 'offset')
      const limit = num(a, 'limit')
      return needVfs(ctx).read(str(a, 'path'), { offset, limit })
    },
  }
}

/* ─────────────────────────── 写 ─────────────────────────── */

function createTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_create',
    description: '新建一篇文档。markdown 是正文，可以不给（先建个空页）。返回新文档的 id。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文档标题' },
        markdown: { type: 'string', description: '正文（Markdown）' },
      },
      required: ['title'],
    },
    async run(args) {
      const a = obj(args)
      const groupId = needGroup(a)
      const doc = await write()
      return doc.create(ctx, str(a, 'title'), str(a, 'markdown'), groupId)
    },
  }
}

function appendTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_append',
    description:
      '在**已有**文档的末尾追加内容（不覆盖已有的东西）。' +
      'id 用 doc_list 里那个 id（最稳）。只给路径也行，但文件名跟标题对不上时会报错。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id（先用 doc_list 拿）；也可以给 "/tree/某某.md" 路径' },
        markdown: { type: 'string', description: '要追加的 Markdown' },
      },
      required: ['id', 'markdown'],
    },
    async run(args) {
      const a = obj(args)
      const ref = str(a, 'id')
      const markdown = str(a, 'markdown')
      const id = await resolve(ctx, ref)
      const groupId = needGroup(a)
      await checkpoint(ctx, id, groupId, labelOf(markdown))
      const doc = await write()
      return doc.append(ctx, id, markdown, groupId)
    },
  }
}

function replaceTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_replace',
    description:
      '把**某一小段**换掉（不是整篇重写）。两种定位方式给一种：' +
      'blockIds 是块 id 列表（精确）；quote 是那段原文里的一句话（省事）。' +
      'id 用 doc_list 里那个 id（最稳）。只给路径也行，但文件名跟标题对不上时会报错。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id（先用 doc_list 拿）；也可以给 "/tree/某某.md" 路径' },
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要替换掉的块 id（新的插在第一个块的位置）',
        },
        quote: {
          type: 'string',
          description: '要替换掉的那段原文里的一句话 —— 按它找到块（正文里没有块 id 时用这个）',
        },
        markdown: { type: 'string', description: '换成什么（Markdown）' },
      },
      required: ['id', 'markdown'],
    },
    async run(args) {
      const a = obj(args)
      const markdown = str(a, 'markdown')
      const id = await resolve(ctx, str(a, 'id'))
      const groupId = needGroup(a)
      // 第一件事（`docs/ai.md` 第六节）：先打版本点，再碰 Y.Doc。
      await checkpoint(ctx, id, groupId, labelOf(markdown))
      const doc = await write()
      // 块 id 从 vfs 里看不见（`/tree/X.md` 只有文字，没有 id）—— 允许按原文找。
      const given = strs(a, 'blockIds')
      const found = given.length ? given : await doc.findByQuote(ctx, id, str(a, 'quote'))
      if (!found.length) throw new Error('doc_replace：没说清要换哪一段（blockIds 或 quote 给一个）')
      return doc.replace(ctx, id, found, markdown, groupId)
    },
  }
}

/* ─────────────────────────── 帮手 ─────────────────────────── */

/**
 * 先打版本点再动 Y.Doc（`docs/ai.md` 第六节）。
 *
 * 不给 `update` —— Rust 拿自己手里的最近一份全量（`doc_snapshot`），也就是**写之前**那一刻。
 */
async function checkpoint(ctx: Context, id: string, groupId: string, label: string): Promise<void> {
  await ctx.rpc.call('version:checkpoint', { id, origin: 'ai', groupId, label })
}

/** 块包那几 MB 在这一句才进来（`plugins/tools/index.ts` 的文件头写了为什么）。 */
const write = () => import('./doc')

/**
 * 把模型给的"哪一篇"换成真的 doc id。
 *
 * ★ **直接给 id 是唯一可靠的路**（`doc_list` 里有）。路径那条只是兜底 ——
 *   因为虚拟目录里**没有 doc id**，只能拿文件名去比标题，于是有两个坑：
 *   1. 两篇同名 → 不知道改哪个。**这里选择报错**，不挑第一篇：
 *      静默改错一篇比报错坏得多（用户看不出来）。
 *   2. 文件名是去重过的（`untitled (2).md`），标题里那串后缀根本不存在 → 对不上。
 *   兜底那条路存在的理由：模型有时只 grep 到了路径、没调 `doc_list`。
 */
async function resolve(ctx: Context, ref: string): Promise<string> {
  if (!ref.startsWith('/')) return ref
  const want = ref.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const all = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
  const hits = all.filter((d) => d.title === want)
  if (hits.length > 1) {
    throw new Error(
      `「${want}」有 ${hits.length} 篇同名的，说不清改哪个 —— 先 doc_list，用它给的 id 指定`,
    )
  }
  if (!hits.length) {
    throw new Error(
      `路径「${ref}」对不上任何一篇（虚拟目录里没有 doc id，只能拿文件名比标题）。` +
        `先 doc_list 拿 id，再用 id 调一次`,
    )
  }
  return hits[0].id
}

/** 版本点上那句说明 —— 和 `doc.ts` 里的 `labelOf` 同一个口径。 */
function labelOf(markdown: string): string {
  return (
    markdown
      .split('\n')
      .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
      .find((l) => l !== '') ?? ''
  ).slice(0, 60)
}

function needVfs(ctx: Context) {
  const vfs = ctx.get('vfs')
  if (!vfs) throw new Error('虚拟目录没装（plugin-vfs）：这三条读工具暂时用不了')
  return vfs
}

function needGroup(a: Record<string, unknown>): string {
  const g = a['groupId']
  if (typeof g !== 'string' || g === '') throw new Error('写工具缺少 groupId（调用方要带）')
  return g
}

/** args 是模型给的 JSON —— 形状不保证，一律当 `unknown` 收（CONVENTIONS §2 禁 `any`）。 */
function obj(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
}

function str(a: Record<string, unknown>, key: string): string {
  const v = a[key]
  return typeof v === 'string' ? v : ''
}

function num(a: Record<string, unknown>, key: string): number | undefined {
  const v = a[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function strs(a: Record<string, unknown>, key: string): string[] {
  const v = a[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
