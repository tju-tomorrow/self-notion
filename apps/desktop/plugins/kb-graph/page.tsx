/**
 * 知识图谱那一页（挂 `main.home` 槽，跟 `kb-inbox` 一个形状）。
 *
 * 布局与渲染在 `./graph.ts`（自写力导向，不引库）—— 这里只管数据：拉一篇当种子、
 * 问 `kb:graph` 要子图、把结果交给画布控制器，外加顶部那行控件和图例。
 *
 * ★ 页面显不显走模块级状态 + 订阅（侧栏 → SHOW_LIST → 这里）：事件可能在首页还没挂载时发
 *   （用户正看编辑器时点侧栏），放组件里就永远错过那一下。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import { OPEN_DOC, type DocMeta, type KbSubgraph } from '../../src/kernel/contract'
import { describeThrown, reportError } from '../../src/kernel/errors'
import { createGraph, type GraphHandle } from './graph'
import * as s from './page.css'

/* ── 这一页显不显：模块级状态 + 订阅 ── */

let on = false
const subs = new Set<() => void>()

export function setGraphPage(next: boolean) {
  if (next === on) return
  on = next
  for (const cb of subs) cb()
}

function subscribePage(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

const readPage = () => on

const LIMIT = 60
const LEGEND: readonly string[] = ['doc', 'entity', 'topic']

export function GraphPage({ ctx }: { ctx: Context }) {
  const active = useSyncExternalStore(subscribePage, readPage, readPage)
  return active ? <GraphView ctx={ctx} /> : null
}

function GraphView({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const handleRef = useRef<GraphHandle | null>(null)

  // null = 还没拉到（首屏别闪一下空态）。
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [seed, setSeed] = useState('')
  const [depth, setDepth] = useState(1)
  const [data, setData] = useState<KbSubgraph | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = useCallback((err: unknown) => {
    reportError('kb', err)
    setError(describeThrown(err))
  }, [])

  // 种子候选：最近打开过的几篇（没打开过的按更新时间倒序），默认取第一篇。
  useEffect(() => {
    let gone = false
    void (async () => {
      try {
        const all = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
        if (gone) return
        const sorted = [...all].sort(
          (a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt),
        )
        setDocs(sorted)
        setSeed((cur) => cur || (sorted[0]?.id ?? ''))
      } catch (err) {
        if (!gone) fail(err)
      }
    })()
    return () => {
      gone = true
    }
  }, [ctx, fail])

  // 种子 / 跳数一变就重问一次子图。
  useEffect(() => {
    if (seed === '') return
    let gone = false
    void (async () => {
      try {
        const sub = await ctx.rpc.call<KbSubgraph>('kb:graph', { seed, depth, limit: LIMIT })
        if (gone) return
        setData(sub)
        setError(null)
      } catch (err) {
        if (!gone) fail(err)
      }
    })()
    return () => {
      gone = true
    }
  }, [ctx, seed, depth, fail])

  // 画布控制器：挂载时建一次，卸载时销毁（cancelAnimationFrame + 断 ResizeObserver）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let handle: GraphHandle
    try {
      handle = createGraph(canvas, {
        theme: ctx.theme,
        onPickDoc: (id) => ctx.emit(OPEN_DOC, { id }),
      })
    } catch (err) {
      fail(err)
      return
    }
    handleRef.current = handle
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [ctx, fail])

  useEffect(() => {
    if (data !== null) handleRef.current?.setData(data)
  }, [data])

  const empty = data !== null && data.nodes.length === 0

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>{t('kb.graph.title')}</h1>

        <label className={s.field}>
          <span className={s.fieldLabel}>{t('kb.graph.depth')}</span>
          <select
            className={s.select}
            value={depth}
            onChange={(e) => setDepth(Number(e.currentTarget.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>

        <select
          className={s.select}
          value={seed}
          onChange={(e) => setSeed(e.currentTarget.value)}
          title={t('kb.graph.title')}
        >
          {(docs ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || '—'}
            </option>
          ))}
        </select>

        <span className={s.hint}>{t('kb.graph.hint')}</span>

        <span className={s.legend}>
          {LEGEND.map((kind) => (
            <span key={kind} className={s.legendItem}>
              <i className={s.dot} data-kind={kind} />
              {t(`kb.graph.legend.${kind}`)}
            </span>
          ))}
        </span>
      </div>

      {error !== null && <p className={s.error}>{error}</p>}

      <div className={s.stage}>
        <canvas ref={canvasRef} className={s.canvas} />
        {empty && <p className={s.note}>{t('kb.graph.empty')}</p>}
      </div>
    </div>
  )
}
