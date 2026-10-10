// ============================================================
// AI Mapper — OpenRouter API Integration
// ============================================================
// Sends ONLY sanitized field descriptors to the AI.
// Receives ONLY field-to-intent mappings back.
// ZERO personal data ever leaves the browser.
// ============================================================

import type { ProfileFieldKey } from '../types/autofill';
import { ALL_INTENT_KEYS } from '../types/aiMapper';
import type { SanitizedField, GoogleFormLabelField, AIMappingResponse } from '../types/aiMapper';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are a form field classifier for job application websites.

Your task: Given a list of form field descriptors, map each field to the most appropriate intent key from the provided list.

Rules:
1. Each field has a "fieldId" (like "f0", "f1"). Map it to one intent key.
2. Only use intent keys from the provided list. Do NOT invent new ones.
3. If a field clearly doesn't match any intent key, set it to null.
4. Use ALL available clues: label text, placeholder, name attribute, input type, autocomplete attribute.
5. Be accurate — a wrong mapping is worse than no mapping (null).
6. Common tricky cases:
   - "number" or "contact" with type "tel" → phones.primary
   - "entry.XXXXX" fields (Google Forms) → look at the label text
   - "name" alone (no first/last) → personal.fullName
   - "university" or "college" → education.latest.institution

Respond with ONLY valid JSON, no markdown, no explanation:
{
  "mappings": {
    "f0": "intentKey or null",
    "f1": "intentKey or null"
  }
}`;

export interface AIMapperOptions {
  googleForm?: boolean;
  allowedIntentKeys?: ProfileFieldKey[];
  intentDescriptions?: Partial<Record<ProfileFieldKey, string>>;
  timeoutMs?: number;
}

const GOOGLE_FORM_SYSTEM_PROMPT = `Classify each supplied unknown Google Forms field label against the supplied canonical profile intent keys and optional intent descriptions. Infer the best match from the label's meaning, including abbreviations and synonyms. Return only a supplied intent key or null for each fieldId. Return null when a label has no matching profile variable or asks for a preference, job choice, consent, upload, password, OTP, legal declaration, or demographic answer. Never invent values or return placeholder text. Respond only with JSON: {"mappings":{"f0":null}}.`;
/**
 * Call the OpenRouter API to map sanitized fields to intent keys.
 * Returns only validated mappings (rejects hallucinated keys).
 */
export async function mapFieldsWithAI(
  fields: Array<SanitizedField | GoogleFormLabelField>,
  options: AIMapperOptions = {},
): Promise<AIMappingResponse> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  if (!apiKey || apiKey === 'xyzz') {
    console.warn('[AI Mapper] No valid API key configured');
    return { mappings: {}, completed: false };
  }

  // Use a fast, smart model like gpt-4o-mini or claude-3-haiku via OpenRouter
  const model = 'openai/gpt-4o-mini';

  const userPrompt = JSON.stringify({
    fields,
    intentKeys: options.allowedIntentKeys ?? ALL_INTENT_KEYS,
    ...(options.intentDescriptions ? { intentDescriptions: options.intentDescriptions } : {}),
  });

  const allowedIntentKeys = options.allowedIntentKeys ?? ALL_INTENT_KEYS;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000', // Required by OpenRouter
        'X-Title': 'Personal Copilot Extension', // Required by OpenRouter
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: options.googleForm ? GOOGLE_FORM_SYSTEM_PROMPT : SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1, // Low temperature for accuracy
        max_tokens: 600,
        response_format: { type: 'json_object' } // Force JSON output if supported
      }),
    });

    if (!response.ok) {
      clearTimeout(timeoutId);
      const errorText = await response.text();
      console.error('[AI Mapper] API error:', response.status, errorText);
      return { mappings: {}, completed: false };
    }

    const data = await response.json();
    clearTimeout(timeoutId);

    // Extract text from OpenRouter response
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      console.error('[AI Mapper] Empty response from API');
      return { mappings: {}, completed: false };
    }

    // Parse JSON response. Handle cases where the model might still wrap in markdown
    const cleanText = text.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
    const parsed = JSON.parse(cleanText);
    const rawMappings: Record<string, string | null> = parsed.mappings ?? {};

    // Validate: only keep mappings that reference real ProfileFieldKeys
    const validatedMappings: Record<string, ProfileFieldKey> = {};
    const intentKeySet = new Set<string>(allowedIntentKeys);

    for (const [fieldId, intentKey] of Object.entries(rawMappings)) {
      if (intentKey && intentKeySet.has(intentKey)) {
        validatedMappings[fieldId] = intentKey as ProfileFieldKey;
      }
    }

    console.log(
      `[AI Mapper] Mapped ${Object.keys(validatedMappings).length}/${fields.length} fields`,
    );

    return { mappings: validatedMappings, completed: true };
  } catch (err) {
    console.error('[AI Mapper] Failed:', err);
    return { mappings: {}, completed: false };
  }
}

