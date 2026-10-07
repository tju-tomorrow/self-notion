/**
 * 编辑器 ↔ 存储的适配层 —— **字节路径**。内存 stub 已拆，这里直接接 `ctx.docs`。
 *
 * 为什么落在 `DocSource`（`@blocksuite/sync`）上而不是自己发明一层：它的形状
 * 「给我你缺的增量 / 收下我的增量 / 订阅别人的增量」正好就是 D-0035 那条三方法契约的
 * 字节级版本，BlockSuite 的同步引擎本来就是照它写的（`peer.ts` 里 `await source.pull(...)`）。
 * 于是编辑器一行不用动，换掉这个文件就够了。
 *
 * ★ 这里**不缓存**任何 Y.Doc 镜像：库里那份就是权威。`pull` 每次现读现算差分。
 *   缓存会引入「镜像和活文档谁新」的问题，而答案永远不唯一 —— 库里那份没有这个问题。
 *   代价是每次 pull 一次 `doc:open`，单窗口开几篇文档，这个开销可以忽略。
 *
 * ★ 落库只送 `snapshot`（全量），`updates` 恒空：`doc:apply` 的 snapshot 是**合并点**，
 *   Rust 收到它就把 snapshot 换掉并把尾段吸收掉（`docs.rs` 的 `apply`）。
 *   送 update 会往 `doc_update`（append-only）里堆，而全量已经覆盖了同样的信息。
 *
 * ponytail: 「别的窗口改了这篇」的中继直接挂在 Rust 的事件总线上（`subscribe`，见 `startRelay`）
 * —— 本窗口不缓存任何镜像（同上面的理由）。
 */
import type { DocSource } from '@blocksuite/affine/sync'
import { listen } from '@tauri-apps/api/event'
import * as Y from 'yjs'

import type { DocHandle, DocLink, DocsService } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

/** 把句柄里的字节灌进一个 Y.Doc。**顺序是契约规定的**：先 snapshot，再按 seq 依次 updates。 */
function applyHandle(handle: DocHandle, into: Y.Doc): void {
  if (handle.snapshot) Y.applyUpdate(into, handle.snapshot)
  for (const update of handle.updates) Y.applyUpdate(into, update)
}

/** 正文投影：落库时顺带把纯文本、标题与出链送进去（Rust 拿它喂 FTS / 摘要 / 链接图谱）。 */
export interface Projection {
  title: string
  md: string
  /** 这一篇的出链（D-0085）。`md` 的同一处产出、同一个 payload。 */
  links: DocLink[]
}

export interface DocsBacking {
  /** 喂给 `TestWorkspace({ docSources })` 的那个 source。 */
  source: DocSource
  /** 打开文档：把库里的字节灌进 `into`。挂编辑器**之前**必须 await 完，见 `openStore`。 */
  hydrate(docId: string, into: Y.Doc): Promise<void>
  /** 落库：把**活的** Y.Doc 全量写进句柄再交给 `ctx.docs.save`，顺带带上正文投影。 */
  flush(docId: string, live: Y.Doc, project?: Projection): Promise<void>
}

/* ─────────────────── 多窗口中继（`docs/architecture.md` 第七节）─────────────────── */

/** 订阅者：引擎**每个文档**一个 peer，各订一次，所以是一组回调而不是一个。 */
const relaySubs = new Set<(docId: string, data: Uint8Array) => void>()
let relaying = false

/**
 * 挂上 Rust 的 `doc:update`（`src/windows.rs`）。事件里**只有 id** —— 收到就重读库里那份，
 * 合并点就只有 Rust 一处；读回来的整段交给引擎 `apply`。
 *
 * ★ 引擎 apply 用的 origin 是 `source.name`，`peer.ts` 的 `handleYDocUpdates` 会跳过它，
 *   所以刚收到的字节**不会被再 push 回去** —— 两个窗口不会对着转圈。
 */
function startRelay(docs: DocsService): void {
  if (relaying) return
  relaying = true
  void listen<string>('doc:update', (e) => {
    void (async () => {
      const merged = new Y.Doc({ guid: e.payload })
      try {
        applyHandle(await docs.load(e.payload), merged)
      } catch (err) {
        reportError('doc-relay', err)
        return
      }
      const data = Y.encodeStateAsUpdate(merged)
      relaySubs.forEach((cb) => cb(e.payload, data))
    })()
  }).catch((err) => {
    // 挂不上就下次订阅再试 —— 别把 relaying 留在 true，那就再也不试了
    relaying = false
    reportError('doc-relay', err)
  })
}

/**
 * @param onDirty 文档有本地改动时叫一声（`push` 里）。落库时机是调用方的事 ——
 *   这一层只负责「有东西变了」这个事实。
 */
export function docsBacking(docs: DocsService, onDirty: (docId: string) => void): DocsBacking {
  const source: DocSource = {
    name: 'self-notion-docs',

    // 契约是「给我你缺的那部分」：入参是对方的 state vector，回参是我这边的差分。
    async pull(docId, state) {
      const handle = await docs.load(docId)
      const doc = new Y.Doc({ guid: docId })
      applyHandle(handle, doc)
      return { data: Y.encodeStateAsUpdate(doc, state), state: Y.encodeStateVector(doc) }
    },

    // 本地改动的信号。字节不用在这儿存 —— 落库走 flush，那里读的是活的 Y.Doc。
    push(docId) {
      onDirty(docId)
    },

    // 别的窗口改了这篇 → 引擎把新字节 apply 进来（架构第七节）。
    subscribe(cb) {
      startRelay(docs)
      relaySubs.add(cb)
      return () => void relaySubs.delete(cb)
    },
  }

  return {
    source,

    async hydrate(docId, into) {
      applyHandle(await docs.load(docId), into)
    },

    async flush(docId, live, project) {
      // 句柄就地造：`save` 的语义是「句柄里的是待落库缓冲，送完即清空」（S7 的实现），
      // 所以每次落库都该是一份新的 —— 复用一个被清空的旧句柄只会送出空调用，
      // 而 Rust 那边 `doc:apply` 收到空的 update+snapshot 是**报错**的。
      await docs.save(docId, {
        id: docId,
        snapshot: Y.encodeStateAsUpdate(live),
        updates: [],
        title: project?.title,
        md: project?.md,
        links: project?.links,
      })
    },
  }
}
