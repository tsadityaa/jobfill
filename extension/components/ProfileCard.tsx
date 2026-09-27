import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

interface ProfileCardProps {
  icon: string;
  iconClass: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Animation stagger index for cascading entrance */
  staggerIndex?: number;
  children: ReactNode;
}

export default function ProfileCard({
  icon,
  iconClass,
  title,
  subtitle,
  defaultOpen = false,
  staggerIndex = 0,
  children,
}: ProfileCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);

  // Measure the body content height for smooth transitions
  useEffect(() => {
    if (open && bodyRef.current) {
      setBodyHeight(bodyRef.current.scrollHeight);
    }
  }, [open, children]);

  return (
    <div
      className={`section-card ${open ? 'section-card-open' : ''}`}
      style={{ animationDelay: `${staggerIndex * 60}ms` }}
    >
      <div
        className="section-header"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        aria-expanded={open}
      >
        <div className="section-header-left">
          <div className={`section-icon ${iconClass}`}>
            {icon}
          </div>
          <div>
            <div className="section-title">{title}</div>
            {subtitle && <div className="section-subtitle">{subtitle}</div>}
          </div>
        </div>
        <span className={`section-chevron ${open ? 'open' : ''}`}>
          ▾
        </span>
      </div>
      <div
        className={`section-body-wrapper ${open ? 'section-body-open' : 'section-body-closed'}`}
        style={{
          maxHeight: open ? (bodyHeight ? `${bodyHeight + 28}px` : '1000px') : '0px',
        }}
      >
        <div className="section-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
