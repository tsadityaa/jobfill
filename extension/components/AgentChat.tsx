import { useState } from 'react';

export default function AgentChat() {
  const [input, setInput] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Placeholder */}
      <div className="agent-placeholder" style={{ flex: 1 }}>
        <div className="icon">🤖</div>
        <div className="title">Agent</div>
        <div className="desc">
          Ask me to prepare documents, analyze requirements, or fill applications using your profile.
        </div>
        <div style={{
          marginTop: '20px',
          padding: '12px 16px',
          background: 'var(--color-pc-surface)',
          border: '1px solid var(--color-pc-border)',
          borderRadius: '8px',
          fontSize: '0.75rem',
          color: 'var(--color-pc-text-muted)',
          maxWidth: '280px',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--color-pc-text-secondary)', marginBottom: '8px' }}>
            Coming in Phase 5
          </div>
          <div style={{ lineHeight: 1.5 }}>
            Examples:
            <br />• "Prepare my photo for this application"
            <br />• "What documents does this page require?"
            <br />• "Convert my Aadhaar to 600×400 JPG"
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="agent-input-area">
        <div className="agent-input-wrapper">
          <input
            id="agent-input"
            className="agent-input"
            type="text"
            placeholder="What do you need?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled
          />
          <button className="btn btn-primary" disabled>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
