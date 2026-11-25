import { describe, expect, it } from 'vitest';
import type { ParseResumeInput, ResumeContent } from './ai.types.js';
import { MockModelProvider } from './mock-model.provider.js';

const provider = new MockModelProvider();

function request(input: ParseResumeInput) {
  const content: ResumeContent = {
    text: '张三 13800000000 zhangsan@example.com 本科 示例大学 招聘专员 2022-2024',
    imageDataUrl: null,
    mimeType: 'application/pdf',
    sourceRef: `resume:${input.fileName}`,
    truncated: false,
    textHash: 'a'.repeat(64),
  };
  return { input, content };
}

describe('MockModelProvider', () => {
  it('produces a deterministic draft for the same resume', async () => {
    const input: ParseResumeInput = {
      intakeId: 'intake-1',
      resumeFileId: 'file-1',
      fileName: '张三-简历.pdf',
    };

    const first = await provider.parseResume(request(input));
    const second = await provider.parseResume(request(input));

    expect(first).toEqual(second);
    expect(first.output.name.value).toBe('张三');
    expect(first.output.name.confidence).toBeGreaterThan(0.5);
    expect(first.confidence.name).toBe(first.output.name.confidence);
  });

  it('records provider, model, latency and zero cost for mock runs', async () => {
    const result = await provider.parseResume(
      request({ intakeId: 'intake-usage', resumeFileId: 'file-usage', fileName: '李四.pdf' }),
    );

    expect(result.usage).toMatchObject({ provider: 'mock', model: 'mock-ai-v1', costMicros: 0 });
    expect(result.usage?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.usage?.promptTokens).toBeGreaterThan(0);
  });

  it('fails when the file name signals failure', async () => {
    await expect(
      provider.parseResume(
        request({ intakeId: 'intake-2', resumeFileId: 'file-2', fileName: 'resume-fail.pdf' }),
      ),
    ).rejects.toMatchObject({ code: 'PARSE_FAILED' });
  });

  it('lets an explicit outcome override the file name heuristic', async () => {
    const result = await provider.parseResume(
      request({
        intakeId: 'intake-3',
        resumeFileId: 'file-3',
        fileName: 'resume-fail.pdf',
        mockOutcome: 'SUCCESS',
      }),
    );

    expect(result.output.name.value).toBeTruthy();
    expect(result.output.name.confidence).toBeGreaterThan(0.5);
  });
});
