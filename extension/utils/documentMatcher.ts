import type { DocumentType, StoredDocument } from '../types/document';
import { inferDocumentType } from '../types/document';

const DOCUMENT_TYPES: DocumentType[] = [
  'resume',
  'cover_letter',
  'transcript',
  'degree_certificate',
  'certificate',
  'photo',
  'id',
  'portfolio',
  'other',
];

export function classifyDocumentFieldDeterministically(label: string): DocumentType | null {
  const normalized = label.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(resume|cv|curriculum\s+vitae)\b/.test(normalized)) return 'resume';
  if (/\bcover\s+letter\b/.test(normalized)) return 'cover_letter';
  if (/\b(transcript|mark\s*sheet|academic\s+record)\b/.test(normalized)) return 'transcript';
  if (/\b(degree|diploma)\s+certificate\b|\bdegree\s+proof\b/.test(normalized)) return 'degree_certificate';
  if (/\bcertificate\b/.test(normalized)) return 'certificate';
  if (/\b(portfolio|work\s+sample)\b/.test(normalized)) return 'portfolio';
  if (/\b(photo|headshot|profile\s+picture)\b/.test(normalized)) return 'photo';
  if (/\b(passport|identity\s+document|\bid\s+document)\b/.test(normalized)) return 'id';
  return null;
}

export async function classifyDocumentField(label: string, accept = ''): Promise<DocumentType | null> {
  const deterministicType = classifyDocumentFieldDeterministically(label);
  if (deterministicType) return deterministicType;

  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'xyzz') return null;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Personal Copilot Extension',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Classify the type of document requested by a job application upload field. Return JSON {"documentType":"..."}. Allowed values: ${DOCUMENT_TYPES.join(', ')}. Return "other" if the field is ambiguous. Do not select or invent filenames.`,
          },
          { role: 'user', content: JSON.stringify({ fieldLabel: label, acceptedFileTypes: accept }) },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') return null;
    const parsed = JSON.parse(text) as { documentType?: string };
    return DOCUMENT_TYPES.includes(parsed.documentType as DocumentType)
      ? parsed.documentType as DocumentType
      : null;
  } catch {
    return null;
  }
}

function matchesExpectedType(document: StoredDocument, expectedType: DocumentType): boolean {
  const actualType = document.documentType ?? inferDocumentType(document.originalName, document.category);
  if (expectedType === 'certificate') return actualType === 'certificate' || actualType === 'degree_certificate';
  return actualType === expectedType;
}

export function selectDocumentForUpload(documents: StoredDocument[], expectedType: DocumentType): StoredDocument | null {
  const matches = documents.filter((document) => matchesExpectedType(document, expectedType));
  matches.sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    const versionOrder = (right.version ?? '').localeCompare(left.version ?? '', undefined, { numeric: true });
    if (versionOrder !== 0) return versionOrder;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
  return matches[0] ?? null;
}