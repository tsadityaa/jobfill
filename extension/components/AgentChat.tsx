import { useState, useRef, useEffect, useCallback } from 'react';
import type { UserProfile } from '../types/profile';
import { getPrimary } from '../types/profile';
import { cloudLoadAllDocumentMetadata as loadAllDocumentMetadata, cloudLoadDocumentBlob as loadDocumentBlob } from '../utils/cloudStorage';
import type { StoredDocument } from '../types/document';
import { uploadToPdfCo, compressPdf, pdfToImages, downloadResult } from '../utils/pdfco';
import { renderMarkdown } from '../utils/markdownRenderer';
import { getCurrentUser } from '../utils/supabase';
import { searchMemory } from '../utils/memory';

interface AgentChatProps {
  profile: UserProfile;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function buildSystemPrompt(profile: UserProfile, documents: StoredDocument[], memoryResults: string[]): string {
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

  const memorySection = memoryResults.length > 0
    ? `\n## Relevant User Memories (Search Results)\n${memoryResults.map(m => `- ${m}`).join('\n')}\n`
    : '\n## Relevant User Memories\nNo relevant memories found for this query.\n';

  return `You are a personal job application assistant called "Copilot Agent" built into a Chrome extension.

You have access to the user's profile, document vault, and their memory graph (all stored securely).

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
${memorySection}

## Your Capabilities
1. **Answer job application questions** — When the user pastes questions like "Why should we hire you?", "Tell us about yourself", "What are your strengths?", etc., craft a sharp, high-impact answer that is deeply rooted in the user's actual skills, projects, experience, and accomplishments from the profile and resume above. Be specific — name the technologies, products, roles, and outcomes. No filler sentences.
2. **Resume analysis** — Summarize the user's resume, identify strengths, suggest improvements, and highlight missing sections.
3. **Document requirements** — If the user describes a job application form's requirements, help them understand which documents or profile fields they need.
4. **File processing commands** — The user can ask you to process files. When they say things like:
   - "Compress my resume" → Respond with: \`[ACTION:COMPRESS:resume]\`
   - "Resize photo to 300x300" → Respond with: \`[ACTION:RESIZE:photo:300:300]\`
   - "Convert resume to images" → Respond with: \`[ACTION:IMAGES:resume]\`
   When you respond with these action codes, the extension will automatically execute the file processing. Always include a brief human-readable explanation alongside the action code.
5. **Profile advice** — Suggest improvements or missing info based on what's set in their profile.
6. **Autofill help** — Explain how the autofill works, what fields it can fill, and troubleshoot issues.

## Rules
- Be concise and direct. This is a popup — cut anything vague, generic, or filler.
- Never make up profile data. Only reference what's shown above.
- When answering job application questions (like "Why should we hire you?" or "Tell me about yourself"), you MUST:
  - Speak in the first person as if you ARE the user ("I built...", "I led...", "At IBM, I...").
  - Lead with the most impressive, specific thing from their background — a project, a role, a system they built, a measurable outcome.
  - Name actual technologies, tools, frameworks, and products from their profile and resume. No vague phrases like "strong foundation" or "eager to learn".
  - Structure the answer as: [What I've built / done] → [What makes me strong at it] → [What I bring to this role]. Tight, confident, copy-paste ready.
  - NEVER use filler phrases like "I am eager to contribute", "I am passionate about my work", "I thrive in dynamic environments", "I align with your organization's values". These are banned.
- If the user asks about a specific document requirement (e.g. "35×45mm passport photo"), translate it to pixels (at 96dpi or the specified resolution) and guide them to the right preset or custom dimensions.
- If something is not in your capabilities, say so clearly.`;
}

// Extract text from a PDF blob using PDF.co API
async function extractPdfText(blob: Blob, filename: string): Promise<string> {
  try {
    const url = await uploadToPdfCo(blob, filename);
    const { pdfToText } = await import('../utils/pdfco');
    return await pdfToText(url);
  } catch (err) {
    console.error('Failed to extract PDF text:', err);
    return '';
  }
}

export default function AgentChat({ profile }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const stored = sessionStorage.getItem('pc_agentMessages');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    sessionStorage.setItem('pc_agentMessages', JSON.stringify(messages));
  }, [messages]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [resumeText, setResumeText] = useState('');

  const [inlinePreviews, setInlinePreviews] = useState<{url: string, name: string}[]>([]);
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load documents + extract resume text for context
  useEffect(() => {
    (async () => {
      try {
        const docs = await loadAllDocumentMetadata();
        setDocuments(docs);
      } catch {
        setDocuments([]);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Process agent action codes (e.g. [ACTION:COMPRESS:resume])
  const processActions = useCallback(async (reply: string) => {
    const actionMatch = reply.match(/\[ACTION:(COMPRESS|RESIZE|IMAGES):([^\]]+)\]/);
    if (!actionMatch) return;

    const [, action, params] = actionMatch;
    const parts = params.split(':');
    const targetName = parts[0].toLowerCase();

    // Find matching document
    const doc = documents.find((d) =>
      d.name.toLowerCase().includes(targetName) ||
      d.originalName.toLowerCase().includes(targetName) ||
      d.category === targetName,
    );

    if (!doc) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ Could not find a document matching "${targetName}". Please check the Docs tab.` }]);
      return;
    }

    try {
      setMessages((prev) => [...prev, { role: 'assistant', content: `⏳ Processing "${doc.name}"...` }]);

      const blob = await loadDocumentBlob(doc.id);
      const uploadedUrl = await uploadToPdfCo(blob, doc.originalName);

      let resultUrl: string | string[];

      if (action === 'COMPRESS') {
        resultUrl = await compressPdf(uploadedUrl);
      } else if (action === 'IMAGES') {
        resultUrl = await pdfToImages(uploadedUrl);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ For image resizing, please go to the Docs tab → click ✏️ on the image → use the editor.' }]);
        return;
      }

      // Download and open result inline
      const urls = Array.isArray(resultUrl) ? resultUrl : [resultUrl];
      const previews = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const resultBlob = await downloadResult(url);
        const objectUrl = URL.createObjectURL(resultBlob);
        previews.push({ url: objectUrl, name: `${doc.originalName}_processed_${i + 1}` });
      }
      
      setInlinePreviews(previews);
      setMessages((prev) => [...prev, { role: 'assistant', content: `✅ Done! Previewing the processed file(s) below.` }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ Processing failed: ${msg}` }]);
    }
  }, [documents]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    // Search memory graph for relevant facts
    let memoryResults: string[] = [];
    const isFileAction = /(compress|resize|convert|image|pdf to|images|process)/i.test(text);
    
    if (!isFileAction) {

      try {
        const user = await getCurrentUser();
        if (user) {
          memoryResults = await searchMemory(user.id, text);
        }
      } catch (err) {
        console.error('Failed to search memory:', err);
      }

    }

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

      const systemPrompt = buildSystemPrompt(profile, documents, memoryResults);

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
          max_tokens: 1024,
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

      // Check for file processing action codes in the reply
      await processActions(reply);
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
    sessionStorage.removeItem('pc_agentMessages');
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
            <div className="icon" style={{ animation: 'float 6s ease-in-out infinite' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,212,255,0.4))' }}>
                <path d="M12 2V6M12 18V22M6 12H2M22 12H18M19.07 4.93L16.24 7.76M7.76 16.24L4.93 19.07M19.07 19.07L16.24 16.24M7.76 7.76L4.93 4.93" stroke="url(#paint0_linear)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="4" fill="url(#paint0_linear)"/>
                <defs>
                  <linearGradient id="paint0_linear" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop stopColor="var(--color-pc-accent-start)"/>
                    <stop offset="1" stopColor="var(--color-pc-accent-end)"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <div className="title">Agent</div>
            <div className="desc">
              Ask me anything about your profile, resume, or get help with job applications.
            </div>
            {/* Quick prompts */}
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', maxWidth: '280px' }}>
              {[
                '📋 What info is missing from my profile?',
                '💼 Why should we hire you? (generate answer)',
                '📝 Summarize my resume',
                '📦 Compress my resume PDF',
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
                  position: 'relative',
                  width: '100%',
                }}
                onMouseEnter={() => setHoveredMsgIdx(i)}
                onMouseLeave={() => setHoveredMsgIdx(null)}
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
                  wordBreak: 'break-word',
                  position: 'relative',
                }}>
                  {msg.role === 'assistant' && hoveredMsgIdx === i && (
                    <button
                      style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        background: 'var(--color-pc-surface)',
                        border: '1px solid var(--color-pc-border)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '0.7rem',
                        color: 'var(--color-pc-text-muted)',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        zIndex: 10,
                      }}
                      onClick={async () => {
                        await navigator.clipboard.writeText(msg.content);
                        setCopiedMsgIdx(i);
                        setTimeout(() => setCopiedMsgIdx(null), 2000);
                      }}
                    >
                      {copiedMsgIdx === i ? '✓ Copied' : '📋 Copy'}
                    </button>
                  )}
                  {msg.role === 'assistant' ? (
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  )}
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

      {/* Inline Previews */}
      {inlinePreviews.length > 0 && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-pc-text)' }}>Processed File(s)</span>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-pc-primary)', fontSize: '0.7rem', fontWeight: 600 }}
                onClick={() => {
                  inlinePreviews.forEach(p => {
                    const a = document.createElement('a');
                    a.href = p.url;
                    a.download = p.name;
                    a.click();
                  });
                }}
              >⬇ Download All</button>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-pc-text-muted)', fontSize: '0.7rem' }}
                onClick={() => setInlinePreviews([])}
              >✕ Close</button>
            </div>
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto', borderRadius: 8, background: '#fff' }}>
            {inlinePreviews.map((preview, i) => (
              <iframe key={i} src={`${preview.url}#toolbar=0`} width="100%" height="200px" style={{ border: 'none', marginBottom: i === inlinePreviews.length - 1 ? 0 : 8 }} title={preview.name} />
            ))}
          </div>
        </div>
      )}

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
            placeholder="Ask about your resume, paste interview questions..."
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
