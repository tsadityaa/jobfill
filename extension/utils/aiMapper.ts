// ============================================================
// AI Mapper — OpenRouter API Integration
// ============================================================
// Sends ONLY sanitized field descriptors to the AI.
// Receives ONLY field-to-intent mappings back.
// ZERO personal data ever leaves the browser.
// ============================================================

import type { SanitizedField, AIMappingResponse } from '../types/aiMapper';
import type { ProfileFieldKey } from '../types/autofill';
import { ALL_INTENT_KEYS } from '../types/aiMapper';

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

/**
 * Call the OpenRouter API to map sanitized fields to intent keys.
 * Returns only validated mappings (rejects hallucinated keys).
 */
export async function mapFieldsWithAI(
  fields: SanitizedField[],
): Promise<AIMappingResponse> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  if (!apiKey || apiKey === 'xyzz') {
    console.warn('[AI Mapper] No valid API key configured');
    return { mappings: {} };
  }

  // Use a fast, smart model like gpt-4o-mini or claude-3-haiku via OpenRouter
  const model = 'openai/gpt-4o-mini';

  const userPrompt = JSON.stringify({
    fields,
    intentKeys: ALL_INTENT_KEYS,
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout

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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1, // Low temperature for accuracy
        response_format: { type: 'json_object' } // Force JSON output if supported
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AI Mapper] API error:', response.status, errorText);
      return { mappings: {} };
    }

    const data = await response.json();

    // Extract text from OpenRouter response
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      console.error('[AI Mapper] Empty response from API');
      return { mappings: {} };
    }

    // Parse JSON response. Handle cases where the model might still wrap in markdown
    const cleanText = text.replace(/^\`\`\`json\n?/, '').replace(/\n?\`\`\`$/, '');
    const parsed = JSON.parse(cleanText);
    const rawMappings: Record<string, string | null> = parsed.mappings ?? {};

    // Validate: only keep mappings that reference real ProfileFieldKeys
    const validatedMappings: Record<string, ProfileFieldKey> = {};
    const intentKeySet = new Set<string>(ALL_INTENT_KEYS);

    for (const [fieldId, intentKey] of Object.entries(rawMappings)) {
      if (intentKey && intentKeySet.has(intentKey)) {
        validatedMappings[fieldId] = intentKey as ProfileFieldKey;
      }
    }

    console.log(
      `[AI Mapper] Mapped ${Object.keys(validatedMappings).length}/${fields.length} fields`,
    );

    return { mappings: validatedMappings };
  } catch (err) {
    console.error('[AI Mapper] Failed:', err);
    return { mappings: {} };
  }
}

