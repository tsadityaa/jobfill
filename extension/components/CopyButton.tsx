import { useState, useCallback } from 'react';

interface CopyButtonProps {
  /** The text to copy to clipboard */
  value: string;
  /** Optional tooltip label */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export default function CopyButton({ value, label, size = 'sm' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger parent click handlers (like card expand)
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [value]);

  if (!value) return null;

  return (
    <button
      className={`copy-btn ${copied ? 'copy-btn-success' : ''} copy-btn-${size}`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : (label ? `Copy ${label}` : 'Copy to clipboard')}
      type="button"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="copy-icon-check">
          <path
            d="M2 6.5L4.5 9L10 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="copy-icon-clipboard">
          <rect x="3.5" y="3.5" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 8.5V2.5a1 1 0 0 1 1-1h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
