import { afterEach, describe, expect, it, vi } from 'vitest';
import { DingTalkWorkNoticeClient } from './dingtalk-work-notice.client.js';

describe('work notice client', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('submits only the specified internal recipient and records the platform task id', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errcode: 0, task_id: 1234 })));
    vi.stubGlobal('fetch', fetch);
    const client = new DingTalkWorkNoticeClient();
    expect(await client.send('token', '42', 'user1', '请处理待办')).toBe('1234');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ userid_list: 'user1', to_all_user: false, agent_id: 42, msg: { msgtype: 'text' } });
    expect(body).not.toHaveProperty('dept_id_list');
    await expect(client.send('token', '42', 'user1,user2', 'content')).rejects.toMatchObject({ outcome: 'REJECTED' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not treat an ambiguous submit timeout as safe to retry', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network')); vi.stubGlobal('fetch', fetch);
    const client = new DingTalkWorkNoticeClient();
    await expect(client.send('token', '42', 'user1', 'content')).rejects.toMatchObject({ outcome: 'UNKNOWN' });
    expect(fetch).toHaveBeenCalledOnce();
    await expect(client.result('token', '42', '1234')).rejects.toMatchObject({ outcome: 'READ_RETRY' });
  });
  it('preserves a 64-bit task id from the platform response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"errcode":0,"task_id":9007199254740993}')));
    await expect(new DingTalkWorkNoticeClient().send('token', '42', 'user1', 'content')).resolves.toBe('9007199254740993');
  });
  it('classifies explicit rate limits as retryable and ambiguous server errors as unknown', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"errcode":88}')).mockResolvedValueOnce(new Response('{"errcode":-1}'));
    vi.stubGlobal('fetch', fetch);
    const client = new DingTalkWorkNoticeClient();
    await expect(client.send('token', '42', 'user1', 'content')).rejects.toMatchObject({ outcome: 'RETRYABLE' });
    await expect(client.send('token', '42', 'user1', 'content')).rejects.toMatchObject({ outcome: 'UNKNOWN' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
