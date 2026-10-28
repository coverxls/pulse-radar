import { OpenRouter } from '@openrouter/sdk';
import type { AIAnalysis } from '../types.js';
import { buildAnalysisPrompt, PROMPT_VERSION, QUERY_EXPANSION_PROMPT } from './prompts.js';

/**
 * AI 分析层
 *
 * 设计要点：
 * 1. 模型可配置（OPENROUTER_MODEL），不把模型名写死在业务代码里；
 * 2. 每次调用都记录 延迟 / token 用量 / Prompt 版本，便于成本与效果回溯；
 * 3. 网络抖动时做有限重试（指数退避），失败后降级为规则打分，保证扫描任务不中断；
 * 4. 未配置 API Key 时走纯规则降级，本地开发/CI 无需密钥也能跑通完整链路。
 */

const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3.2';

/**
 * 惰性初始化客户端：ESM 的 import 会在index.ts 的 dotenv.config() 之前执行，
 * 如果在模块顶层读取环境变量，拿到的会是空 Key。改为首次调用时再读。
 */
let client: OpenRouter | null = null;
function getClient(): OpenRouter {
  if (!client) {
    client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? '' });
  }
  return client;
}

const MAX_CONTENT_CHARS = 2000;
const MAX_CACHE_ENTRIES = 200;

/** 运行期 AI 调用统计，供日志与健康检查使用 */
export const aiUsage = {
  calls: 0,
  failures: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalLatencyMs: 0
};

/** 简易的指数退避重试，用于网络抖动等瞬时失败 */
async function withRetry<T>(task: () => Promise<T>, retries = 2, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

/** 统一封装一次模型调用，顺便记录可观测数据 */
async function chat(systemPrompt: string, userContent: string, maxTokens: number): Promise<string> {
  const startedAt = Date.now();
  const result = await withRetry(() =>
    getClient().chat.send({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.2,
      maxTokens
    })
  );

  const latency = Date.now() - startedAt;
  const rawContent = result.choices[0]?.message?.content || '';
  const usage = (result as { usage?: { promptTokens?: number; completionTokens?: number } }).usage;

  aiUsage.calls++;
  aiUsage.totalLatencyMs += latency;
  aiUsage.promptTokens += usage?.promptTokens ?? 0;
  aiUsage.completionTokens += usage?.completionTokens ?? 0;
  console.log(
    `  🤖 [prompt:${PROMPT_VERSION}] model=${MODEL} latency=${latency}ms tokens=${usage?.promptTokens ?? '?'}+${usage?.completionTokens ?? '?'}`
  );

  return typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
}

// ========== Query Expansion（查询扩展） ==========

/**
 * 使用 AI 将关键词扩展为多个变体，用于文本预过滤。
 * 返回扩展后的关键词列表（含原始关键词）。
 * 结果会被缓存，同一关键词不会重复调用 AI。
 */
const expansionCache = new Map<string, string[]>();

export async function expandKeyword(keyword: string): Promise<string[]> {
  // 缓存命中
  const cached = expansionCache.get(keyword);
  if (cached) return cached;

  // 不管 AI 是否可用，先提取基础核心词
  const coreTerms = extractCoreTerms(keyword);

  if (!process.env.OPENROUTER_API_KEY) {
    const result = [keyword, ...coreTerms];
    rememberExpansion(keyword, result);
    return result;
  }

  try {
    const responseContent = await chat(QUERY_EXPANSION_PROMPT, keyword, 300);
    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: string[] = JSON.parse(jsonMatch[0]);
      // 确保原始关键词和核心词都在列表中
      const expanded = [...new Set([keyword, ...coreTerms, ...parsed.map(s => s.trim()).filter(Boolean)])];
      rememberExpansion(keyword, expanded);
      console.log(`  🔍 Query expansion for "${keyword}": ${expanded.length} variants`);
      return expanded;
    }
  } catch (error) {
    console.error('Query expansion failed:', error);
  }

  // Fallback：使用基础核心词
  const fallback = [keyword, ...coreTerms];
  rememberExpansion(keyword, fallback);
  return fallback;
}

/** 写入扩展缓存，超过上限时淘汰最早写入的一条，避免长时间运行时内存无界增长 */
function rememberExpansion(keyword: string, terms: string[]): void {
  if (expansionCache.size >= MAX_CACHE_ENTRIES && !expansionCache.has(keyword)) {
    const oldest = expansionCache.keys().next().value;
    if (oldest !== undefined) expansionCache.delete(oldest);
  }
  expansionCache.set(keyword, terms);
}

/**
 * 从关键词中提取核心词（纯文本方式，不依赖 AI）
 */
function extractCoreTerms(keyword: string): string[] {
  const terms: string[] = [];
  // 按空格、连字符、下划线分割
  const parts = keyword.split(/[\s\-_\/\\·]+/).filter(p => p.length >= 2);
  if (parts.length > 1) {
    terms.push(...parts);
    // 两两组合
    for (let i = 0; i < parts.length - 1; i++) {
      terms.push(parts[i] + ' ' + parts[i + 1]);
    }
  }
  // 去重，排除原始关键词本身
  return [...new Set(terms)].filter(t => t.toLowerCase() !== keyword.toLowerCase());
}

// ========== 关键词预匹配 ==========

/**
 * 检查文本中是否包含任一扩展关键词（不区分大小写）。
 * 返回是否匹配以及匹配到的词。
 */
export function preMatchKeyword(text: string, expandedKeywords: string[]): { matched: boolean; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  for (const kw of expandedKeywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matchedTerms.push(kw);
    }
  }
  return { matched: matchedTerms.length > 0, matchedTerms };
}

// ========== AI 内容分析（关键词感知） ==========

export async function analyzeContent(
  content: string,
  keyword: string,
  preMatchResult?: { matched: boolean; matchedTerms: string[] }
): Promise<AIAnalysis> {
  // 默认预匹配结果
  const matchResult = preMatchResult ?? { matched: false, matchedTerms: [] };

  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('OpenRouter API key not configured, using fallback analysis');
    return {
      isReal: true,
      relevance: matchResult.matched ? 50 : 20,
      relevanceReason: '未配置 AI 服务，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: content.slice(0, 50) + '...'
    };
  }

  try {
    const prompt = buildAnalysisPrompt(keyword, matchResult);
    const responseContent = await chat(prompt, content.slice(0, MAX_CONTENT_CHARS), 500);

    // 尝试解析 JSON
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isReal: Boolean(parsed.isReal),
        relevance: Math.min(100, Math.max(0, Number(parsed.relevance) || 0)),
        relevanceReason: String(parsed.relevanceReason || '').slice(0, 200),
        keywordMentioned: Boolean(parsed.keywordMentioned),
        importance: ['low', 'medium', 'high', 'urgent'].includes(parsed.importance)
          ? parsed.importance
          : 'low',
        summary: String(parsed.summary || '').slice(0, 150)
      };
    }

    throw new Error('Failed to parse AI response');
  } catch (error) {
    aiUsage.failures++;
    console.error('AI analysis failed:', error);
    // Fallback
    return {
      isReal: true,
      relevance: matchResult.matched ? 30 : 10,
      relevanceReason: 'AI 分析失败，使用默认分数',
      keywordMentioned: matchResult.matched,
      importance: 'low',
      summary: content.slice(0, 50) + '...'
    };
  }
}

export async function batchAnalyze(contents: string[], keyword: string, expandedKeywords?: string[]): Promise<AIAnalysis[]> {
  // 并行分析，但限制并发数
  const batchSize = 3;
  const results: AIAnalysis[] = [];

  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(content => {
        const preMatch = expandedKeywords
          ? preMatchKeyword(content, expandedKeywords)
          : undefined;
        return analyzeContent(content, keyword, preMatch);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
