import type { UserProfile } from '../types/profile';
import { isLinkRequestQuestion } from './questionDetector';
import { AI_MODEL, requestAgentRouter } from './backendClient';

export function formatProfileAnswerContext(profile: UserProfile): string {
  const facts = [
    profile.professional.skills.length > 0 ? `Skills: ${profile.professional.skills.join(', ')}` : '',
    ...profile.experience.map((experience) => {
      const role = [experience.title, experience.company].filter(Boolean).join(' at ');
      return [role ? `Experience: ${role}` : '', experience.description ? `Experience details: ${experience.description}` : '']
        .filter(Boolean)
        .join('\n');
    }),
    ...profile.education.map((education) => {
      const details = [education.degree, education.field, education.institution].filter(Boolean).join(' in ');
      return details ? `Education: ${details}` : '';
    }),
    ...(profile.secondaryEducation?.twelfth?.institution ? [`Class 12th / PUC: ${profile.secondaryEducation.twelfth.institution}${profile.secondaryEducation.twelfth.percentage ? ` (${profile.secondaryEducation.twelfth.percentage})` : ''}`] : []),
    ...(profile.secondaryEducation?.tenth?.institution ? [`Class 10th / School: ${profile.secondaryEducation.tenth.institution}${profile.secondaryEducation.tenth.percentage ? ` (${profile.secondaryEducation.tenth.percentage})` : ''}`] : []),
    profile.professional.portfolio ? `Portfolio: ${profile.professional.portfolio}` : '',
    profile.professional.github ? `GitHub: ${profile.professional.github}` : '',
    profile.professional.linkedin ? `LinkedIn: ${profile.professional.linkedin}` : '',
  ].filter(Boolean);

  return facts.join('\n');
}

function extractMemoryLinks(memories: string[]): string[] {
  const links = new Map<string, string>();
  for (const memory of memories) {
    for (const match of memory.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []) {
      const link = match.replace(/[),.;!?}\]]+$/g, '');
      try {
        const parsed = new URL(link);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        const key = parsed.href.toLowerCase();
        if (!links.has(key)) links.set(key, link);
      } catch {
        // Ignore malformed URLs in retrieved memories.
      }
    }
  }
  return [...links.values()];
}

function canonicalizeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href.toLowerCase();
  } catch {
    return undefined;
  }
}

async function selectRelevantMemoryLinks(question: string, memories: string[]): Promise<string> {
  const availableLinks = extractMemoryLinks(memories);
  if (availableLinks.length === 0) return '';

  if (import.meta.env.DEV) {
    console.info('[Pipeline 2/5] Agent Router link-selection request', {
      question,
      memoryCount: memories.length,
      availableLinkCount: availableLinks.length,
    });
  }

  const response = await requestAgentRouter({
    model: AI_MODEL,
    temperature: 0,
    max_tokens: 300,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Select only URLs from the supplied Supermemory results that directly match what the question asks for. Do not include unrelated links such as LinkedIn, a general portfolio, company websites, job sites, or project repositories unless the question specifically requests them. Never invent, edit, or normalize a URL. Return only JSON in this format: {"links":["exact URL"]}. Return an empty array if no supplied URL is relevant.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          question,
          availableUrls: availableLinks,
          supermemoryResults: memories.map((memory) => memory.slice(0, 1800)),
        }),
      },
    ],
  }, AbortSignal.timeout(30000), 'profile-link-selection');

  if (!response.ok) throw new Error(`Agent Router link selection failed (${response.status}).`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return '';

  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { links?: unknown };
  if (!Array.isArray(parsed.links)) return '';

  const availableByCanonical = new Map(
    availableLinks.flatMap((link) => {
      const canonical = canonicalizeHttpUrl(link);
      return canonical ? [[canonical, link] as const] : [];
    }),
  );
  const selected = new Set<string>();
  const result: string[] = [];
  for (const value of parsed.links) {
    if (typeof value !== 'string') continue;
    const canonical = canonicalizeHttpUrl(value);
    const exactMemoryLink = canonical ? availableByCanonical.get(canonical) : undefined;
    if (!exactMemoryLink || selected.has(canonical!)) continue;
    selected.add(canonical!);
    result.push(exactMemoryLink);
  }
  return result.join(', ');
}

export function cleanAnswerText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['response', 'answer', 'text', 'result', 'value']) {
      if (typeof obj[key] === 'string' && obj[key].trim()) {
        return cleanAnswerText(obj[key]);
      }
    }
    const str = Object.values(obj).find((v): v is string => typeof v === 'string' && Boolean(v.trim()));
    if (str) return cleanAnswerText(str);
    return '';
  }
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      return cleanAnswerText(parsed);
    } catch { }
  }
  const regexMatch = text.match(/^\s*\{?\s*"(?:response|answer|text|result|value)"\s*:\s*"([\s\S]*?)"?\s*\}?\s*$/);
  if (regexMatch) {
    return regexMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
  }
  return text;
}

export async function generateApplicationAnswer(question: string, memories: string[], profileContext: string): Promise<string> {
  if (isLinkRequestQuestion(question)) {
    return selectRelevantMemoryLinks(question, memories);
  }
  if (!memories.length && !profileContext.trim()) throw new Error('Add professional skills or experience to your profile before generating answers.');

  if (import.meta.env.DEV) {
    console.info('[Pipeline 2/5] Preparing Agent Router answer', {
      profileFactCount: profileContext.split('\n').filter(Boolean).length,
      profileContextCharacters: profileContext.length,
      memoryCount: memories.length,
      memoryContextCharacters: memories.reduce((total, memory) => total + memory.length, 0),
      questionCharacters: question.length,
    });
  }

  const wordRange = question.match(/\b(\d{2,4})\s*(?:-|to)\s*(\d{2,4})\s*words?\b/i);
  const responseRequirements = wordRange
    ? `Write between ${wordRange[1]} and ${wordRange[2]} words, as requested by the form.`
    : 'Follow any length and format requirements stated in the question.';

  const response = await requestAgentRouter({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: 'First classify the question. If it asks for a direct personal/profile fact (for example name, contact details, current location/address, current employer/company, date of birth, or graduation year), answer with only the exact requested value found in the supplied profile facts or relevant memories. Do not add first-person wording, explanations, or unrelated facts. Preserve saved addresses and other personal values exactly as stored. For graduation-year questions, return only the explicit four-digit year; for employer questions, return only the company name. Do not infer or invent missing direct facts; return an empty string only when a requested direct fact is unavailable. For open-ended application questions and essays, do not return an empty answer when relevant profile facts or memories are provided. Write a truthful first-person response grounded in those facts and the details stated in the question. You may express reasonable future hopes as aspirations, but do not invent past experience, projects, metrics, specific program features, or motivations presented as established facts. Follow explicit word-count or formatting requirements in the question; otherwise keep the answer concise. Avoid generic filler. CRITICAL: Output ONLY plain text. Do NOT output JSON, code blocks, or key-value structures like {"response":"..."}. Respond directly with the text.',
      },
      {
        role: 'user',
        content: JSON.stringify({ question, responseRequirements, profileFacts: profileContext, relevantMemories: memories }),
      },
    ],
    temperature: 0.4,
    max_tokens: 1500,
    reasoning_effort: 'low',
  }, AbortSignal.timeout(75000), 'application-answer');

  if (!response.ok) throw new Error(`Agent Router request failed (${response.status}).`);
  const data = await response.json();
  const rawAnswer = data?.choices?.[0]?.message?.content;
  const answer = cleanAnswerText(rawAnswer);
  if (import.meta.env.DEV) {
    console.info('[Pipeline 2/5] Agent Router answer response received', {
      status: response.status,
      hasContent: rawAnswer != null,
      answerCharacters: answer.length,
    });
  }
  return answer;
}

export interface ApplicationAnswerRequest {
  fieldId: string;
  question: string;
  memories: string[];
}

export async function generateApplicationAnswers(
  requests: ApplicationAnswerRequest[],
  profileContext: string,
): Promise<Record<string, string>> {
  if (requests.length === 0 || (!profileContext.trim() && requests.every((request) => request.memories.length === 0))) {
    return {};
  }

  const response = await requestAgentRouter({
    model: AI_MODEL,
    temperature: 0.3,
    max_tokens: 2400,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Answer each job application question using only relevant supplied profile facts and memories. For direct personal/profile fact questions (for example name, contact details, current location/address, current employer/company, date of birth, or graduation year), return only the exact requested saved value with no first-person wording, explanation, or unrelated facts. Preserve addresses and personal values exactly as provided. For graduation-year questions return only an explicit four-digit year; for employer questions return only the company name. Never infer or invent missing personal facts; use an empty answer when the requested fact is unavailable. For open-ended questions (for example why the candidate should be hired), provide a concise, specific first-person answer grounded in supplied skills and experience. Never invent qualifications, experience, metrics, motivations, or company-specific claims. For interest or motivation questions, describe role fit without claiming unsupported personal motives. Return JSON only: {"answers":{"fieldId":"answer"}}.',
      },
      {
        role: 'user',
        content: JSON.stringify({ profileFacts: profileContext, questions: requests }),
      },
    ],
  }, AbortSignal.timeout(30000), 'application-answer-batch');

  if (!response.ok) throw new Error(`Agent Router request failed (${response.status}).`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return {};
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { answers?: Record<string, unknown> };
  return Object.fromEntries(Object.entries(parsed.answers ?? {}).flatMap(([fieldId, answer]) => {
    const cleaned = cleanAnswerText(answer);
    return cleaned ? [[fieldId, cleaned]] : [];
  }));
}

export async function extractProfileFieldFromDocuments(
  fieldLabel: string,
  profileField: string,
  documentEvidence: string[],
): Promise<string | undefined> {
  if (documentEvidence.length === 0) return undefined;

  const response = await requestAgentRouter({
    model: AI_MODEL,
    temperature: 0,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Extract the requested personal field only when its exact value is explicitly present in the supplied document excerpts. Never infer, complete, or fabricate missing personal data. Return JSON {"value":"exact value"} or {"value":null} when the excerpts do not contain it.',
      },
      {
        role: 'user',
        content: JSON.stringify({ fieldLabel, profileField, documentExcerpts: documentEvidence.map((excerpt) => excerpt.slice(0, 1800)) }),
      },
    ],
  }, AbortSignal.timeout(15000), 'document-field-extraction');

  if (!response.ok) throw new Error(`Document field extraction failed (${response.status}).`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return undefined;
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { value?: unknown };
  return typeof parsed.value === 'string' && parsed.value.trim() ? parsed.value.trim() : undefined;
}
