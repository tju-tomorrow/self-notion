/**
 * 设置页那个模型下拉的选项来源：**先问网关，问不到用内置这份兜底**。
 *
 * 请求在 Rust（`ai:models`）—— 插件不声明 `net`，联网只能发生在那边。
 */
import { useEffect, useState } from 'react'
import type { Context } from 'cordis'

/** 兜底清单。只在拉不到时出场，所以不求全 —— 真缺什么用「自定义…」那一项。 */
export const FALLBACK_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'gpt-4o',
  'gpt-4o-mini',
  'qwen2.5:14b',
]

/** 「自定义…」那一项的值。模型名理论上不会是它。 */
export const CUSTOM = '__custom__'

export interface ModelList {
  models: string[]
  /** 拉不到的原因，给那一行的说明用。空 = 没出错。 */
  err: string
  loading: boolean
}

/** `pull` 一变就重拉（保存成功后由设置页自己加一）。`enabled` 为假时压根不发请求。 */
export function useModelList(ctx: Context, enabled: boolean, pull: number): ModelList {
  const [state, setState] = useState<ModelList>({ models: [], err: '', loading: false })

  useEffect(() => {
    if (!enabled) {
      setState({ models: [], err: '', loading: false })
      return
    }
    let live = true
    setState((s) => ({ ...s, loading: true }))
    ctx.rpc
      .call<{ models?: string[]; error?: string }>('ai:models')
      .then((r) => {
        if (live) setState({ models: r.models ?? [], err: r.error ?? '', loading: false })
      })
      .catch((e: unknown) => {
        if (live) setState({ models: [], err: errText(e), loading: false })
      })
    return () => {
      live = false
    }
  }, [ctx, enabled, pull])

  return state
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
