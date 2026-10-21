/**
 * `kb` 服务面 —— 收件箱 / 图谱 / 侧栏经它读，不 import 本目录（D-0189 的破例只在侧栏那一处）。
 *
 * ★ 一层薄包装：每个方法就一条 `kb:*` RPC。**不做缓存** —— Rust 是唯一真相源，
 *   前端再存一份就会漂（CONVENTIONS §4）。
 */
import type { Context } from 'cordis'
import type {
  KbCurateResult,
  KbEntity,
  KbProposal,
  KbRelated,
  KbService,
  KbStatus,
  KbSubgraph,
  KbTag,
  KbTopic,
  KbVecHit,
} from '../../src/kernel/contract'

export function makeKbService(ctx: Context): KbService {
  return {
    status: () => ctx.rpc.call<KbStatus>('kb:status', {}),

    curate: (docId) => ctx.rpc.call<KbCurateResult>('kb:curate', docId ? { docId } : {}),

    proposals: (state) => ctx.rpc.call<KbProposal[]>('kb:proposals', state ? { state } : {}),

    decide: async (id, accept) => {
      await ctx.rpc.call('kb:proposal', { id, accept })
    },

    tags: () => ctx.rpc.call<KbTag[]>('kb:tags', {}),

    topics: () => ctx.rpc.call<KbTopic[]>('kb:topics', {}),

    entities: () => ctx.rpc.call<KbEntity[]>('kb:entities', {}),

    entity: (name) => ctx.rpc.call<KbEntity | null>('kb:entity', { name }),

    related: (id, limit) =>
      ctx.rpc.call<KbRelated[]>('kb:related', { id, ...(limit === undefined ? {} : { limit }) }),

    graph: (seed, depth, limit) =>
      ctx.rpc.call<KbSubgraph>('kb:graph', {
        seed,
        ...(depth === undefined ? {} : { depth }),
        ...(limit === undefined ? {} : { limit }),
      }),

    semantic: (q, limit) =>
      ctx.rpc.call<KbVecHit[]>('kb:semantic', {
        query: q,
        ...(limit === undefined ? {} : { limit }),
      }),
  }
}
