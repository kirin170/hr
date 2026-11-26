import { useCallback, useEffect, useState } from 'react'
import { KeyRound, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react'
import * as api from '../../api'
import { useApp } from '../../context'
import type { AuthzGroup, AuthzRole, AuthzUser, FieldGrantRow } from '../../types'
import { cn } from '../../utils'
import { msg, scopeLabel } from './shared'

type AuthTab = 'roles' | 'groups' | 'grants'

export function AdminAuthPage() {
  const { toast } = useApp()
  const [tab, setTab] = useState<AuthTab>('roles')
  const [roles, setRoles] = useState<AuthzRole[]>([])
  const [groups, setGroups] = useState<AuthzGroup[]>([])
  const [users, setUsers] = useState<AuthzUser[]>([])
  const [grants, setGrants] = useState<FieldGrantRow[]>([])
  const [groupDraft, setGroupDraft] = useState({ code: '', name: '' })
  const [memberDraft, setMemberDraft] = useState({ groupId: '', userId: '' })
  const [grantDraft, setGrantDraft] = useState({
    field: 'CANDIDATE_CONTACT',
    targetType: 'USER' as 'USER' | 'GROUP',
    targetId: '',
    canRead: true,
    canWrite: false,
    expiresAt: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const [roleRows, groupRows, userRows, grantRows] = await Promise.all([
      api.listAuthzRoles().catch(() => [] as AuthzRole[]),
      api.listAuthzGroups().catch(() => [] as AuthzGroup[]),
      api.listAuthzUsers({ limit: 5000 }).catch(() => [] as AuthzUser[]),
      api.listFieldGrants().catch(() => [] as FieldGrantRow[]),
    ])
    setRoles(roleRows)
    setGroups(groupRows)
    setUsers(userRows)
    setGrants(grantRows)
    setMemberDraft((prev) => ({
      groupId: prev.groupId || groupRows[0]?.id || '',
      userId: prev.userId || userRows[0]?.id || '',
    }))
  }, [])

  useEffect(() => {
    let active = true
    void load().catch((err: unknown) => {
      if (active) setError(msg(err))
    })
    return () => {
      active = false
    }
  }, [load])

  const run = async (key: string, action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusy(key)
    setError('')
    try {
      await action()
      await load()
      toast(success)
      return true
    } catch (err) {
      const message = msg(err)
      setError(message)
      toast(message, 'info')
      return false
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="page-stack">
      <div className="page-title-row">
        <div>
          <div className="eyebrow">系统管理 <span className="eyebrow-separator">·</span> RBAC 与隐私授权</div>
          <h2>角色与权限</h2>
          <p>拆分查看系统角色数据范围、管理权限组成员，以及维护联系方式/背调/流水等敏感字段的独立授权。</p>
        </div>
        <div className="page-title-actions">
          <button className="button button-secondary" onClick={() => void run('reload', load, '权限数据已刷新')}>
            <RefreshCw size={15} />刷新
          </button>
        </div>
      </div>

      <div className="stage-tabs">
        <button className={cn('stage-tab', tab === 'roles' && 'active')} onClick={() => setTab('roles')}>
          <KeyRound size={14} />角色与数据范围 <span>{roles.length}</span>
        </button>
        <button className={cn('stage-tab', tab === 'groups' && 'active')} onClick={() => setTab('groups')}>
          <Users size={14} />权限组与成员 <span>{groups.length}</span>
        </button>
        <button className={cn('stage-tab', tab === 'grants' && 'active')} onClick={() => setTab('grants')}>
          <ShieldCheck size={14} />敏感字段授权 <span>{grants.length}</span>
        </button>
      </div>

      {error && <div className="admin-error" role="alert">{error}</div>}

      {tab === 'roles' && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>角色与数据范围</h3>
              <p className="hint">角色、数据范围与权限码由授权体系预置；点击「成员管理」可为人员分配角色。</p>
            </div>
          </div>
          <table className="admin-table">
            <thead><tr><th>角色</th><th>编码</th><th>数据范围</th><th>权限明细</th></tr></thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.code}>
                  <td><strong>{role.name}</strong></td>
                  <td><small className="mono-cell">{role.code}</small></td>
                  <td><span className="pill-tag">{scopeLabel(role.dataScope)}</span></td>
                  <td className="admin-note">
                    {role.permissions.map((item) => item.permission.code).join('、') || '暂无权限'}
                  </td>
                </tr>
              ))}
              {roles.length === 0 && <tr><td colSpan={4} className="empty-inline">无权限查看角色清单</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'groups' && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>权限组与成员</h3>
              <p className="hint">权限组用于按组批量授予敏感字段访问权；可先新建权限组再将成员加入组中。</p>
            </div>
          </div>
          <table className="admin-table">
            <thead><tr><th>权限组名称</th><th>编码</th><th>成员人数</th></tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <td><strong>{group.name}</strong></td>
                  <td><small className="mono-cell">{group.code}</small></td>
                  <td>{group._count?.members ?? 0} 人</td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td colSpan={3} className="empty-inline">暂无权限组</td></tr>}
            </tbody>
          </table>

          <div className="admin-inline-form">
            <input
              className="admin-input admin-input-sm"
              placeholder="权限组编码"
              value={groupDraft.code}
              onChange={(e) => setGroupDraft({ ...groupDraft, code: e.target.value })}
            />
            <input
              className="admin-input"
              placeholder="权限组名称"
              value={groupDraft.name}
              onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
            />
            <button
              className="button button-primary button-sm"
              disabled={!groupDraft.code.trim() || !groupDraft.name.trim() || busy === 'group-create'}
              onClick={() => {
                const payload = { code: groupDraft.code.trim(), name: groupDraft.name.trim() }
                void run('group-create', () => api.createAuthzGroup(payload), '权限组已创建')
                  .then((ok) => { if (ok) setGroupDraft({ code: '', name: '' }) })
              }}
            >
              新建权限组
            </button>
          </div>

          <div className="admin-inline-form">
            <select
              className="admin-select"
              value={memberDraft.groupId}
              onChange={(e) => setMemberDraft({ ...memberDraft, groupId: e.target.value })}
            >
              <option value="">选择目标权限组…</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name} ({group.code})</option>
              ))}
            </select>
            <select
              className="admin-select"
              value={memberDraft.userId}
              onChange={(e) => setMemberDraft({ ...memberDraft, userId: e.target.value })}
            >
              <option value="">选择成员…</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}{user.employeeNo ? ` (${user.employeeNo})` : ''}
                </option>
              ))}
            </select>
            <button
              className="button button-secondary button-sm"
              disabled={!memberDraft.groupId || !memberDraft.userId || busy === 'group-member-add'}
              onClick={() => {
                void run(
                  'group-member-add',
                  () => api.addAuthzGroupMember(memberDraft.groupId, memberDraft.userId),
                  '成员已加入权限组',
                )
              }}
            >
              添加成员到权限组
            </button>
          </div>
        </section>
      )}

      {tab === 'grants' && (
        <section className="panel admin-section">
          <div className="panel-header">
            <div>
              <h3>敏感字段授权</h3>
              <p className="hint">联系方式、背调材料、银行流水默认不可见，需按用户或权限组单独授权并设置有效期。</p>
            </div>
          </div>
          <table className="admin-table">
            <thead><tr><th>字段</th><th>对象</th><th>权限</th><th>到期</th><th>操作</th></tr></thead>
            <tbody>
              {grants.map((grant) => {
                const userName = grant.userId ? users.find((u) => u.id === grant.userId)?.displayName : null
                const groupName = grant.userGroupId ? groups.find((g) => g.id === grant.userGroupId)?.name : null
                return (
                  <tr key={grant.id}>
                    <td><strong>{grant.field}</strong></td>
                    <td><small>{grant.userId ? `用户：${userName || grant.userId}` : `权限组：${groupName || grant.userGroupId}`}</small></td>
                    <td>{grant.canRead ? '读' : ''}{grant.canWrite ? '写' : ''}</td>
                    <td>{grant.expiresAt ? grant.expiresAt.slice(0, 10) : '长期'}</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy === grant.id}
                        onClick={() => void run(grant.id, () => api.revokeFieldGrant(grant.id), '字段授权已撤销')}
                      >
                        <Trash2 size={13} />撤销
                      </button>
                    </td>
                  </tr>
                )
              })}
              {grants.length === 0 && <tr><td colSpan={5} className="empty-inline">暂无字段授权</td></tr>}
            </tbody>
          </table>

          <div className="admin-inline-form">
            <select
              className="admin-select"
              value={grantDraft.field}
              onChange={(e) => setGrantDraft({ ...grantDraft, field: e.target.value })}
            >
              <option value="CANDIDATE_CONTACT">联系方式</option>
              <option value="BACKGROUND_MATERIALS">背调材料</option>
              <option value="BANK_STATEMENTS">银行流水</option>
            </select>
            <select
              className="admin-select"
              value={grantDraft.targetType}
              onChange={(e) => setGrantDraft({ ...grantDraft, targetType: e.target.value as 'USER' | 'GROUP', targetId: '' })}
            >
              <option value="USER">按用户</option>
              <option value="GROUP">按权限组</option>
            </select>
            <select
              className="admin-select"
              value={grantDraft.targetId}
              onChange={(e) => setGrantDraft({ ...grantDraft, targetId: e.target.value })}
            >
              <option value="">{grantDraft.targetType === 'USER' ? '选择用户…' : '选择权限组…'}</option>
              {grantDraft.targetType === 'USER'
                ? users.map((u) => <option key={u.id} value={u.id}>{u.displayName}{u.employeeNo ? ` (${u.employeeNo})` : ''}</option>)
                : groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}
            </select>
            <label className="admin-check">
              <input type="checkbox" checked={grantDraft.canRead} onChange={(e) => setGrantDraft({ ...grantDraft, canRead: e.target.checked })} />读
            </label>
            <label className="admin-check">
              <input type="checkbox" checked={grantDraft.canWrite} onChange={(e) => setGrantDraft({ ...grantDraft, canWrite: e.target.checked })} />写
            </label>
            <input
              className="admin-input admin-input-sm"
              type="date"
              value={grantDraft.expiresAt}
              onChange={(e) => setGrantDraft({ ...grantDraft, expiresAt: e.target.value })}
            />
            <button
              className="button button-primary button-sm"
              disabled={!grantDraft.targetId || busy === 'grant-create'}
              onClick={() => {
                const payload = {
                  field: grantDraft.field,
                  userId: grantDraft.targetType === 'USER' ? grantDraft.targetId : undefined,
                  userGroupId: grantDraft.targetType === 'GROUP' ? grantDraft.targetId : undefined,
                  canRead: grantDraft.canRead,
                  canWrite: grantDraft.canWrite,
                  expiresAt: grantDraft.expiresAt ? new Date(`${grantDraft.expiresAt}T23:59:59+08:00`).toISOString() : undefined,
                }
                void run('grant-create', () => api.createFieldGrant(payload), '字段授权已创建')
              }}
            >
              授权
            </button>
          </div>
          <p className="hint">到期日期按北京时间当日 23:59:59 生效。</p>
        </section>
      )}
    </div>
  )
}
