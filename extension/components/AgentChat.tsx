import { useState, useRef, useEffect } from 'react';
import type { UserProfile } from '../types/profile';
import { getPrimary } from '../types/profile';
import { loadAllDocumentMetadata } from '../utils/documentStorage';
import type { StoredDocument } from '../types/document';

interface AgentChatProps {
  profile: UserProfile;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function buildSystemPrompt(profile: UserProfile, documents: StoredDocument[]): string {
  // Build a plain-text profile summary for the agent context
  const fullName = [profile.personal.firstName, profile.personal.middleName, profile.personal.lastName]
    .filter(Boolean)
    .join(' ');
  const primaryPhone = getPrimary(profile.phones)?.value ?? 'not set';
  const primaryEmail = getPrimary(profile.emails)?.value ?? 'not set';
  const primaryAddr = getPrimary(profile.addresses);
  const addressStr = primaryAddr
    ? [primaryAddr.line1, primaryAddr.city, primaryAddr.state, primaryAddr.postalCode, primaryAddr.country]
        .filter(Boolean)
        .join(', ')
    : 'not set';
  const latestEdu = profile.education[0];
  const latestExp = profile.experience[0];

  const docList = documents.length > 0
    ? documents.map((d) => `- ${d.name} (${d.category}, ${d.mimeType.split('/')[1].toUpperCase()}, ${Math.round(d.sizeBytes / 1024)}KB${d.width ? `, ${d.width}×${d.height}` : ''})`).join('\n')
    : '- No documents uploaded yet';

  return `You are a personal job application assistant called "Copilot Agent" built into a Chrome extension.

You have access to the user's profile and document vault (all stored locally, encrypted on their device).

## User Profile
- Full Name: ${fullName || 'not set'}
- Phone: ${primaryPhone}
- Email: ${primaryEmail}
- Address: ${addressStr}
- Education: ${latestEdu ? `${latestEdu.degree} in ${latestEdu.field} from ${latestEdu.institution}` : 'not set'}
- Experience: ${latestExp ? `${latestExp.title} at ${latestExp.company}` : 'not set'}
- LinkedIn: ${profile.professional.linkedin || 'not set'}
- GitHub: ${profile.professional.github || 'not set'}
- Portfolio: ${profile.professional.portfolio || 'not set'}
- Skills: ${profile.professional.skills.length > 0 ? profile.professional.skills.join(', ') : 'not set'}

## Stored Documents
${docList}

## Your Capabilities
1. **Answer questions** about the user's profile, documents, and job application strategy.
2. **Image processing guidance** — tell the user how to use the Docs tab's image editor to resize/crop/convert photos to specific job portal requirements.
3. **Document requirements analysis** — if the user pastes or describes a job application form's requirements, help them understand which documents or profile fields they need.
4. **Autofill help** — explain how the autofill works, what fields it can fill, and troubleshoot issues.
5. **Profile advice** — suggest improvements or missing info based on what's set in their profile.

## Rules
- Be concise and practical. This is a popup — keep responses short and actionable.
- Never make up profile data. Only reference what's shown above.
- If the user asks to process an image (resize, convert, compress), guide them to: Docs tab → click the ✏️ edit icon on the image → use the image editor.
- If the user asks about a specific document requirement (e.g. "35×45mm passport photo"), translate it to pixels (at 96dpi or the specified resolution) and guide them to the right preset or custom dimensions.
- If something is not in your capabilities (like directly writing to forms), say so clearly and suggest the autofill approach instead.`;
}

export default function AgentChat({ profile }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load documents for context
  useEffect(() => {
    loadAllDocumentMetadata().then(setDocuments).catch(() => setDocuments([]));
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      if (!apiKey || apiKey === 'xyzz') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '⚠️ No API key configured. Please add `VITE_OPENROUTER_API_KEY` to your `.env` file and rebuild the extension.',
          },
        ]);
        return;
      }

      const systemPrompt = buildSystemPrompt(profile, documents);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Personal Copilot Extension',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...updatedMessages,
          ],
          temperature: 0.7,
          max_tokens: 512,
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText.slice(0, 120)}`);
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content ?? '(no response)';

      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const isAbort = msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: isAbort
            ? '⏱️ Request timed out. Please try again.'
            : `⚠️ Error: ${msg}`,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '360px' }}>

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {messages.length === 0 ? (
          /* Empty state */
          <div className="agent-placeholder">
            <div className="icon">🤖</div>
            <div className="title">Agent</div>
            <div className="desc">
              Ask me about your profile, documents, or get help with job applications.
            </div>
            {/* Quick prompts */}
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', maxWidth: '280px' }}>
              {[
                '📋 What info is missing from my profile?',
                '📸 How do I resize my photo for a passport?',
                '🔍 What fields can autofill on a job form?',
              ].map((prompt) => (
                <button
                  key={prompt}
                  style={{
                    background: 'var(--color-pc-surface)',
                    border: '1px solid var(--color-pc-border)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: 'var(--color-pc-text-secondary)',
                    fontSize: '0.75rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontFamily: 'var(--font-sans)',
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.borderColor = 'var(--color-pc-accent-start)';
                    (e.target as HTMLElement).style.color = 'var(--color-pc-text)';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.borderColor = 'var(--color-pc-border)';
                    (e.target as HTMLElement).style.color = 'var(--color-pc-text-secondary)';
                  }}
                  onClick={() => {
                    setInput(prompt.replace(/^[^\s]+\s/, ''));
                    inputRef.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  animation: 'fadeIn 0.2s ease-out',
                }}
              >
                <div style={{
                  maxWidth: '88%',
                  padding: '8px 12px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, var(--color-pc-accent-start), var(--color-pc-accent-end))'
                    : 'var(--color-pc-surface)',
                  border: msg.role === 'assistant' ? '1px solid var(--color-pc-border)' : 'none',
                  color: 'var(--color-pc-text)',
                  fontSize: '0.82rem',
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{
                  padding: '8px 14px',
                  borderRadius: '12px 12px 12px 2px',
                  background: 'var(--color-pc-surface)',
                  border: '1px solid var(--color-pc-border)',
                  display: 'flex',
                  gap: '4px',
                  alignItems: 'center',
                }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: 'var(--color-pc-accent-start)',
                      display: 'inline-block',
                      animation: 'dot-pulse 1.2s ease-in-out infinite',
                      animationDelay: `${i * 0.2}s`,
                    }} />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="agent-input-area">
        {messages.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
            <button
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-pc-text-muted)',
                fontSize: '0.68rem',
                cursor: 'pointer',
                padding: '0 2px',
                fontFamily: 'var(--font-sans)',
              }}
              onClick={handleClear}
            >
              Clear chat
            </button>
          </div>
        )}
        <div className="agent-input-wrapper">
          <input
            ref={inputRef}
            id="agent-input"
            className="agent-input"
            type="text"
            placeholder="What do you need?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
