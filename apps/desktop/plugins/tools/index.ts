/**
 * `ctx.tools` —— agent 的工具面（D-0042 / D-0087）。
 *
 * 读走有预算的检索（`notes_find` / `notes_map` / `notes_related` / `notes_learn` / `doc_marks`），
 * `vfs_*` 只负责列目录和按路径读，并且结果截断。
 * 写四条正文（`doc_create` / `doc_append` / `doc_replace` / `doc_blocks`）加改名、移动、标签、熟悉度。
 * `ToolSpec.parameters` 就是给模型看的 JSON Schema ——
 * **一份定义**，唯一的消费者是 `plugin-ai`（D-0084 把 MCP 改成进程外只读 bin 之后，
 * 「一个定义两处导出」那句作废了）。见 `docs/ai.md` 第三节。
 *
 * 读走 `ctx.get('vfs')`（**软依赖**：vfs 没装就那三条报一句清楚的话，而不是假装能读）。
 * 写走 `doc.ts`（懒装载 —— 不写文档的人不该为块包付冷启动费）。
 *
 * ★ **版本点交给 Rust 打**，前端不再显式调 `version:checkpoint`：`doc:apply` 里
 *   `origin != 'user'` 就一定先快照（`docs.rs::apply`），而写工具送的 payload 本来就带
 *   `groupId` / `label`，那一层不缺信息。
 *   ★ 2026-10-08 之前这里还有一句显式 `checkpoint(...)`，和 Rust 那层**打的是同一份内容**
 *   （同一个「改之前」被记两遍），已删。
 *
 * ★ `groupId` 由 **`plugin-ai` 每个回合生成一个、塞进 args**（`ToolSpec.run(args)` 只有一个
 *   参数）。模型看不见它：它不在上面那些 `parameters` 里，是调用方加的。
 */
import type { Context } from 'cordis'
import {
  DOCS_CHANGED,
  type DocMeta,
  type DocWriteService,
  type LearnRow,
  type ToolSpec,
  type ToolsService,
  type VfsHit,
} from '../../src/kernel/contract'
import { readWithImages } from './media'
import { webReadTool, webSearchTool } from './web'

/** 一次读给模型的上限。再长就让它带 offset 续读。 */
const READ_CAP = 6_000
const LIST_CAP = 80
const GREP_CAP = 30

export const name = 'plugin-tools'

// rpc：`doc:apply` / `doc:create`；docs / editor：load + reload。
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

  // 外部 agent 的写入口（D-0191）：走同一条 markdown → 块 → doc:apply 的路。
  const docWrite: DocWriteService = {
    create: async (title, markdown, groupId) =>
      (await write()).create(ctx, title, markdown, groupId),
    append: async (id, markdown, groupId) =>
      (await write()).append(ctx, id, markdown, groupId),
    replaceAll: async (id, markdown, groupId, title) =>
      (await write()).replaceAll(ctx, id, markdown, groupId, title),
  }
  ctx.effect(() => ctx.provide('doc-write', docWrite))

  const add = (spec: ToolSpec) => ctx.effect(() => tools.register(spec))
  add(listTool(ctx))
  add(grepTool(ctx))
  add(readTool(ctx))
  add(findTool(ctx))
  add(mapTool(ctx))
  add(relatedTool(ctx))
  add(learnTool(ctx))
  add(marksTool(ctx))
  add(annotationsTool(ctx))
  add(createTool(ctx))
  add(appendTool(ctx))
  add(replaceTool(ctx))
  add(blocksTool(ctx))
  add(renameTool(ctx))
  add(moveTool(ctx))
  add(tagTool(ctx))
  add(familiarityTool(ctx))
  add(webSearchTool(ctx))
  add(webReadTool(ctx))
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
      const rows = await needVfs(ctx).list(str(a, 'path'))
      const shown = rows.slice(0, LIST_CAP).map((e) => `${e.kind}\t${e.path}`)
      if (rows.length <= LIST_CAP) return shown.join('\n')
      return `${shown.join('\n')}\n…还有 ${rows.length - LIST_CAP} 项，缩小目录再列`
    },
  }
}

function grepTool(ctx: Context): ToolSpec {
  return {
    name: 'vfs_grep',
    description:
      '整库按字面找一行。结果最多 30 条。定位优先用 notes_find，这条只在它不够时用。',
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
      const hits = await needVfs(ctx).grep(str(a, 'pattern'), { ignoreCase: a['ignoreCase'] === true })
      const shown = hits.slice(0, GREP_CAP).map((h) => grepLine(h))
      if (hits.length <= GREP_CAP) return shown.join('\n')
      return `${shown.join('\n')}\n…还有 ${hits.length - GREP_CAP} 条。换 notes_find，或把 pattern 写具体`
    },
  }
}

function readTool(ctx: Context): ToolSpec {
  return {
    name: 'vfs_read',
    description:
      '读一个文件的正文（Markdown）。不给 limit 时只读前 160 行，并且最多 6000 字。' +
      '长文用 offset 续读。笔记里的图片会一起给你，正文里对应 [图片 N]。',
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
      const limit = num(a, 'limit') ?? 160
      const text = await needVfs(ctx).read(str(a, 'path'), { offset, limit })
      const packed = await readWithImages(ctx, cap(text, READ_CAP))
      return packed
    },
  }
}

function annotationsTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_annotations',
    description:
      '查一篇笔记里**看得见的标注**：文字颜色 / 高亮、块颜色、以及所有评论和每条评论锚住的原文。' +
      '用户问「这篇里哪些地方标了颜色」「哪些句子有评论」「这条评论对应哪段」时用它 —— ' +
      'vfs_read 只有纯文字，看不到颜色和评论锚点。不给 id 就是用户正在看的那篇。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '文档 id 或 "/tree/某某.md" 路径；不给 = 当前正在看的那篇',
        },
      },
    },
    async run(args) {
      const a = obj(args)
      const ref = str(a, 'id') || str(a, 'currentDocId')
      if (!ref) throw new Error('doc_annotations：不知道查哪一篇（用户没在看文档，请给 id 或路径）')
      const id = await resolve(ctx, ref)
      return ctx.rpc.call('doc:annotations', { id })
    },
  }
}

/* ─────────────────────────── 写 ─────────────────────────── */

function createTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_create',
    description:
      '新建一篇文档。正文可以给 markdown，也可以给 blocks（结构化块，优先）；都不给就先建个空页。返回新文档的 id。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文档标题' },
        markdown: { type: 'string', description: '正文（Markdown）' },
        blocks: {
          type: 'array',
          items: { type: 'object' },
          description: '结构化块数组（写法同 doc_blocks）；给了它就忽略 markdown',
        },
      },
      required: ['title'],
    },
    async run(args) {
      const a = obj(args)
      const groupId = needGroup(a)
      const doc = await write()
      return doc.create(ctx, str(a, 'title'), str(a, 'markdown'), groupId, a['blocks'])
    },
  }
}

function appendTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_append',
    description:
      '在**已有**文档的末尾追加内容（不覆盖已有的东西）。' +
      'id 用 notes_find 结果里的路径（最稳）。文件名跟标题对不上时会报错。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id，或 "/tree/某某.md" 路径（notes_find 会给路径）' },
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
      'id 用 notes_find 给的路径（最稳）。文件名跟标题对不上时会报错。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id，或 "/tree/某某.md" 路径（notes_find 会给路径）' },
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
      const doc = await write()
      // 块 id 从 vfs 里看不见（`/tree/X.md` 只有文字，没有 id）—— 允许按原文找。
      const given = strs(a, 'blockIds')
      const found = given.length ? given : await doc.findByQuote(ctx, id, str(a, 'quote'))
      if (!found.length) throw new Error('doc_replace：没说清要换哪一段（blockIds 或 quote 给一个）')
      return doc.replace(ctx, id, found, markdown, groupId)
    },
  }
}

function blocksTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_blocks',
    description:
      '按块结构写笔记 —— 能用 Markdown 表达不了的块：callout / 折叠 / 公式 / 分栏 / 表格 / 块颜色 / 子页面卡片。' +
      '不给 blockIds / quote 就追加到末尾；给了就换掉那一段。块写法看系统提示。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id；也可以给 "/tree/某某.md" 路径' },
        blocks: {
          type: 'array',
          items: { type: 'object' },
          description: '块数组，每项有 type 和它自己的字段（text / children / rows / columns…）',
        },
        blockIds: {
          type: 'array',
          items: { type: 'string' },
          description: '要替换掉的块 id（不给就是追加）',
        },
        quote: { type: 'string', description: '要替换掉的那段原文里的一句话（替代 blockIds）' },
      },
      required: ['id', 'blocks'],
    },
    async run(args) {
      const a = obj(args)
      const spec = a['blocks']
      if (!Array.isArray(spec) || spec.length === 0) throw new Error('doc_blocks：blocks 是空的')
      const id = await resolve(ctx, str(a, 'id'))
      const groupId = needGroup(a)
      const doc = await write()
      const given = strs(a, 'blockIds')
      const quote = str(a, 'quote')
      let target: string[] | undefined
      if (given.length) target = given
      else if (quote) {
        target = await doc.findByQuote(ctx, id, quote)
        if (!target.length) throw new Error('doc_blocks：没找到包含这句话的块（quote）')
      }
      return doc.blocks(ctx, id, spec, groupId, target)
    },
  }
}

function findTool(ctx: Context): ToolSpec {
  return {
    name: 'notes_find',
    description: '在库里定位笔记。返回最多 8 篇：标题、路径、一句摘要。要读正文再 vfs_read 那条路径。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，中英文都行' },
        limit: { type: 'number', description: '最多几篇，默认 8，上限 20' },
      },
      required: ['query'],
    },
    async run(args) {
      const a = obj(args)
      const limit = num(a, 'limit')
      return ctx.rpc.call<string>('notes:find', {
        query: str(a, 'query'),
        ...(limit === undefined ? {} : { limit }),
      })
    },
  }
}

function mapTool(ctx: Context): ToolSpec {
  return {
    name: 'notes_map',
    description: '看库里有哪些主题、各有多少篇。给一个主题名就只列那一类。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: '主题名或目录名；不给 = 全库地图' },
      },
    },
    async run(args) {
      const a = obj(args)
      const scope = str(a, 'scope')
      return ctx.rpc.call<string>('notes:map', { scope: scope || undefined })
    },
  }
}

function relatedTool(ctx: Context): ToolSpec {
  return {
    name: 'notes_related',
    description: '一篇笔记的关联：显式链接、还没采纳的关联建议、标题相近。不给 id 时用当前圈定或正在看的那篇。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id 或 /tree 路径' },
      },
    },
    async run(args) {
      const a = obj(args)
      const ref = str(a, 'id')
      const id = ref ? await resolve(ctx, ref) : ''
      if (!id) throw new Error('notes_related：给 id 或路径')
      return ctx.rpc.call<string>('notes:related', { id })
    },
  }
}

function learnTool(ctx: Context): ToolSpec {
  return {
    name: 'notes_learn',
    description:
      '读学习数据：打开次数、阅读时长、读到的深度、行为分、手动熟悉度。' +
      'unfamiliar=true 只列标成「不熟」的。给 target 就只看那一篇。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '文档 id 或路径；不给 = 有记录的笔记' },
        unfamiliar: { type: 'boolean', description: '只要熟悉度第 1 档' },
      },
    },
    async run(args) {
      const a = obj(args)
      const target = str(a, 'target')
      if (target) {
        const id = await resolve(ctx, target)
        const row = await ctx.rpc.call<LearnRow>('learn:get', { id })
        const title = await titleOf(ctx, id)
        return formatLearn(title, row)
      }
      const [rows, docs] = await Promise.all([
        ctx.rpc.call<LearnRow[]>('learn:list', {}),
        ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false }),
      ])
      const titles = new Map(docs.map((d) => [d.id, d.title]))
      const picked = (a['unfamiliar'] === true
        ? rows.filter((r) => r.familiarity === 1)
        : rows.filter((r) => r.opens > 0 || r.familiarity != null)
      ).slice(0, 40)
      if (!picked.length) return a['unfamiliar'] === true ? '没有标成「不熟」的笔记。' : '还没有学习数据。'
      return picked.map((r) => formatLearn(titles.get(r.docId) ?? r.docId, r)).join('\n')
    },
  }
}

function marksTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_marks',
    description:
      '在笔记里找标了颜色 / 高亮 / 写了评论的句子。query 是颜色名（红、黄）或原文里的词。' +
      '不给 path 就在最近改过的笔记里找；圈了范围时调用方会把 path 补上。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '颜色名或关键词' },
        path: { type: 'string', description: '只在这个 /tree 目录下找' },
      },
      required: ['query'],
    },
    async run(args) {
      const a = obj(args)
      const path = str(a, 'path')
      const ids = Array.isArray(a['ids']) ? a['ids'].filter((x): x is string => typeof x === 'string') : undefined
      return ctx.rpc.call<string>('doc:marks', {
        query: str(a, 'query'),
        path: path || undefined,
        ids,
      })
    },
  }
}

function renameTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_rename',
    description: '改一篇笔记的标题。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id 或路径' },
        title: { type: 'string', description: '新标题' },
      },
      required: ['id', 'title'],
    },
    async run(args) {
      const a = obj(args)
      const id = await resolve(ctx, str(a, 'id'))
      const title = str(a, 'title')
      if (!title) throw new Error('doc_rename：没有新标题')
      await ctx.rpc.call('doc:rename', { id, title })
      ctx.emit(DOCS_CHANGED)
      return { docId: id, title }
    },
  }
}

function moveTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_move',
    description: '把一篇笔记移到另一个父页面下。parent 不给或给 / 就是移到顶层。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要移动的文档 id 或路径' },
        parent: { type: 'string', description: '新的父页面 id 或路径' },
      },
      required: ['id'],
    },
    async run(args) {
      const a = obj(args)
      const id = await resolve(ctx, str(a, 'id'))
      const parent = str(a, 'parent') || str(a, 'parentId')
      const parentId = !parent || parent === '/' ? null : await resolve(ctx, parent)
      await ctx.rpc.call('doc:move', { id, parentId })
      ctx.emit(DOCS_CHANGED)
      return { docId: id, parentId }
    },
  }
}

function tagTool(ctx: Context): ToolSpec {
  return {
    name: 'doc_tag',
    description: '整组替换一篇笔记的标签。要保留旧标签就连同新的一起给。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id 或路径' },
        tags: { type: 'array', items: { type: 'string' }, description: '替换后的全部标签' },
      },
      required: ['id', 'tags'],
    },
    async run(args) {
      const a = obj(args)
      const id = await resolve(ctx, str(a, 'id'))
      const tags = strs(a, 'tags')
      await ctx.rpc.call('doc:tags', { id, tags })
      ctx.emit(DOCS_CHANGED)
      return { docId: id, tags }
    },
  }
}

function familiarityTool(ctx: Context): ToolSpec {
  return {
    name: 'notes_familiarity',
    description: '给一篇笔记打熟悉度。1 不熟，2 略懂，3 熟悉，4 很熟，0 清除。不改打开次数和阅读时长。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '文档 id 或路径' },
        level: { type: 'number', description: '0–4' },
      },
      required: ['id', 'level'],
    },
    async run(args) {
      const a = obj(args)
      const level = num(a, 'level')
      if (level === undefined || level < 0 || level > 4) throw new Error('notes_familiarity：level 是 0–4')
      const id = await resolve(ctx, str(a, 'id'))
      await ctx.rpc.call('learn:familiarity', { id, level: level === 0 ? null : level })
      return { docId: id, familiarity: level === 0 ? null : level }
    },
  }
}

/* ─────────────────────────── 帮手 ─────────────────────────── */

/** 块包那几 MB 在这一句才进来（`plugins/tools/index.ts` 的文件头写了为什么）。 */
const write = () => import('./doc')

/**
 * 把模型给的"哪一篇"换成真的 doc id。
 *
 * ★ **直接给 id 或 notes_find 给的路径**。路径那条只是兜底 ——
 *   虚拟目录的文件名拿去比标题，有两个坑：
 *   1. 两篇同名 → 不知道改哪个。**这里选择报错**，不挑第一篇：
 *      静默改错一篇比报错坏得多（用户看不出来）。
 *   2. 文件名是去重过的（`untitled (2).md`），标题里那串后缀根本不存在 → 对不上。
 *   兜底那条路存在的理由：模型有时只拿到路径、没拿到 id。
 */
async function resolve(ctx: Context, ref: string): Promise<string> {
  if (!ref.startsWith('/')) return ref
  const file = ref.split('/').pop()?.replace(/\.md$/i, '') ?? ''
  const marked = /~([0-9a-f]{6})$/i.exec(file)
  const want = marked ? file.slice(0, -7) : file
  const all = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
  const hits = all.filter((d) => d.title === want)
  if (marked) {
    const prefix = marked[1].toLowerCase()
    const byId = all.filter((d) => d.id.toLowerCase().startsWith(prefix))
    const hit = byId.length === 1 ? byId[0] : hits.find((d) => d.id.toLowerCase().startsWith(prefix))
    if (!hit) throw new Error(`路径「${ref}」上的 ~${marked[1]} 对不上任何一篇`)
    return hit.id
  }
  if (hits.length > 1) {
    throw new Error(
      `「${want}」有 ${hits.length} 篇同名的，说不清改哪个 —— 用 notes_find 拿到的那条路径（带 ~id 的那个）`,
    )
  }
  if (!hits.length) {
    throw new Error(
      `路径「${ref}」对不上任何一篇（虚拟目录里没有 doc id，只能拿文件名比标题）。` +
        `先 notes_find 拿带 ~ 的路径，再用那条路径调一次`,
    )
  }
  return hits[0].id
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

function cap(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（已截断，用 offset 续读）`
}

function grepLine(hit: VfsHit): string {
  const text = hit.text.length > 160 ? `${hit.text.slice(0, 160)}…` : hit.text
  return `${hit.path}:${hit.line}: ${text}`
}

const FAM = ['', '不熟', '略懂', '熟悉', '很熟']

function formatLearn(title: string, row: LearnRow): string {
  const fam = row.familiarity == null ? '未打' : (FAM[row.familiarity] ?? String(row.familiarity))
  const mins = Math.round(row.readMs / 60_000)
  return `《${title}》 熟悉度${fam} 打开${row.opens} 阅读${mins}分钟 深度${row.depth} 行为分${row.score}`
}

async function titleOf(ctx: Context, id: string): Promise<string> {
  const docs = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
  return docs.find((d) => d.id === id)?.title ?? id
}
