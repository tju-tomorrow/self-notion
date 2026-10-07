/**
 * `ctx.settings` —— 键值设置，落在 Rust 的 `meta` 表（`settings:get/set/list`）。
 *
 * 形状就三件事：`get` / `set` / `onChange`。**不做** schema 校验、不做类型转换、
 * 不做默认值合并 —— 那些是消费者的事（theme / i18n 各自有默认值）。
 *
 * `get` 是**同步**的（组件在渲染路径上要能直接读），所以这里留一份内存副本：
 * 装载时用 `settings:list` 预热，之后 `set` 写穿。键的 `setting.` 前缀由 Rust 侧加/去，
 * 这边一律用裸键。
 */
import type { Context } from 'cordis'
import type { SettingsService } from '../../src/kernel/contract'

export const name = 'plugin-settings'

export const inject = ['rpc']

/** 值在库里是 TEXT。`value` 是 unknown，JSON 是唯一无损的编码（同 D-0047 的 base64，是线格式不是类型转换）。 */
function decode(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // 不是我们写进去的行（别的工具改过、或历史遗留）原样返回，不炸。
    return raw
  }
}

export function apply(ctx: Context) {
  const rpc = ctx.rpc
  const cache = new Map<string, unknown>()
  const subs = new Map<string, Set<() => void>>()

  const notify = (key: string) => subs.get(key)?.forEach((cb) => cb())

  const settings: SettingsService = {
    get<T = unknown>(key: string): T | undefined {
      return cache.get(key) as T | undefined
    },

    set(key, value) {
      // 先更内存再写库：`get` 是同步的，调用方 set 完立刻 get 必须已经看到新值。
      cache.set(key, value)
      notify(key)

      // 签名是 void、写库是异步的，所以 fire-and-forget；失败只能记一笔，不能静默吞。
      void rpc
        .call('settings:set', { key, value: JSON.stringify(value) })
        .catch((err: unknown) => console.error(`[plugin-settings] 写 ${key} 失败`, err))
    },

    onChange(key, cb) {
      let set = subs.get(key)
      if (!set) subs.set(key, (set = new Set()))
      set.add(cb)
      return () => void set.delete(cb)
    },
  }

  // 预热：不回读的话，跨会话的设置在 `get` 这边永远是 undefined（S7 撞出来的缺口）。
  // 订阅者可能已经注册了（插件的装载顺序），所以填完要通知一遍。
  // ponytail: 一次全量读，设置项就是几十条。多到手疼时换增量（或 `settings:get` 按 key 拉）。
  void rpc
    .call<Record<string, string>>('settings:list')
    .then((all) => {
      for (const [key, raw] of Object.entries(all)) {
        // 装载途中有人抢先 set 过的键，以内存里的新值为准。
        if (!cache.has(key)) cache.set(key, decode(raw))
        notify(key)
      }
    })
    .catch((err: unknown) => console.error('[plugin-settings] 预热失败', err))

  ctx.effect(() => ctx.provide('settings', settings))
}
