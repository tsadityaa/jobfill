import { useRef, useEffect, useState } from 'react';

interface NavigationProps {
  activeTab: 'details' | 'documents' | 'agent';
  onTabChange: (tab: 'details' | 'documents' | 'agent') => void;
}

const tabs = [
  { id: 'details' as const, icon: '👤', label: 'My Details' },
  { id: 'documents' as const, icon: '📄', label: 'Docs' },
  { id: 'agent' as const, icon: '🤖', label: 'Agent' },
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
