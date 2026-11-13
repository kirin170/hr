import { describe, expect, it } from 'vitest';
import { MockModelProvider } from './mock-model.provider.js';

const provider = new MockModelProvider();

describe('MockModelProvider', () => {
  it('produces a deterministic draft for the same resume', async () => {
    const input = {
      intakeId: 'intake-1',
      resumeFileId: 'file-1',
      fileName: '张三-简历.pdf',
    };

    const first = await provider.parseResume(input);
    const second = await provider.parseResume(input);

    expect(first).toEqual(second);
    expect(first.output.name.value).toBe('张三');
    expect(first.output.name.confidence).toBeGreaterThan(0.5);
    expect(first.confidence.name).toBe(first.output.name.confidence);
  });

  it('fails when the file name signals failure', async () => {
    await expect(
      provider.parseResume({
        intakeId: 'intake-2',
        resumeFileId: 'file-2',
        fileName: 'resume-fail.pdf',
      }),
    ).rejects.toMatchObject({ code: 'PARSE_FAILED' });
  });

  it('lets an explicit outcome override the file name heuristic', async () => {
    const result = await provider.parseResume({
      intakeId: 'intake-3',
      resumeFileId: 'file-3',
      fileName: 'resume-fail.pdf',
      mockOutcome: 'SUCCESS',
    });

    expect(result.output.name.value).toBeTruthy();
    expect(result.output.name.confidence).toBeGreaterThan(0.5);
  });
});
