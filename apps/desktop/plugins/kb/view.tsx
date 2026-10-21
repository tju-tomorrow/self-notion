/**
 * 设置页的「知识库」一段（`settings.section`，`group: 'integration'`）。
 *
 * 四件事：自动整理开关 · embedding 模型输入框 · 「现在整理一轮」按钮 · 底部计数。
 *
 * ★ embedding 模型**不走 `ctx.settings.set`**：那个键 Rust 按**裸串**读
 *   （`kb::embed::current_model`），而 `ctx.settings.set` 会 JSON 编码（给串加引号）→
 *   模型名带着引号发出去，语义层永远开不了。所以直接写 meta（`settings:set` 收裸串）。
 * ★ 计数和当前模型都以 `kb:status` 为准（Rust 现算），本地不另存一份。
 */
import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { Button, Field, Group, Row, Switch } from '../../src/ui/settings'
import { toast } from '../../src/ui/toast'
import { reportError } from '../../src/kernel/errors'
import type { KbCurateResult, KbStatus } from '../../src/kernel/contract'

const CURATOR_KEY = 'kb.curator'
const MODEL_KEY = 'kb.embedModel'

/** 计数那格：等宽右对齐，眼睛能上下比（同 `mem-monitor` 的 `num`）。 */
const num = { fontVariantNumeric: 'tabular-nums', color: 'var(--affine-v2-text-secondary)' } as const

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function KbSection({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  const [status, setStatus] = useState<KbStatus | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)

  // 开关读 `ctx.settings`（默认开）—— Rust 那边只有明确的 false 才算关。
  const readCurator = () => ctx.settings.get<boolean>(CURATOR_KEY) !== false
  const [curatorOn, setCuratorOn] = useState(readCurator)

  useEffect(() => {
    ctx.rpc
      .call<KbStatus>('kb:status', {})
      .then((st) => {
        setStatus(st)
        setModel(st.embedModel)
      })
      .catch((err: unknown) => reportError('kb', err))
  }, [ctx])

  useEffect(() => ctx.settings.onChange(CURATOR_KEY, () => setCuratorOn(readCurator())), [ctx])

  // 每个键一写：输入框没有 blur 钩子，Rust 那边又是懒读的，半截值无所谓。
  const writeModel = (next: string) => {
    setModel(next)
    void ctx.rpc
      .call('settings:set', { key: MODEL_KEY, value: next.trim() })
      .catch((err: unknown) => reportError('kb', err))
  }

  const curateNow = () => {
    setBusy(true)
    ctx.rpc
      .call<KbCurateResult>('kb:curate', {})
      .then((r) => {
        toast({
          text: t('kb.settings.curated', { ran: r.ran, proposals: r.proposals, applied: r.applied }),
        })
        // 跑完计数变了，回读一次（本地不留缓存）。
        return ctx.rpc.call<KbStatus>('kb:status', {}).then(setStatus)
      })
      .catch((err: unknown) => {
        reportError('kb', err)
        toast({ text: message(err), tone: 'error' })
      })
      .finally(() => setBusy(false))
  }

  return (
    <Group>
      <Row label={t('kb.settings.curator')} desc={t('kb.settings.curator.hint')}>
        <Switch
          on={curatorOn}
          label={t('kb.settings.curator')}
          onChange={(next) => ctx.settings.set(CURATOR_KEY, next)}
        />
      </Row>

      <Row label={t('kb.settings.model')} desc={t('kb.settings.semantic.hint')}>
        <Field value={model} onChange={writeModel} placeholder="text-embedding-3-small" width={220} />
      </Row>

      <Row label={t('kb.settings.curateNow')}>
        <Button variant="primary" disabled={busy} onClick={curateNow}>
          {t('kb.settings.curateNow')}
        </Button>
      </Row>

      {status ? (
        <>
          <Row label={t('kb.status.docs')}>
            <span style={num}>{status.docs}</span>
          </Row>
          <Row label={t('kb.status.tags')}>
            <span style={num}>{status.tags}</span>
          </Row>
          <Row label={t('kb.status.topics')}>
            <span style={num}>{status.topics}</span>
          </Row>
          <Row label={t('kb.status.entities')}>
            <span style={num}>{status.entities}</span>
          </Row>
          <Row label={t('kb.status.pending')}>
            <span style={num}>{status.pending}</span>
          </Row>
          <Row label={t('kb.status.stale')}>
            <span style={num}>{status.stale}</span>
          </Row>
        </>
      ) : null}
    </Group>
  )
}
