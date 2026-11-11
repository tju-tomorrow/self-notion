/** 设置页「侧栏」：六个入口各一个开关。关掉只是从左侧栏拿掉入口，页面本身还在。 */
import type { Context } from 'cordis'
import { Group, Row, Switch } from '../../src/ui/settings'
import { setNavVisible, useNavVisible, type NavId } from './visibility'

const ROWS: readonly { id: NavId; label: string }[] = [
  { id: 'recent', label: 'sidebar.group.recent' },
  { id: 'favorite', label: 'sidebar.group.favorite' },
  { id: 'pinned', label: 'sidebar.group.pinned' },
  { id: 'vfs', label: 'vfs.nav' },
  { id: 'inbox', label: 'kb.inbox.nav' },
  { id: 'graph', label: 'kb.graph.nav' },
]

export function SidebarSection({ ctx }: { ctx: Context }) {
  const visible = useNavVisible(ctx)
  return (
    <Group desc={ctx.i18n.t('sidebar.settings.desc')}>
      {ROWS.map(({ id, label }) => {
        const name = ctx.i18n.t(label)
        return (
          <Row key={id} label={name}>
            <Switch on={visible[id]} label={name} onChange={(on) => setNavVisible(ctx, id, on)} />
          </Row>
        )
      })}
    </Group>
  )
}
