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