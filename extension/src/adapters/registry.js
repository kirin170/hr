/**
 * 适配器注册表：独立开关、版本、灰度与回滚（FR-EXT-9～11）。
 *
 * 设计约束：
 * - 每个平台一个适配器，互不影响；关掉一个不影响邮箱与手工入口。
 * - 灰度按操作者稳定分桶，同一个人在同一版本上结果恒定，不会来回抖动。
 * - 回滚就是把 activeVersion 指回上一个版本，不需要重新发版。
 * - 本文件不含任何真实平台选择器：BOSS/猎聘适配器未交付，注册表里只有测试夹具。
 */

/** 稳定分桶：同一 operatorId + adapterId 恒定落在 0～99。 */
export function bucket(operatorId, adapterId) {
  const input = `${adapterId}:${operatorId}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

export class AdapterRegistry {
  constructor(entries = []) {
    this.entries = new Map();
    for (const entry of entries) this.register(entry);
  }

  register(entry) {
    if (!entry?.id || !Array.isArray(entry.versions) || !entry.versions.length) throw new Error('invalid_adapter');
    if (!entry.versions.some((v) => v.version === entry.activeVersion)) throw new Error('unknown_active_version');
    this.entries.set(entry.id, { ...entry });
  }

  list() {
    return [...this.entries.values()].map((e) => ({
      id: e.id, name: e.name, enabled: e.enabled, activeVersion: e.activeVersion,
      rolloutPercent: e.rolloutPercent, hosts: [...e.hosts], testOnly: !!e.testOnly,
      versions: e.versions.map((v) => v.version),
    }));
  }

  setEnabled(id, enabled) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('unknown_adapter');
    entry.enabled = !!enabled;
  }

  /** 灰度比例 0～100；0 表示全员不启用，100 表示全量。 */
  setRollout(id, percent) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('unknown_adapter');
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('invalid_rollout');
    entry.rolloutPercent = percent;
  }

  /** 切换生效版本；指向历史版本即为回滚。 */
  setActiveVersion(id, version) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('unknown_adapter');
    if (!entry.versions.some((v) => v.version === version)) throw new Error('unknown_version');
    entry.activeVersion = version;
  }

  /**
   * 解析当前操作者在某站点上可用的适配器。
   * 返回 null 表示不适用（未启用、未命中灰度、站点不匹配），调用方必须显式提示未支持，
   * 不得回落到"猜测页面结构"。
   */
  resolve(host, operatorId) {
    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if (!entry.hosts.includes(host)) continue;
      if (bucket(operatorId, entry.id) >= entry.rolloutPercent) continue;
      const version = entry.versions.find((v) => v.version === entry.activeVersion);
      return { id: entry.id, version: version.version, testOnly: !!entry.testOnly, extract: version.extract };
    }
    return null;
  }
}

/**
 * 适配器契约：extract(document) → { sourceCandidateId, pagePayload, resumeUrl? }
 * - pagePayload 只允许 ATS-010 白名单字段，多余字段由服务端丢弃。
 * - resumeUrl 只供扩展自己取字节，绝不传给服务端下载。
 * - 不得读取或返回 cookie、authorization、token 等任何凭据字段。
 */
export const ADAPTER_CONTRACT_FIELDS = [
  'name', 'phone', 'email', 'currentCompany', 'currentTitle',
  'education', 'school', 'experience', 'expectedCity', 'summary',
];

/** 本地夹具适配器：仅用于自测，不对应任何真实招聘平台。 */
export const fixtureAdapter = {
  id: 'fixture.local',
  name: '本地夹具（仅测试）',
  enabled: true,
  activeVersion: '1.0.0',
  rolloutPercent: 100,
  hosts: ['127.0.0.1:4174', 'localhost:4174'],
  testOnly: true,
  versions: [
    {
      version: '1.0.0',
      extract(doc) {
        const read = (key) => doc.querySelector(`[data-field="${key}"]`)?.textContent?.trim() ?? '';
        const pagePayload = {};
        for (const field of ADAPTER_CONTRACT_FIELDS) {
          const value = read(field);
          if (value) pagePayload[field] = value;
        }
        return {
          sourceCandidateId: read('sourceCandidateId'),
          pagePayload,
          resumeUrl: doc.querySelector('[data-resume]')?.getAttribute('data-resume') ?? null,
        };
      },
    },
    {
      // 保留一个历史版本，用于验证回滚路径确实可切换。
      version: '0.9.0',
      extract(doc) {
        return { sourceCandidateId: doc.querySelector('[data-field="sourceCandidateId"]')?.textContent?.trim() ?? '', pagePayload: {}, resumeUrl: null };
      },
    },
  ],
};

export function createDefaultRegistry() {
  return new AdapterRegistry([fixtureAdapter]);
}