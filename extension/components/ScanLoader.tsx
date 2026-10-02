import { useEffect, useState } from 'react';

// ============================================================
// ScanLoader — Holographic scanner animation
// Pure CSS keyframes + React state for text cycling.
// No canvas. Looks insane.
// ============================================================

interface ScanLoaderProps {
  /** Primary verb shown in the heading */
  mode: 'scanning' | 'filling' | 'ai';
}

const SCAN_LINES = [
  'Reading DOM structure…',
  'Detecting input fields…',
  'Mapping label attributes…',
  'Checking aria descriptors…',
  'Cross-referencing selectors…',
  'Building field graph…',
];

const FILL_LINES = [
  'Resolving profile data…',
  'Injecting field values…',
  'Triggering change events…',
  'Verifying fill accuracy…',
];

const AI_LINES = [
  'Tokenising field context…',
  'Querying language model…',
  'Scoring field candidates…',
  'Merging AI mappings…',
];

export default function ScanLoader({ mode }: ScanLoaderProps) {
  const lines = mode === 'scanning' ? SCAN_LINES : mode === 'filling' ? FILL_LINES : AI_LINES;
  const [lineIdx, setLineIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  // Cycle through status lines
  useEffect(() => {
    const iv = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setLineIdx((i) => (i + 1) % lines.length);
        setVisible(true);
      }, 280);
    }, 1400);
    return () => clearInterval(iv);
  }, [lines.length]);

  const title   = mode === 'scanning' ? 'Scanning'   : mode === 'filling' ? 'Filling'      : 'AI Mapping';
  const accent1 = mode === 'scanning' ? '#00d4ff'    : mode === 'filling' ? '#00ff87'       : '#00d4ff';
  const accent2 = mode === 'scanning' ? '#00ff87'    : mode === 'filling' ? '#ffb300'       : '#00ff87';

  return (
    <>
      <style>{`
        @keyframes sl-spin  { to { transform: rotate(360deg); } }
        @keyframes sl-spin-rev { to { transform: rotate(-360deg); } }
        @keyframes sl-pulse {
          0%,100% { opacity:.5; transform:scale(.97); }
          50%      { opacity:1;  transform:scale(1.03); }
        }
        @keyframes sl-sweep {
          0%   { transform:translateY(-100%) scaleX(1); opacity:0; }
          15%  { opacity:1; }
          85%  { opacity:1; }
          100% { transform:translateY(100%)  scaleX(1); opacity:0; }
        }
        @keyframes sl-beam-h {
          0%   { transform:translateX(-120%); opacity:0; }
          10%  { opacity:.8; }
          90%  { opacity:.8; }
          100% { transform:translateX(120%);  opacity:0; }
        }
        @keyframes sl-dash {
          to { stroke-dashoffset: -240; }
        }
        @keyframes sl-fade {
          0%   { opacity:0; transform:translateY(4px); }
          100% { opacity:1; transform:translateY(0); }
        }
        @keyframes sl-blink { 50% { opacity:0; } }
        @keyframes sl-dot-bounce {
          0%,80%,100% { transform:scale(0); opacity:0; }
          40%          { transform:scale(1); opacity:1; }
        }
        @keyframes sl-orb-rot {
          to { transform: translate(-50%,-50%) rotate(360deg); }
        }
      `}</style>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '10px 0 6px',
        width: '100%',
        userSelect: 'none',
      }}>

        {/* ---- Orb + rings ---- */}
        <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>

          {/* Outer ring — dashed, slow spin */}
          <svg width="100" height="100" style={{
            position: 'absolute', inset: 0,
            animation: 'sl-spin 6s linear infinite',
          }}>
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke={accent1}
              strokeWidth="1"
              strokeDasharray="8 6"
              opacity="0.35"
            />
          </svg>

          {/* Middle ring — solid arc, fast spin */}
          <svg width="100" height="100" style={{
            position: 'absolute', inset: 0,
            animation: 'sl-spin 2.2s linear infinite',
          }}>
            <circle
              cx="50" cy="50" r="36"
              fill="none"
              stroke={`url(#sg-${mode})`}
              strokeWidth="2"
              strokeDasharray="72 150"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id={`sg-${mode}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={accent1} stopOpacity="0" />
                <stop offset="50%" stopColor={accent1} stopOpacity="1" />
                <stop offset="100%" stopColor={accent2} stopOpacity="0.6" />
              </linearGradient>
            </defs>
          </svg>

          {/* Inner ring — reverse slow spin */}
          <svg width="100" height="100" style={{
            position: 'absolute', inset: 0,
            animation: 'sl-spin-rev 4s linear infinite',
          }}>
            <circle
              cx="50" cy="50" r="26"
              fill="none"
              stroke={accent2}
              strokeWidth="1.5"
              strokeDasharray="12 8"
              strokeLinecap="round"
              opacity="0.5"
            />
          </svg>

          {/* Scan sweep beam (vertical) */}
          <div style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            width: 2,
            height: '100%',
            transform: 'translateX(-50%)',
            overflow: 'hidden',
            borderRadius: 99,
          }}>
            <div style={{
              position: 'absolute',
              top: 0, left: 0,
              width: '100%', height: '100%',
              background: `linear-gradient(180deg, transparent, ${accent1}cc, ${accent1}, ${accent1}cc, transparent)`,
              animation: 'sl-sweep 1.6s ease-in-out infinite',
            }} />
          </div>

          {/* Scan sweep beam (horizontal) */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            height: 2,
            width: '100%',
            transform: 'translateY(-50%)',
            overflow: 'hidden',
            borderRadius: 99,
          }}>
            <div style={{
              position: 'absolute',
              top: 0, left: 0,
              width: '100%', height: '100%',
              background: `linear-gradient(90deg, transparent, ${accent2}aa, ${accent2}, ${accent2}aa, transparent)`,
              animation: 'sl-beam-h 1.6s ease-in-out infinite 0.8s',
            }} />
          </div>

          {/* Core orb */}
          <div style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: 32, height: 32,
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            background: `radial-gradient(circle at 38% 35%, ${accent1}40, ${accent2}20 55%, transparent 75%)`,
            boxShadow: `0 0 16px 4px ${accent1}50, 0 0 6px ${accent1}80, inset 0 0 6px ${accent2}30`,
            animation: 'sl-pulse 1.8s ease-in-out infinite',
          }} />

          {/* Corner tick marks */}
          {[0, 90, 180, 270].map((deg) => (
            <div key={deg} style={{
              position: 'absolute',
              top: '50%', left: '50%',
              width: 8, height: 2,
              transformOrigin: '0 0',
              transform: `rotate(${deg}deg) translateX(42px) translateY(-1px)`,
              background: `${accent1}`,
              boxShadow: `0 0 4px ${accent1}`,
              borderRadius: 1,
            }} />
          ))}
        </div>

        {/* ---- Title ---- */}
        <div style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
          background: `linear-gradient(90deg, ${accent1}, ${accent2})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {title}
        </div>

        {/* ---- Status line — cycling typewriter ---- */}
        <div style={{
          fontSize: '0.62rem',
          color: 'var(--color-pc-text-muted)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.28s ease',
          minHeight: '0.9rem',
          textAlign: 'center',
        }}>
          {lines[lineIdx]}
        </div>

        {/* ---- Bouncing dots ---- */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              width: 5, height: 5,
              borderRadius: '50%',
              background: i === 0 ? accent1 : i === 1 ? accent2 : accent1,
              animation: `sl-dot-bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
              boxShadow: `0 0 6px ${i === 1 ? accent2 : accent1}`,
            }} />
          ))}
        </div>

      </div>
    </>
  );
}
