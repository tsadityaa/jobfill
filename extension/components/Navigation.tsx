import { useRef, useEffect, useState } from 'react';

interface NavigationProps {
  activeTab: 'details' | 'documents' | 'agent';
  onTabChange: (tab: 'details' | 'documents' | 'agent') => void;
}

const tabs = [
  { id: 'details' as const, icon: <span style={{ fontSize: '1.1em' }}>👤</span>, label: 'My Details' },
  { id: 'documents' as const, icon: <span style={{ fontSize: '1.1em' }}>📄</span>, label: 'Docs' },
  { 
    id: 'agent' as const, 
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', filter: 'drop-shadow(0 2px 6px rgba(0,212,255,0.4))' }}>
        <path d="M12 2V6M12 18V22M6 12H2M22 12H18M19.07 4.93L16.24 7.76M7.76 16.24L4.93 19.07M19.07 19.07L16.24 16.24M7.76 7.76L4.93 4.93" stroke="url(#nav_paint0_linear)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="12" cy="12" r="4" fill="url(#nav_paint0_linear)"/>
        <defs>
          <linearGradient id="nav_paint0_linear" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--color-pc-accent-start)"/>
            <stop offset="1" stopColor="var(--color-pc-accent-end)"/>
          </linearGradient>
        </defs>
      </svg>
    ), 
    label: 'Agent' 
  },
];

export default function Navigation({ activeTab, onTabChange }: NavigationProps) {
  const navRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    if (!navRef.current) return;
    const activeButton = navRef.current.querySelector(
      `[data-tab="${activeTab}"]`,
    ) as HTMLElement | null;
    if (activeButton) {
      const navRect = navRef.current.getBoundingClientRect();
      const btnRect = activeButton.getBoundingClientRect();
      setIndicatorStyle({
        left: btnRect.left - navRect.left,
        width: btnRect.width,
      });
    }
  }, [activeTab]);

  return (
    <nav className="nav-tabs" ref={navRef}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`nav-tab-${tab.id}`}
          data-tab={tab.id}
          className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="tab-icon">{tab.icon}</span>
          {tab.label}
        </button>
      ))}
      <div
        className="nav-indicator"
        style={{
          transform: `translateX(${indicatorStyle.left}px)`,
          width: `${indicatorStyle.width}px`,
        }}
      />
    </nav>
  );
}
