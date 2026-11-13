import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AiProviderError, type ModelProvider } from './model-provider.js';
import type {
  ParseResumeInput,
  ParsedField,
  ResumeParseResult,
} from './ai.types.js';

const SKILL_POOL = [
  'TypeScript',
  'NestJS',
  'React',
  'MySQL',
  'Redis',
  '项目管理',
  '招聘运营',
];

/**
 * 开发默认模型实现（技术设计 §8.2）。
 * 结果可复现：相同文件得到相同草稿；文件名含 "fail" 或显式 mockOutcome=FAIL 时抛错，
 * 用于验证失败降级与重试链路。
 */
@Injectable()
export class MockModelProvider implements ModelProvider {
  readonly name = 'mock';

  async parseResume(input: ParseResumeInput): Promise<ResumeParseResult> {
    const forcedFailure =
      input.mockOutcome === 'FAIL' ||
      (input.mockOutcome === undefined && /fail|失败/i.test(input.fileName));
    if (forcedFailure) {
      throw new AiProviderError(
        'PARSE_FAILED',
        `Mock provider could not parse ${input.fileName}`,
      );
    }

    const seed = createHash('sha256')
      .update(`${input.resumeFileId ?? input.intakeId}:${input.fileName}`)
      .digest('hex');
    const name = this.deriveName(input.fileName);
    const email = input.contactEmail?.trim().toLowerCase() ?? null;
    const phone = this.derivePhone(seed);
    const skills = [
      SKILL_POOL[parseInt(seed.slice(0, 2), 16) % SKILL_POOL.length],
      SKILL_POOL[parseInt(seed.slice(2, 4), 16) % SKILL_POOL.length],
    ].filter((skill, index, list) => list.indexOf(skill) === index);

    const output = {
      name: this.field(name, 0.92),
      phone: this.field(phone, 0.68),
      email: this.field(email, email ? 0.95 : 0.2),
      education: this.field(this.deriveEducation(seed), 0.55),
      school: this.field('示例大学', 0.5),
      experiences: [
        {
          company: '示例科技有限公司',
          title: '招聘专员',
          period: '2022-2024',
        },
      ],
      skills,
    };

    return {
      output,
      confidence: {
        name: output.name.confidence,
        phone: output.phone.confidence,
        email: output.email.confidence,
      },
    };
  }

  private field<T>(value: T | null, confidence: number): ParsedField<T> {
    return { value, confidence };
  }

  private deriveName(fileName: string): string {
    const base = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/(简历|resume|cv|附件)/gi, ' ')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return base.length > 0 ? base : '待解析候选人';
  }

  private derivePhone(seed: string): string {
    const digits = BigInt(`0x${seed.slice(0, 12)}`)
      .toString()
      .slice(0, 8)
      .padStart(8, '0');
    return `138${digits}`;
  }

  private deriveEducation(seed: string): string {
    const options = ['本科', '硕士', '大专'];
    return options[parseInt(seed.slice(4, 6), 16) % options.length];
  }
}
