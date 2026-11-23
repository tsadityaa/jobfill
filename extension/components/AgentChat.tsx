import { useState, useRef, useEffect, useCallback } from 'react';
import type { UserProfile } from '../types/profile';
import { getPrimary } from '../types/profile';
import { cloudLoadAllDocumentMetadata as loadAllDocumentMetadata, cloudLoadDocumentBlob as loadDocumentBlob } from '../utils/cloudStorage';
import type { StoredDocument } from '../types/document';
import { uploadToPdfCo, compressPdf, pdfToImages, downloadResult } from '../utils/pdfco';
import { renderMarkdown } from '../utils/markdownRenderer';
import { getCurrentUser } from '../utils/supabase';
import { searchMemory } from '../utils/memory';
import { AI_MODEL, requestAgentRouter } from '../utils/backendClient';

interface AgentChatProps {
  profile: UserProfile;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const writeText = navigator.clipboard?.writeText;
    if (writeText) {
      await writeText.call(navigator.clipboard, text);
      return true;
    }
  } catch {
    // Clipboard API can be blocked by the popup's embedding permissions policy.
  }

  let textarea: HTMLTextAreaElement | undefined;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
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

const QUICK_PROMPTS = [
  { icon: '📋', text: 'What info is missing from my profile?' },
  { icon: '💼', text: 'Why should we hire you? (generate answer)' },
  { icon: '📝', text: 'Summarize my resume' },
  { icon: '📦', text: 'Compress my resume PDF' },
  { icon: '🔍', text: 'What fields can autofill on a job form?' },
];

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
  const [copyFailedMsgIdx, setCopyFailedMsgIdx] = useState<number | null>(null);
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
    if (!text || loading) {
      inputRef.current?.focus();
      return;
    }

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
      const systemPrompt = buildSystemPrompt(profile, documents, memoryResults);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await requestAgentRouter({
          model: AI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            ...updatedMessages,
          ],
          temperature: 0.7,
          max_tokens: 1024,
        }, controller.signal, 'agent-chat');

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 404) {
          throw new Error('The backend does not have the Agent Router endpoint yet. Start the updated local backend or deploy the latest Worker.');
        }
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
    <div className="agent-container">
      {/* Messages area */}
      <div className="agent-messages-area">
        {messages.length === 0 ? (
          /* Empty state matching the Apple glass UI */
          <div className="agent-placeholder">
            <div className="agent-icon-wrapper">
              <svg
                className="agent-sunburst-svg"
                width="52"
                height="52"
                viewBox="0 0 52 52"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id="apple_agent_sunburst" x1="14" y1="6" x2="38" y2="46" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fef08a" />
                    <stop offset="25%" stopColor="#a3e635" />
                    <stop offset="65%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#0ea5e9" />
                  </linearGradient>
                </defs>
                {/* Center circle */}
                <circle cx="26" cy="26" r="7.5" fill="url(#apple_agent_sunburst)" />
                {/* 8 rounded radial rays */}
                <line x1="26" y1="5.5" x2="26" y2="13" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="26" y1="39" x2="26" y2="46.5" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="39" y1="26" x2="46.5" y2="26" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="5.5" y1="26" x2="13" y2="26" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="35.2" y1="16.8" x2="40.5" y2="11.5" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="16.8" y1="35.2" x2="11.5" y2="40.5" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="35.2" y1="35.2" x2="40.5" y2="40.5" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
                <line x1="16.8" y1="16.8" x2="11.5" y2="11.5" stroke="url(#apple_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="title">Agent</div>
            <div className="desc">
              Ask me anything about your profile, resume, or get help with job applications.
            </div>

            {/* Quick prompts */}
            <div className="agent-prompts-list">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt.text}
                  type="button"
                  className={`agent-prompt-btn ${input === prompt.text ? 'active' : ''}`}
                  onClick={() => {
                    setInput(prompt.text);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="agent-prompt-icon">{prompt.icon}</span>
                  <span className="agent-prompt-text">{prompt.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div
                key={i}
                className="agent-msg-row"
                style={{ alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
                onMouseEnter={() => setHoveredMsgIdx(i)}
                onMouseLeave={() => setHoveredMsgIdx(null)}
              >
                <div className={`agent-msg-bubble ${msg.role}`}>
                  {msg.role === 'assistant' && hoveredMsgIdx === i && (
                    <button
                      className="agent-copy-btn"
                      onClick={async () => {
                        const copied = await copyTextToClipboard(msg.content);
                        setCopiedMsgIdx(copied ? i : null);
                        setCopyFailedMsgIdx(copied ? null : i);
                        setTimeout(() => {
                          setCopiedMsgIdx(null);
                          setCopyFailedMsgIdx(null);
                        }, 2000);
                      }}
                    >
                      {copiedMsgIdx === i ? '✓ Copied' : copyFailedMsgIdx === i ? 'Copy blocked' : '📋 Copy'}
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
                <div className="agent-loading-bubble">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="agent-loading-dot"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    />
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
        <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#e2e8f0' }}>Processed File(s)</span>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#38bdf8', fontSize: '0.7rem', fontWeight: 600 }}
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
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.7rem' }}
                onClick={() => setInlinePreviews([])}
              >✕ Close</button>
            </div>
          </div>
          <div style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: 10, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {inlinePreviews.map((preview, i) => (
              <iframe key={i} src={`${preview.url}#toolbar=0`} width="100%" height="180px" style={{ border: 'none', marginBottom: i === inlinePreviews.length - 1 ? 0 : 8 }} title={preview.name} />
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="agent-input-area">
        {messages.length > 0 && (
          <div className="agent-input-toolbar">
            <button
              className="agent-clear-btn"
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
            placeholder="Ask about your resume, paste interview ques..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            className="agent-send-btn"
            onClick={handleSend}
            disabled={loading}
          >
            {loading ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
