import type { UserProfile } from '../types/profile';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
    profile.professional.portfolio ? `Portfolio: ${profile.professional.portfolio}` : '',
    profile.professional.github ? `GitHub: ${profile.professional.github}` : '',
    profile.professional.linkedin ? `LinkedIn: ${profile.professional.linkedin}` : '',
  ].filter(Boolean);

  return facts.join('\n');
}

export async function generateApplicationAnswer(question: string, memories: string[], profileContext: string): Promise<string> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'xyzz') throw new Error('OpenRouter API key is not configured.');
  if (!memories.length && !profileContext.trim()) throw new Error('Add professional skills or experience to your profile before generating answers.');

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Personal Copilot Extension',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Write a concise, specific, first-person job application answer using only the supplied profile facts and memories. Connect the candidate’s actual skills and experience to the question. Do not invent projects, experience, metrics, motivations, or claims. Avoid generic filler. Return an empty string only if neither source contains relevant facts.',
        },
        {
          role: 'user',
          content: JSON.stringify({ question, profileFacts: profileContext, relevantMemories: memories }),
        },
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}).`);
  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content;
  return typeof answer === 'string' ? answer.trim() : '';
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
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'xyzz') throw new Error('OpenRouter API key is not configured.');
  if (requests.length === 0 || (!profileContext.trim() && requests.every((request) => request.memories.length === 0))) {
    return {};
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Personal Copilot Extension',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Answer each job application question concisely in first person using only relevant supplied profile facts and memories. Never invent qualifications, experience, metrics, or company-specific claims. For interest or motivation questions, describe role fit grounded in the supplied skills and experience without claiming personal motives that were not supplied. If evidence is insufficient for a factual question or there is no relevant profile evidence, return an empty answer for that field. Return JSON only: {"answers":{"fieldId":"answer"}}.',
        },
        {
          role: 'user',
          content: JSON.stringify({ profileFacts: profileContext, questions: requests }),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter request failed (${response.status}).`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return {};
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { answers?: Record<string, unknown> };
  return Object.fromEntries(Object.entries(parsed.answers ?? {}).flatMap(([fieldId, answer]) =>
    typeof answer === 'string' && answer.trim() ? [[fieldId, answer.trim()]] : [],
  ));
}

export async function extractProfileFieldFromDocuments(
  fieldLabel: string,
  profileField: string,
  documentEvidence: string[],
): Promise<string | undefined> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'xyzz' || documentEvidence.length === 0) return undefined;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Personal Copilot Extension',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
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
    }),
  });

  if (!response.ok) throw new Error(`Document field extraction failed (${response.status}).`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return undefined;
  const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { value?: unknown };
  return typeof parsed.value === 'string' && parsed.value.trim() ? parsed.value.trim() : undefined;
}