/**
 * 主题那一段设置页：画廊 + 6 个种子色 + 我的主题（存/导出/导入/删）+ 三幅插图。
 *
 * ★ 每点一下**立刻生效**：写的是 `ctx.settings` 的草稿，`apply.ts` 订着它重画（不重载页面）。
 * ★ 明暗 ≠ 主题（D-0149）：当前明暗不是主题那一档时，主题不生效，这里如实说 + 一颗按钮。
 */
import { useEffect, useState, type ChangeEvent } from 'react'
import type { Context } from 'cordis'
import type { ThemeController } from '../../src/theme/tokens'
import { confirmDialog } from '../../src/ui/confirm'
import { Button, Field, Group, Note, Row, Select } from '../../src/ui/settings'
import { BG_POS_DEFAULT, BG_STRENGTH_DEFAULT, BG_STRENGTH_MAX, BG_STRENGTH_MIN } from './art'
import { editBaseOf } from './builtin'
import {
  ACTIVE_KEY,
  DRAFT_KEY,
  USERS_KEY,
  activeId,
  activeTheme,
  clearDraft,
  draft,
  listThemes,
  removeUser,
  resolved,
  saveUser,
  setActive,
  setBackground,
  setDraft,
} from './store'
import type { BgSize, Seeds, Theme } from './types'
import * as p from './theme.css'

/** 背景图先缩到这个边长再存。用户的意思是「什么尺寸都适应」—— 不是拒绝大图，是替他缩。 */
const ART_MAX_PX = 1400

/** 上传前的一道底线。缩到 1400 之后正常远低于它；挡住的是 SVG 那条**不过 canvas**的路
 *  （原样存，所以用户选一个 50MB 的 SVG 也拦不住，得在这儿拦）。 */
const ART_MAX_BYTES = 12 * 1024 * 1024

const SEED_ROWS = [
  ['canvas', 'theme.seed.canvas'],
  ['sidebar', 'theme.seed.sidebar'],
  ['surface', 'theme.seed.surface'],
  ['accent', 'theme.seed.accent'],
  ['text', 'theme.seed.text'],
  ['border', 'theme.seed.border'],
] as const satisfies readonly (readonly [keyof Seeds, string])[]

/** 订阅四件事重画：三个设置键 + 明暗（明暗闸门要重算）。 */
function useLive(ctx: Context): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    const offs = [ACTIVE_KEY, USERS_KEY, DRAFT_KEY].map((key) => ctx.settings.onChange(key, bump))
    const offTheme = ctx.theme.onChange(bump)
    return () => {
      for (const off of offs) off()
      offTheme()
    }
  }, [ctx])
}

function pick(ctx: Context, theme: Theme): void {
  setActive(ctx, theme.id)
  // 带色主题自带明暗：顺手帮用户切过去（之后不再抢，见 D-0149）。
  if (theme.scheme && theme.scheme !== ctx.theme.scheme) {
    ;(ctx.theme as ThemeController).set(theme.scheme)
  }
}

function swatchOf(ctx: Context, theme: Theme): Seeds {
  return theme.seeds ?? editBaseOf(theme, ctx.theme.scheme)
}

/** 删一张我的主题之前问一句 —— 删掉就是真没了（它不在库里，就是设置里一段 JSON）。 */
async function askRemove(ctx: Context, theme: Theme): Promise<void> {
  const ok = await confirmDialog({
    title: ctx.i18n.t('theme.delete.confirm', { name: theme.name }),
    body: ctx.i18n.t('theme.delete.confirm.body'),
    ok: ctx.i18n.t('common.delete'),
    danger: true,
  })
  if (ok) removeUser(ctx, theme.id)
}

function Gallery({ ctx }: { ctx: Context }) {
  const current = activeId(ctx)
  return (
    <div className={p.gallery} role="radiogroup" aria-label={ctx.i18n.t('theme.current')}>
      {listThemes(ctx).map((theme) => {
        const s = swatchOf(ctx, theme)
        // 卡片是 div 不是 button：button 里嵌不了删除键（嵌套交互元素）。
        return (
          <div
            key={theme.id}
            role="radio"
            tabIndex={0}
            aria-checked={theme.id === current}
            className={theme.id === current ? `${p.card} ${p.cardOn}` : p.card}
            onClick={() => pick(ctx, theme)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              pick(ctx, theme)
            }}
          >
            <span className={p.preview} style={{ background: s.canvas }}>
              <span className={p.previewBar} style={{ background: s.sidebar }} />
              <span className={p.previewDot} style={{ background: s.accent }} />
              <span className={p.previewLine} style={{ background: s.text }} />
              <span className={`${p.previewLine2}`} style={{ background: s.text }} />
            </span>
            <span className={p.name}>{theme.name}</span>
            {/* 只有「我的主题」能删：内置那两套是产品的一部分，删了重启还在 —— 假删除比不给删更糟。 */}
            {theme.user ? (
              <button
                type="button"
                className={p.cardDel}
                title={ctx.i18n.t('theme.delete')}
                aria-label={`${ctx.i18n.t('theme.delete')}${theme.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void askRemove(ctx, theme)
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function Bits({ ctx }: { ctx: Context }) {
  const theme = activeTheme(ctx)
  const d = draft(ctx)
  const seeds = { ...swatchOf(ctx, theme), ...d }
  const t = (key: string, vars?: Record<string, string>) => ctx.i18n.t(key, vars)

  return (
    <Group title={t('theme.colors')} desc={t('theme.colors.desc')}>
      {/* ★ 撤销摆在**第一行**：第一版排在 6 个色井 + 圆角后面，掉到屏幕外 = 等于没有
          （用户 2026-10-08：「怎么没有恢复默认 我调了一下回不去了」）。
          没调过就不画这一行 —— 摆一颗灰按钮只会让人以为坏了。 */}
      {Object.keys(d).length ? (
        <Row label={t('theme.colors.reset')} desc={t('theme.colors.reset.desc', { name: theme.name })}>
          <Button variant="primary" onClick={() => clearDraft(ctx)}>
            {t('theme.reset')}
          </Button>
        </Row>
      ) : null}
      {SEED_ROWS.map(([key, label]) => (
        <Row key={key} label={t(label)}>
          <input
            type="color"
            value={seeds[key]}
            aria-label={t(label)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(ctx, { [key]: e.target.value })}
          />
        </Row>
      ))}
      <Row label={t('theme.radius')}>
        <input
          type="range"
          min={0}
          max={24}
          step={1}
          // ★ 草稿在前：主题自带 radius（夜空是 12）时，写反了滑块就被钉死在 12 上，
          //   拖不动（用户 2026-10-08：「圆角那个都不能滑」）。渲染值和下面那 6 个色井同序。
          value={d.radius ?? theme.radius ?? 0}
          aria-label={t('theme.radius')}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(ctx, { radius: Number(e.target.value) })}
        />
      </Row>
    </Group>
  )
}

function Mine({ ctx }: { ctx: Context }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const t = (key: string, vars?: Record<string, string>) => ctx.i18n.t(key, vars)
  const theme = activeTheme(ctx)
  const saveable = !!resolved(ctx).seeds && (Object.keys(draft(ctx)).length > 0 || theme.user)

  const doSave = () => {
    const saved = saveUser(ctx, { name: name || theme.name })
    setName('')
    setNote(t('theme.saved', { name: saved.name }))
  }

  const doExport = () => {
    const live = resolved(ctx)
    const blob = new Blob([JSON.stringify({ ...live, id: undefined, user: undefined }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${theme.name || 'theme'}.json`
    a.click()
    // 点完就撤 —— 留着占内存（同 import-notion 的立场）
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const doImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void file.text().then((text) => {
      try {
        const raw = JSON.parse(text) as Partial<Theme>
        if (!raw || typeof raw !== 'object' || !raw.seeds) throw new Error('no seeds')
        const theme: Theme = {
          id: `user:${Date.now().toString(36)}`,
          name: String(raw.name ?? file.name.replace(/\.json$/, '')) || '我的主题',
          scheme: raw.scheme ?? null,
          seeds: raw.seeds,
          radius: raw.radius,
          background: raw.background,
          bgStrength: raw.bgStrength,
          bgSize: raw.bgSize,
          bgPos: raw.bgPos,
          user: true,
        }
        ctx.settings.set(USERS_KEY, [...listThemes(ctx).filter((x) => x.user), theme])
        ctx.settings.set(ACTIVE_KEY, theme.id)
        ctx.settings.set(DRAFT_KEY, {})
        setNote(t('theme.saved', { name: theme.name }))
      } catch {
        setNote(t('theme.import.bad'))
      }
    })
  }

  return (
    <Group title={t('theme.mine')} desc={t('theme.mine.desc')}>
      <Row label={t('theme.name')}>
        <Field value={name} onChange={setName} placeholder={theme.name} width={180} />
      </Row>
      <Row label={t('theme.save')} desc={t('theme.save.desc')}>
        <div className={p.picks}>
          <Button variant="primary" onClick={doSave} disabled={!saveable}>
            {t('theme.save')}
          </Button>
          <Button onClick={doExport} disabled={!resolved(ctx).seeds}>
            {t('theme.export')}
          </Button>
          <label className={p.fileBtn}>
            {t('theme.import')}
            <input type="file" accept="application/json,.json" hidden onChange={doImport} />
          </label>
        </div>
      </Row>
      {note ? <Note tone="ok">{note}</Note> : null}
    </Group>
  )
}

/**
 * 读一张图 → 缩到能存的尺寸 → 落进库里的 blob。
 *
 * ★ 用户的要求是「不论什么格式、什么尺寸都适应」（2026-10-08）—— 所以**不按原图大小拒绝**：
 *   先让浏览器解码（macOS / Windows 上能解的格式几乎都覆盖，含 HEIC / WebP / AVIF），
 *   再画到 canvas 上按最长边缩到 `ART_MAX_PX`，然后重新编码。
 * ★ **不羽化**：羽化是给"局部贴图"打的补丁（怕硬边），而背景是**铺满**的，铺满就没有边。
 *   用户 2026-10-08：「不能虚化掉他的图片痕迹」—— 图该什么样就什么样。
 * ★ SVG **原样存**：它本来就无限缩放，栅格化反而会糊；而且没有 intrinsic size 的 SVG
 *   画到 canvas 上在 WebKit 里会得到一张空白。
 * ★ 编码走 WebP（编不动时浏览器自己退回 PNG）：比 PNG 小一个量级，透明也保得住。
 */
function normalize(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('decode'))
    }
    img.onload = () => {
      const done = (url: string) => {
        URL.revokeObjectURL(objectUrl)
        resolve(url)
      }
      if (/svg/i.test(file.type)) {
        const reader = new FileReader()
        reader.onload = () =>
          typeof reader.result === 'string' ? done(reader.result) : reject(new Error('read'))
        reader.onerror = () => reject(new Error('read'))
        reader.readAsDataURL(file)
        return
      }
      const scale = Math.min(1, ART_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g = canvas.getContext('2d')
      if (!g) return reject(new Error('canvas'))
      g.drawImage(img, 0, 0, w, h)
      // ★ 不再羽化：羽化是给"局部贴图"打的补丁（怕硬边），而现在背景是**铺满**的 ——
      //   铺满就没有边。用户 2026-10-08：「不能虚化掉他的图片痕迹」—— 图该什么样就什么样。
      done(canvas.toDataURL('image/webp', 0.92))
    }
    img.src = objectUrl
  })
}

/**
 * 图存成 **blob**（`blob:put`，Rust 侧按内容 sha256 去重），设置里只留一句
 * `self-notion://blob/<id>`。★ 原来是把 base64 直接塞进设置 —— 实测一段设置长到 **5.6MB**
 * （`setting.theme.users`），而设置是**启动时全量读**的，等于每次开机搬 5.6MB；
 * 而且同一张图放三个角就是三份拷贝。走 blob 三样一起解决：设置变小、同一张图只存一份、
 * 尺寸不再受"设置要能存下"的约束。
 * 协议得在 CSP 的 `img-src` 里 —— `self-notion:` 本来就有（文档封面就是这么显示的）。
 */
async function putArt(ctx: Context, dataUrl: string): Promise<string> {
  const comma = dataUrl.indexOf(',')
  const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
  const meta = await ctx.rpc.call<{ id: string }>('blob:put', {
    bytes: dataUrl.slice(comma + 1),
    mime,
  })
  return `url("self-notion://blob/${meta.id}")`
}

/**
 * 背景那一组：**一张图**（不是多处贴图，用户 2026-10-08）+ 一根「浓度」。
 *
 * 浓度走**草稿**（跟颜色、圆角一个路数）：拖着就变，落盘靠「存成我的主题」；
 * 换图则是直接写进「我的主题」—— 因为图已经落到 blob 里了，草稿里只留一句 URL 更绕。
 */
/** 九宫格里那个小点靠哪边 —— 位置控件长这样，看一眼就知道指的是哪边。 */
const ALIGN = { 0: 'flex-start', 50: 'center', 100: 'flex-end' } as const

const X_KEY = { 0: 'theme.dir.left', 50: 'theme.dir.center', 100: 'theme.dir.right' } as const
const Y_KEY = { 0: 'theme.dir.top', 50: 'theme.dir.center', 100: 'theme.dir.bottom' } as const

/** 词条的模板按语言给（中文「左上」、英文「top left」），所以顺序交给词条，不在这儿拼。 */
function posLabel(ctx: Context, x: 0 | 50 | 100, y: 0 | 50 | 100): string {
  return ctx.i18n.t('theme.art.pos.cell', {
    x: ctx.i18n.t(X_KEY[x]),
    y: ctx.i18n.t(Y_KEY[y]),
  })
}

function BackgroundRows({ ctx }: { ctx: Context }) {
  const [note, setNote] = useState<string | null>(null)
  const t = (key: string) => ctx.i18n.t(key)
  const theme = resolved(ctx)
  const strength = theme.bgStrength ?? BG_STRENGTH_DEFAULT
  const pos = theme.bgPos ?? BG_POS_DEFAULT

  const read = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void normalize(file)
      .then((dataUrl) => {
        if (dataUrl.length > ART_MAX_BYTES) throw new Error('huge')
        return putArt(ctx, dataUrl)
      })
      .then((url) => {
        setBackground(ctx, url)
        setNote(null)
      })
      .catch((err: unknown) =>
        setNote(t(err instanceof Error && err.message === 'huge' ? 'theme.art.tooBig' : 'theme.art.bad')),
      )
  }

  return (
    <Group title={t('theme.art')} desc={t('theme.art.desc')}>
      <Row label={t('theme.art.image')} desc={t('theme.art.pick.desc')}>
        <div className={p.picks}>
          <label className={p.fileBtn}>
            {theme.background ? t('theme.art.replace') : t('theme.art.pick')}
            <input type="file" accept="image/*" hidden onChange={read} />
          </label>
          <Button onClick={() => setBackground(ctx, null)} disabled={!theme.background}>
            {t('theme.art.clear')}
          </Button>
        </div>
      </Row>
      <Row label={t('theme.art.size')} desc={t('theme.art.size.desc')}>
        <Select
          value={theme.bgSize ?? 'cover'}
          ariaLabel={t('theme.art.size')}
          onChange={(v) => setDraft(ctx, { bgSize: v as BgSize })}
          options={[
            { value: 'cover', label: t('theme.art.size.cover') },
            { value: 'contain', label: t('theme.art.size.contain') },
            { value: 'original', label: t('theme.art.size.original') },
            { value: 'stretch', label: t('theme.art.size.stretch') },
          ]}
        />
      </Row>
      <Row label={t('theme.art.pos')} desc={t('theme.art.pos.desc')}>
        <div className={p.posGrid}>
          {([0, 50, 100] as const).map((y) =>
            ([0, 50, 100] as const).map((x) => {
              const on = pos.x === x && pos.y === y
              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  aria-label={posLabel(ctx, x, y)}
                  aria-pressed={on}
                  className={on ? `${p.posCell} ${p.posCellOn}` : p.posCell}
                  style={{ alignItems: ALIGN[y], justifyContent: ALIGN[x] }}
                  onClick={() => setDraft(ctx, { bgPos: { x, y } })}
                >
                  <span className={p.posDot} />
                </button>
              )
            }),
          )}
        </div>
      </Row>
      <Row label={t('theme.art.strength')} desc={t('theme.art.strength.desc')}>
        <input
          type="range"
          min={BG_STRENGTH_MIN}
          max={BG_STRENGTH_MAX}
          step={1}
          value={strength}
          aria-label={t('theme.art.strength')}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setDraft(ctx, { bgStrength: Number(e.target.value) })
          }
        />
        <span className={p.pct}>{strength}%</span>
      </Row>
      {note ? <Note tone="error">{note}</Note> : null}
    </Group>
  )
}

export function ThemeSection({ ctx }: { ctx: Context }) {
  useLive(ctx)
  const theme = activeTheme(ctx)
  const t = (key: string, vars?: Record<string, string>) => ctx.i18n.t(key, vars)
  const blocked = !!theme.seeds && !!theme.scheme && theme.scheme !== ctx.theme.scheme
  // 调过就抬头告诉他一声 —— 「我调了东西但不知道撤哪儿」是这版唯一的抱怨来源。
  const tweaked = Object.keys(draft(ctx)).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Group title={t('theme.current')} desc={t('theme.desc')}>
        {tweaked ? <Note>{t('theme.tweaked', { name: theme.name, n: String(tweaked) })}</Note> : null}
        <Gallery ctx={ctx} />
      </Group>
      {/* ★ 插图紧挨着画廊，别放段尾 —— 第一版排在颜色和「我的主题」后面，用户找不到
          （他报的是「UI 让这里可以添加图片」，其实早就能，只是没看见）。 */}
      <BackgroundRows ctx={ctx} />
      {blocked ? (
        <Row label={t('theme.darkOnly', { name: theme.name })} desc={t('theme.darkOnly.desc')}>
          <Button
            variant="primary"
            onClick={() => (ctx.theme as ThemeController).set(theme.scheme ?? 'dark')}
          >
            {t('theme.goDark')}
          </Button>
        </Row>
      ) : null}
      <Bits ctx={ctx} />
      <Mine ctx={ctx} />
    </div>
  )
}
