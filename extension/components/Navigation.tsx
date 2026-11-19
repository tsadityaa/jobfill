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
      <svg width="18" height="18" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', filter: 'drop-shadow(0 1px 4px rgba(56,189,248,0.5))' }}>
        <defs>
          <linearGradient id="nav_agent_sunburst" x1="14" y1="6" x2="38" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="25%" stopColor="#a3e635" />
            <stop offset="65%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <circle cx="26" cy="26" r="7.5" fill="url(#nav_agent_sunburst)"/>
        <line x1="26" y1="5.5" x2="26" y2="13" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="26" y1="39" x2="26" y2="46.5" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="39" y1="26" x2="46.5" y2="26" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="5.5" y1="26" x2="13" y2="26" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="35.2" y1="16.8" x2="40.5" y2="11.5" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="16.8" y1="35.2" x2="11.5" y2="40.5" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="35.2" y1="35.2" x2="40.5" y2="40.5" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
        <line x1="16.8" y1="16.8" x2="11.5" y2="11.5" stroke="url(#nav_agent_sunburst)" strokeWidth="3.2" strokeLinecap="round"/>
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
    const updateIndicator = () => {
      if (!navRef.current) return;
      const activeButton = navRef.current.querySelector(
        `[data-tab="${activeTab}"]`,
      ) as HTMLElement | null;
      if (activeButton) {
        setIndicatorStyle({
          left: activeButton.offsetLeft,
          width: activeButton.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
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
          left: 0,
          transform: `translateX(${indicatorStyle.left}px)`,
          width: `${indicatorStyle.width}px`,
        }}
      />
    </nav>
  );
}
