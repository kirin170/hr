import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

const API_BASE = 'https://api.dingtalk.com';
const OAPI_BASE = 'https://oapi.dingtalk.com';
const REQUEST_TIMEOUT_MS = 8_000;
const RATE_LIMIT_CODES = new Set(['-1', '88', '90002', '90018']);
const INVALID_TOKEN_CODES = new Set(['40014', '40001']);

export class DingTalkApiError extends Error {
  constructor(
    readonly code: string | number,
    readonly retryable: boolean,
  ) {
    super('钉钉接口调用失败');
    this.name = 'DingTalkApiError';
  }
}

export type DingTalkDepartmentRecord = {
  dept_id: number;
  name: string;
  parent_id: number;
};

export type DingTalkUserRecord = {
  userid: string;
  name: string;
  dept_id_list: number[];
  job_number?: string;
  email?: string;
  unionid?: string;
};

type AppToken = { token: string; expiresAt: number };

/** One process-wide app token cache shared by OAuth identity resolution and directory sync. */
export class DingTalkApiClient {
  private appToken: AppToken | null = null;
  private appTokenInFlight: Promise<string> | null = null;

  getAuthorizationUrl(state: string): string {
    const config = this.oauthConfiguration();
    const url = new URL('https://login.dingtalk.com/oauth2/auth');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid corpid');
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('corpId', config.corpId);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async resolveUserIdFromAuthorizationCode(code: string): Promise<string> {
    const config = this.oauthConfiguration();
    const userToken = await this.postJson<{
      accessToken?: string;
      corpId?: string;
    }>(`${API_BASE}/v1.0/oauth2/userAccessToken`, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      grantType: 'authorization_code',
    });

    if (!userToken.accessToken || userToken.corpId !== config.corpId) {
      throw new UnauthorizedException('钉钉登录组织不匹配或授权无效');
    }

    const me = await this.getJson<{ unionId?: string }>(
      `${API_BASE}/v1.0/contact/users/me`,
      userToken.accessToken,
    );
    if (!me.unionId) throw new UnauthorizedException('钉钉未返回可验证的身份');

    const resolved = await this.postOapi<{ result?: { userid?: string }; userid?: string }>(
      'topapi/user/getbyunionid',
      { unionid: me.unionId },
    );
    const userId = resolved.result?.userid ?? resolved.userid;
    if (!userId) throw new UnauthorizedException('钉钉身份尚未同步到通讯录');
    return userId;
  }

  async listChildDepartments(parentDepartmentId: number): Promise<DingTalkDepartmentRecord[]> {
    const result = await this.postOapi<{
      result?: unknown;
      department?: unknown;
    }>('topapi/v2/department/listsub', { dept_id: parentDepartmentId });
    const nested = this.asRecord(result.result);
    const rows = Array.isArray(result.result)
      ? result.result
      : Array.isArray(nested?.department)
        ? nested.department
        : Array.isArray(result.department)
          ? result.department
          : [];
    return rows.flatMap((row) => {
      const department = this.asRecord(row);
      const deptId = this.numeric(department?.dept_id);
      const parentId = this.numeric(department?.parent_id);
      if (!department || deptId === null || parentId === null || typeof department.name !== 'string') {
        return [];
      }
      return [{ dept_id: deptId, name: department.name, parent_id: parentId }];
    });
  }

  async getDepartment(departmentId: number): Promise<DingTalkDepartmentRecord> {
    const result = await this.postOapi<{ result?: unknown }>(
      'topapi/v2/department/get',
      { dept_id: departmentId },
    );
    const department = this.asRecord(result.result);
    const resolvedId = this.numeric(department?.dept_id);
    const parentId = this.numeric(department?.parent_id);
    if (
      !department ||
      resolvedId !== departmentId ||
      parentId === null ||
      typeof department.name !== 'string'
    ) {
      throw new DingTalkApiError('invalid_department_response', false);
    }
    return { dept_id: resolvedId, name: department.name, parent_id: parentId };
  }

  async listDepartmentUsers(departmentId: number): Promise<DingTalkUserRecord[]> {
    const users: DingTalkUserRecord[] = [];
    let cursor = 0;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore) {
      if (++pageCount > 10_000) {
        throw new DingTalkApiError('pagination_limit', false);
      }
      const result = await this.postOapi<{
        result?: {
          list?: unknown;
          has_more?: unknown;
          next_cursor?: unknown;
        };
      }>('topapi/v2/user/list', {
        dept_id: departmentId,
        cursor,
        size: 100,
        order_field: 'modify_desc',
        language: 'zh_CN',
        contain_access_limit: true,
      });
      const page = result.result;
      if (!page || page.list === undefined || page.list === null) {
        throw new DingTalkApiError('invalid_user_page', false);
      }
      const rows = Array.isArray(page.list) ? page.list : [page.list];
      users.push(...rows.flatMap((row) => {
        const user = this.normalizeUser(row);
        return user ? [user] : [];
      }));
      hasMore = page.has_more === true || page.has_more === 'true';
      const nextCursor = this.numeric(page.next_cursor);
      if (hasMore && (nextCursor === null || nextCursor === cursor)) {
        throw new DingTalkApiError('invalid_user_cursor', false);
      }
      if (hasMore) cursor = nextCursor!;
    }
    return users;
  }

  async getUser(userId: string): Promise<DingTalkUserRecord> {
    const result = await this.postOapi<{ result?: unknown }>(
      'topapi/v2/user/get',
      { userid: userId, language: 'zh_CN' },
    );
    const user = this.normalizeUser(result.result);
    if (!user) throw new DingTalkApiError('invalid_user_response', false);
    return user;
  }

  invalidateAppToken(): void {
    this.appToken = null;
  }

  private async getAppAccessToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now() + 60_000) {
      return this.appToken.token;
    }
    if (this.appTokenInFlight) return this.appTokenInFlight;

    this.appTokenInFlight = this.requestAppAccessToken();
    try {
      return await this.appTokenInFlight;
    } finally {
      this.appTokenInFlight = null;
    }
  }

  private async requestAppAccessToken(): Promise<string> {
    const config = this.appConfiguration();
    return this.retryRead(async () => {
      const url = `${API_BASE}/v1.0/oauth2/accessToken`;
      const result = await this.fetchJson<{
        accessToken?: string;
        expireIn?: number;
      }>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          appKey: config.clientId,
          appSecret: config.clientSecret,
        }),
      });
      if (!result.accessToken || !Number.isFinite(result.expireIn)) {
        throw new DingTalkApiError('invalid_app_token_response', false);
      }
      this.appToken = {
        token: result.accessToken,
        expiresAt: Date.now() + Number(result.expireIn) * 1000,
      };
      return result.accessToken;
    });
  }

  private async getJson<T>(url: string, userToken: string): Promise<T> {
    return this.fetchJson<T>(url, {
      method: 'GET',
      headers: { 'x-acs-dingtalk-access-token': userToken },
    });
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    return this.fetchJson<T>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async postOapi<T>(path: string, body: unknown): Promise<T> {
    return this.retryRead(async () => {
      const url = new URL(`${OAPI_BASE}/${path}`);
      url.searchParams.set('access_token', await this.getAppAccessToken());
      const form = new URLSearchParams();
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        for (const [key, value] of Object.entries(body)) {
          if (value !== undefined && value !== null) form.set(key, String(value));
        }
      }
      let payload: T & { errcode?: number | string; errmsg?: string };
      try {
        payload = await this.fetchJson<T & { errcode?: number | string; errmsg?: string }>(
          url.toString(),
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
            body: form,
          },
        );
      } catch (error) {
        if (
          error instanceof DingTalkApiError &&
          (INVALID_TOKEN_CODES.has(String(error.code)) || error.code === 'http_401')
        ) {
          this.invalidateAppToken();
        }
        throw error;
      }
      const errorCode = payload.errcode === undefined ? '0' : String(payload.errcode);
      if (errorCode !== '0') {
        const retryable = RATE_LIMIT_CODES.has(errorCode) || INVALID_TOKEN_CODES.has(errorCode);
        if (INVALID_TOKEN_CODES.has(errorCode)) this.invalidateAppToken();
        throw new DingTalkApiError(errorCode, retryable);
      }
      return payload;
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new DingTalkApiError('network_error', true);
    }
    if (!response.ok) {
      throw new DingTalkApiError(
        `http_${response.status}`,
        response.status === 401 || response.status === 429 || response.status >= 500,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DingTalkApiError('invalid_json', false);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new DingTalkApiError('invalid_response', false);
    }
    const data = payload as Record<string, unknown>;
    if (data.errcode !== undefined && this.errorCode(data.errcode) !== '0') {
      const code = this.errorCode(data.errcode);
      throw new DingTalkApiError(
        code,
        RATE_LIMIT_CODES.has(code) || INVALID_TOKEN_CODES.has(code),
      );
    }
    return payload as T;
  }

  private async retryRead<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        if (!(error instanceof DingTalkApiError) || !error.retryable || attempt >= 2) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
      }
    }
  }

  private appConfiguration() {
    const clientId = process.env.DINGTALK_CLIENT_ID;
    const clientSecret = process.env.DINGTALK_CLIENT_SECRET;
    const corpId = process.env.DINGTALK_CORP_ID;
    if (!clientId || !clientSecret || !corpId) {
      throw new ServiceUnavailableException('钉钉正式接入尚未配置');
    }
    return { clientId, clientSecret, corpId };
  }

  private oauthConfiguration() {
    const config = this.appConfiguration();
    const redirectUri = process.env.DINGTALK_REDIRECT_URI;
    if (!redirectUri) {
      throw new ServiceUnavailableException('钉钉正式接入尚未配置');
    }
    let parsedRedirect: URL;
    try {
      parsedRedirect = new URL(redirectUri);
    } catch {
      throw new ServiceUnavailableException('钉钉回调地址配置无效');
    }
    if (parsedRedirect.protocol !== 'https:' && process.env.APP_ENV !== 'local') {
      throw new ServiceUnavailableException('非本地环境的钉钉回调地址必须使用 HTTPS');
    }
    return { ...config, redirectUri: parsedRedirect.toString() };
  }

  private normalizeUser(value: unknown): DingTalkUserRecord | null {
    const user = this.asRecord(value);
    if (!user || typeof user.userid !== 'string' || !user.userid || typeof user.name !== 'string') {
      return null;
    }
    const values = Array.isArray(user.dept_id_list)
      ? user.dept_id_list
      : typeof user.dept_id_list === 'string'
        ? this.parseJsonArray(user.dept_id_list)
        : null;
    if (!values) return null;
    return {
      userid: user.userid,
      name: user.name,
      dept_id_list: values.flatMap((value) => {
        const id = this.numeric(value);
        return id === null ? [] : [id];
      }),
      job_number: this.string(user.job_number),
      email: this.string(user.email),
      unionid: this.string(user.unionid),
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private parseJsonArray(value: string): unknown[] | null {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private numeric(value: unknown): number | null {
    const number = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
    return Number.isSafeInteger(number) ? number : null;
  }

  private string(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private errorCode(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : 'invalid_error_code';
  }
}
