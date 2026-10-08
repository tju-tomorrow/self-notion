/**
 * 备份设置页那一节。
 *
 * 只走 `ctx` 拿能力（CONVENTIONS §6.2）：`ctx.rpc` 调命令、`ctx.i18n` 出字。
 * 状态是**薄缓存** —— 真相在 Rust 的 `meta` 表，这里只把 `backup:status` 的结果摆上去，
 * 每次动作后重新拉一遍（CONVENTIONS 第三 / 第四节）。
 *
 * ★ token 是**只进不出**：`backup:status` 不回 token，输入框永远从空开始，
 *   留空 = 「不改」；填了才随 `backup:configure` 送过去。
 */
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Context } from 'cordis'
import { Button, Field, Group, Note, Row, Switch } from '../../src/ui/settings'
import { confirmDialog } from '../../src/ui/confirm'
import { reportError } from '../../src/kernel/errors'
import { loading, spinner } from './ui.css'

/** `backup:status` 的返回（Rust `backup::status`）。 */
interface BackupStatus {
  configured: boolean
  enabled: boolean
  repo: string
  branch: string
  hasToken: boolean
  lastAt: number | null
  lastCommit: string
  count: number
}

/** `backup:detectToken` 的返回（永不回 token，只有来源和登录名）。 */
interface DetectTokenResult {
  found: boolean
  login: string
  source: string
}

/** `backup:repos` 列表里的一项。 */
interface Repo {
  fullName: string
  private: boolean
  defaultBranch: string
  updatedAt: string
  description: string
}

/** `backup:now` 的返回。 */
interface NowResult {
  pushed: boolean
  reason?: string
  commit?: string
  changed?: number
  deleted?: number
  count?: number
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function fmtTime(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleString()
}

const repoText: CSSProperties = {
  fontFamily: 'var(--affine-font-code-family)',
  fontSize: 12,
  color: 'var(--affine-v2-text-primary)',
}

// 仓库可能很多，给个高度上限让它滚
const repoList: CSSProperties = {
  maxHeight: 240,
  overflowY: 'auto',
  border: '1px solid var(--affine-v2-layer-insideBorder-border, rgba(255,255,255,.09))',
  borderRadius: 8,
}

const repoItem: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'none',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

const repoTag: CSSProperties = { fontSize: 12, color: 'var(--affine-v2-text-secondary)' }

const repoNewRow: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }

export function BackupSection({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t

  // 表单（薄缓存，load 时由 status 填一次）；repo 只读，改它只走选择/新建
  const [branch, setBranch] = useState('main')
  const [token, setToken] = useState('')
  const [enabled, setEnabled] = useState(false)

  // 仓库那两块内联面板互斥：pick = 选已有、new = 新建
  const [panel, setPanel] = useState<'pick' | 'new' | null>(null)
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [newName, setNewName] = useState('')

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const st = await ctx.rpc.call<BackupStatus>('backup:status')
    setStatus(st)
    setBranch(st.branch)
    setEnabled(st.enabled)
    return st
  }, [ctx])

  useEffect(() => {
    refresh().catch((e: unknown) => setError(errText(e)))
  }, [refresh])

  /** 每个动作前后统一：清消息 → 标记忙 → 跑 → 落消息（成功/失败都留痕）。 */
  const run = useCallback(async (name: string, fn: () => Promise<string>) => {
    setBusy(name)
    setError('')
    setNote('')
    try {
      setNote(await fn())
    } catch (e) {
      reportError('backup-github', e)
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }, [])

  // 保存只管分支和手输 token —— 开关、仓库都是即点即生效，不经过这里
  const save = () =>
    run('save', async () => {
      await ctx.rpc.call('backup:configure', {
        branch,
        // 空 = 不改 token；填了才送
        ...(token ? { token } : {}),
      })
      setToken('')
      await refresh()
      return t('backup.saved')
    })

  // ★ 开关**点了就落库**。以前它只是本地 state，要等「保存」—— 于是出现「开关亮着、
  //   立即备份却报『备份没开』」。失败退回原值。
  const toggleEnabled = useCallback(
    async (on: boolean) => {
      setEnabled(on)
      try {
        await ctx.rpc.call('backup:configure', { enabled: on })
        await refresh()
      } catch (e) {
        setEnabled(!on)
        reportError('backup-github', e)
        setError(errText(e))
      }
    },
    [ctx, refresh],
  )

  const detectToken = () =>
    run('tokenAuto', async () => {
      const r = await ctx.rpc.call<DetectTokenResult>('backup:detectToken')
      if (!r.found) return t('backup.tokenAutoFail')
      setToken('')
      await refresh()
      return t('backup.tokenAutoOk', { login: r.login })
    })

  const toggleRepos = () => {
    if (panel === 'pick') {
      setPanel(null)
      return
    }
    setPanel('pick')
    setRepos(null)
    void run('repos', async () => {
      try {
        setRepos((await ctx.rpc.call<{ repos: Repo[] }>('backup:repos')).repos)
      } catch (e) {
        setRepos([]) // 失败也收掉转圈，错误由 run 落到 note 上
        throw e
      }
      return ''
    })
  }

  const toggleNew = () => {
    const next = panel === 'new' ? null : 'new'
    setPanel(next)
    setNewName('')
    setError('')
    setNote('')
  }

  const pickRepo = (fullName: string) =>
    run('pickRepo', async () => {
      await ctx.rpc.call('backup:configure', { repo: fullName })
      await refresh()
      setPanel(null)
      return t('backup.saved')
    })

  const createRepo = () =>
    run('create', async () => {
      await ctx.rpc.call<{ repo: string }>('backup:createRepo', { name: newName.trim() })
      setNewName('')
      await refresh()
      setPanel(null)
      return t('backup.saved')
    })

  const backupNow = () =>
    run('now', async () => {
      const r = await ctx.rpc.call<NowResult>('backup:now')
      await refresh()
      return r.pushed
        ? t('backup.pushed', { n: r.changed ?? 0 })
        : t('backup.uptodate')
    })

  const restore = async () => {
    const ok = await confirmDialog({
      title: t('backup.restoreConfirm'),
      ok: t('backup.restoreOk'),
      danger: true,
    })
    if (!ok) return
    await run('restore', async () => {
      const r = await ctx.rpc.call<{ restored: number }>('backup:restore')
      await refresh()
      // 恢复只写库；编辑器内存里那份 Y.Doc 不会回退 —— 重新加载才是真的生效。
      setTimeout(() => window.location.reload(), 1200)
      return t('backup.restored', { n: r.restored })
    })
  }

  const last = status?.lastAt ?? null

  /** 「— · 12 篇 · a1b2c3d」那一行。 */
  const lastLine = (): string => {
    const parts = [status === null ? '—' : fmtTime(last)]
    if (status && status.count > 0) parts.push(t('backup.count', { n: status.count }))
    if (status?.lastCommit) parts.push(status.lastCommit.slice(0, 7))
    return parts.join(' · ')
  }

  return (
    <Group>
      <Row label={t('backup.enable')} desc={t('backup.enableHint')}>
        <Switch on={enabled} onChange={(v) => void toggleEnabled(v)} label={t('backup.enable')} />
      </Row>

      <Row label={t('backup.repo')}>
        <span style={repoText}>{status?.repo || 'owner/name'}</span>
        <Button onClick={toggleRepos} disabled={busy !== null}>
          {t('backup.pickRepo')}
        </Button>
        <Button onClick={toggleNew} disabled={busy !== null}>
          {t('backup.newRepo')}
        </Button>
      </Row>

      {panel === 'pick' ? (
        <div style={repoList}>
          {repos === null ? (
            <div className={loading}>
              <span className={spinner} />
              {t('backup.loading')}
            </div>
          ) : repos.length === 0 ? (
            <Note>{t('backup.repoListEmpty')}</Note>
          ) : (
            repos.map((r) => (
              <button
                key={r.fullName}
                type="button"
                disabled={busy !== null}
                onClick={() => void pickRepo(r.fullName)}
                style={repoItem}
              >
                <span>{r.fullName}</span>
                {r.private ? <span style={repoTag}>{t('backup.repoPrivate')}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}

      {panel === 'new' ? (
        <div style={repoNewRow}>
          <Field
            value={newName}
            onChange={setNewName}
            placeholder={t('backup.newRepoPlaceholder')}
            width={260}
          />
          <Button
            variant="primary"
            onClick={createRepo}
            disabled={busy !== null || newName.trim() === ''}
          >
            {t('backup.create')}
          </Button>
          <Button onClick={() => setPanel(null)} disabled={busy !== null}>
            {t('backup.cancel')}
          </Button>
        </div>
      ) : null}

      <Row label={t('backup.branch')}>
        <Field value={branch} onChange={setBranch} width={160} />
      </Row>

      <Row label={t('backup.token')} desc={t('backup.tokenHint')}>
        <Field
          value={token}
          onChange={setToken}
          type="password"
          mono
          width={260}
          placeholder={status?.hasToken ? t('backup.tokenKept') : t('backup.tokenPlaceholder')}
        />
        <Button onClick={detectToken} disabled={busy !== null}>
          {t('backup.tokenAuto')}
        </Button>
      </Row>

      <Row label={t('backup.last')} desc={lastLine()}>
        <Button variant="primary" onClick={save} disabled={busy !== null}>
          {t('backup.save')}
        </Button>
        <Button onClick={backupNow} disabled={busy !== null}>
          {t('backup.now')}
        </Button>
        <Button onClick={() => void restore()} disabled={busy !== null}>
          {t('backup.restore')}
        </Button>
      </Row>

      {note ? <Note tone="ok">{note}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
    </Group>
  )
}
