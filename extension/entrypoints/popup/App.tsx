import { useState, useEffect, useCallback } from 'react';
import type { UserProfile } from '../../types/profile';
import { createEmptyProfile } from '../../types/profile';
import { cloudGetProfile, cloudGetProfileWithStatus, cloudSaveProfile } from '../../utils/cloudStorage';
import { supabase, getCurrentUser, signOut } from '../../utils/supabase';
import { isProfileEmpty } from '../../utils/resumeParser';
import Navigation from '../../components/Navigation';
import ProfileSection from '../../components/ProfileSection';
import AutofillButton from '../../components/AutofillButton';
import AgentChat from '../../components/AgentChat';
import DocumentsSection from '../../components/DocumentsSection';
import LoginScreen from '../../components/LoginScreen';
import OnboardingWizard from '../../components/OnboardingWizard';
import type { User } from '@supabase/supabase-js';
import { addMemory, syncProfileToMemory } from '../../utils/memory';

type TabId = 'details' | 'documents' | 'agent';

async function getOnboardingDone(userId: string): Promise<boolean> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(`jobfill_onboarding_done_${userId}`);
      if (res[`jobfill_onboarding_done_${userId}`]) return true;
    }
  } catch (e) {
    // fallback
  }
  return sessionStorage.getItem(`jobfill_onboarding_done_${userId}`) === 'true';
}

async function markOnboardingDone(userId: string): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [`jobfill_onboarding_done_${userId}`]: true });
    }
  } catch (e) {
    // fallback
  }
  sessionStorage.setItem(`jobfill_onboarding_done_${userId}`, 'true');
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    return (sessionStorage.getItem('pc_activeTab') as TabId) || 'details';
  });

  useEffect(() => {
    sessionStorage.setItem('pc_activeTab', activeTab);
  }, [activeTab]);

  const [profile, setProfile] = useState<UserProfile>(createEmptyProfile());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Check auth state on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
      } catch {
        setUser(null);
      }
      setAuthChecked(true);
    }
    checkAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load profile when user logs in
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    async function loadProfile() {
      if (!user) return;
      setLoading(true);
      try {
        const { profile: p, hasSavedProfile } = await cloudGetProfileWithStatus();
        setProfile(p);

        // Check if user has already completed/skipped onboarding on this client
        const onboardingDoneLocally = await getOnboardingDone(user.id);
        const empty = isProfileEmpty(p);

        // Show onboarding if:
        // - User hasn't finished/dismissed onboarding locally
        // - AND (either they have no saved cloud profile OR their profile is bare OAuth)
        if (!onboardingDoneLocally && (!hasSavedProfile || empty)) {
          setShowOnboarding(true);
        } else {
          setShowOnboarding(false);
        }

        syncProfileToMemory(user.id, p).catch(console.error);
      } catch (err) {
        console.error('Failed to load profile:', err);
        setProfile(createEmptyProfile());
        setShowOnboarding(true);
      }
      setLoading(false);
    }
    loadProfile();
  }, [user]);

  // Handle login callback
  const handleLogin = useCallback(async () => {
    const currentUser = await getCurrentUser();
    setUser(currentUser);
  }, []);

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
    setProfile(createEmptyProfile());
    setShowOnboarding(false);
  }, []);

  // Save profile to cloud
  const handleSaveProfile = useCallback(async (updated: UserProfile) => {
    setProfile(updated);
    setSaving(true);
    try {
      await cloudSaveProfile(updated);
      
      // Update memory with comprehensive profile facts
      if (user) {
        await syncProfileToMemory(user.id, updated).catch(console.error);
      }
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setTimeout(() => setSaving(false), 500);
    }
  }, [user]);

  // Handle onboarding complete — save the profile from the wizard
  const handleOnboardingComplete = useCallback(async (onboardedProfile: UserProfile) => {
    setProfile(onboardedProfile);
    setShowOnboarding(false);
    if (user) {
      await markOnboardingDone(user.id);
    }
    setSaving(true);
    try {
      await cloudSaveProfile(onboardedProfile);
      if (user) {
        await syncProfileToMemory(user.id, onboardedProfile).catch(console.error);
      }
    } catch (err) {
      console.error('Failed to save onboarding profile:', err);
    } finally {
      setTimeout(() => setSaving(false), 500);
    }
  }, [user]);

  const handleOnboardingSkip = useCallback(async () => {
    setShowOnboarding(false);
    if (user) {
      await markOnboardingDone(user.id);
    }
  }, [user]);

  // ---- Auth Check Loading ----

  if (!authChecked) {
    return (
      <div className="loading-screen animate-fade-in">
        <div className="shimmer-container">
          <div className="shimmer-header">
            <div className="shimmer-circle" />
            <div className="shimmer-lines">
              <div className="shimmer-line shimmer-line-long" />
              <div className="shimmer-line shimmer-line-short" />
            </div>
          </div>
          <div className="shimmer-card" />
          <div className="shimmer-card shimmer-card-short" />
        </div>
        <div className="loading-label">
          <span className="loading-dot-pulse" />
          Checking session…
        </div>
      </div>
    );
  }

  // ---- Login Screen ----

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // ---- Loading Profile ----

  if (loading) {
    return (
      <div className="loading-screen animate-fade-in">
        <div className="shimmer-container">
          <div className="shimmer-header">
            <div className="shimmer-circle" />
            <div className="shimmer-lines">
              <div className="shimmer-line shimmer-line-long" />
              <div className="shimmer-line shimmer-line-short" />
            </div>
          </div>
          <div className="shimmer-card" />
          <div className="shimmer-card shimmer-card-short" />
          <div className="shimmer-card" />
        </div>
        <div className="loading-label">
          <span className="loading-dot-pulse" />
          Loading your profile…
        </div>
      </div>
    );
  }

  // ---- First-time User Onboarding ----

  if (showOnboarding) {
    return (
      <OnboardingWizard
        initialProfile={profile}
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
      />
    );
  }

  // ---- Main App ----

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
      {/* Header */}
      <header className="header">
        <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3L2 8L12 13L22 8L12 3Z" fill="#00e5ff"/>
            <path d="M2.5 13L12 17.5L21.5 13M2.5 17L12 21.5L21.5 17" stroke="#ff9800" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="gradient-text" style={{ fontSize: '1.25rem', letterSpacing: '-0.02em' }}>MemoraFill</span>
          {saving ? (
            <span className="save-indicator animate-fade-in">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="save-check-icon">
                <circle cx="7" cy="7" r="6" stroke="var(--color-pc-success)" strokeWidth="1.5" opacity="0.3" />
                <path d="M4 7.2L6 9.2L10 5" stroke="var(--color-pc-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Saved
            </span>
          ) : (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className="btn-lock"
                onClick={() => setShowOnboarding(true)}
                title="Launch setup wizard to fill or update profile"
                style={{ fontSize: '0.72rem', padding: '4px 8px' }}
              >
                ⚡ Setup
              </button>
              <button
                className="btn-lock"
                onClick={handleSignOut}
                title="Sign out"
              >
                🚪 Sign Out
              </button>
            </div>
          )}
        </div>
        {user.email && (
          <div style={{
            fontSize: '0.65rem',
            color: 'var(--color-pc-text-muted)',
            padding: '0 20px 4px',
            fontFamily: 'var(--font-sans)',
          }}>
            {user.email}
          </div>
        )}
      </header>

      {/* Navigation */}
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Content */}
      <div className="content" style={{ flex: 1 }}>
        {activeTab === 'details' && (
          <ProfileSection profile={profile} onSave={handleSaveProfile} />
        )}
        {activeTab === 'documents' && (
          <DocumentsSection />
        )}
        {activeTab === 'agent' && (
          <AgentChat profile={profile} />
        )}
      </div>

      {/* Autofill Footer — only show on details tab */}
      {activeTab === 'details' && (
        <AutofillButton profile={profile} />
      )}
    </div>
  );
}
