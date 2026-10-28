/**
 * Prompt 集中管理
 *
 * 把 Prompt 当成代码来管理：集中存放、带版本号、便于 A/B 与回归评估。
 * 修改 Prompt 时请同步更新 PROMPT_VERSION，并在 CHANGELOG 中记录影响。
 */

/** Prompt 版本号：评估集与线上日志都会带上它，便于回溯「哪个 Prompt 版本效果变差」 */
export const PROMPT_VERSION = '2026-03-analysis-v2';

/** 查询扩展（Query Expansion）：把一个监控词扩展成多个检索变体，提高召回 */
export const QUERY_EXPANSION_PROMPT = `你是一个搜索查询扩展专家。给定一个监控关键词，生成该关键词的变体和相关检索词，用于文本匹配。

规则：
1. 包含原始关键词的各种写法（大小写、空格、连字符变体）
2. 包含关键词的核心组成词（拆分后的各个有意义的词）
3. 包含常见别称、缩写、中英文对照
4. 不要加入泛化词（比如关键词是"Claude Sonnet 4.6"，不要加"AI模型"这种泛化词）
5. 总数控制在 5-15 个

输出 JSON 数组，只输出 JSON，不要有其他内容。
示例输入："Claude Sonnet 4.6"
示例输出：["Claude Sonnet 4.6", "Claude Sonnet", "Sonnet 4.6", "claude-sonnet-4.6", "Claude 4.6", "Anthropic Sonnet"]`;

/**
 * 相关性判定 Prompt
 *
 * 关键设计：把「文本预匹配结果」作为提示注入，让模型知道关键词是否字面出现在正文里，
 * 从而抑制「同领域但不同主题」的内容被误判为相关（这是纯语义打分最常见的失败模式）。
 */
export function buildAnalysisPrompt(
  keyword: string,
  preMatchResult: { matched: boolean; matchedTerms: string[] }
): string {
  const matchHint = preMatchResult.matched
    ? `\n注意：文本预匹配发现内容中包含以下关键词变体：${preMatchResult.matchedTerms.join('、')}`
    : `\n注意：文本预匹配发现内容中未直接提及关键词"${keyword}"的任何变体，请特别严格审核相关性。`;

  return `你是一个热点内容精准匹配专家。你的任务是判断一段内容是否与指定的监控关键词【${keyword}】直接相关。

${matchHint}

分析要点：
1. 判断是否为真实有价值的信息（排除标题党、假新闻、营销软文）
2. 判断内容是否【直接】涉及关键词"${keyword}"。注意：
   - 仅仅属于同一领域但未提及关键词的内容，相关性应低于 40 分
   - 内容必须直接讨论、提及或与"${keyword}"有实质关联才能获得 60 分以上
   - 只是间接沾边（如同类产品、同领域但不同主题）应给 30-50 分
3. 判断内容中是否直接提及了"${keyword}"或其等价表述（keywordMentioned）
4. 评估热点的重要程度（对关注"${keyword}"的人来说有多重要）
5. 用一句话说明此内容与"${keyword}"的关系（不是介绍内容本身，而是说"此内容与关键词的关联是什么"）
6. 用一句话解释你的相关性打分理由

请以 JSON 格式输出：
{
  "isReal": true/false,
  "relevance": 0-100,
  "relevanceReason": "相关性打分理由...",
  "keywordMentioned": true/false,
  "importance": "low/medium/high/urgent",
  "summary": "此内容与【${keyword}】的关联：..."
}

只输出 JSON，不要有其他内容。`;
}
