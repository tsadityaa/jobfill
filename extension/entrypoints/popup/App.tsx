import { useState, useEffect, useCallback } from 'react';
import type { UserProfile } from '../../types/profile';
import type { VaultState } from '../../types/vault';
import { createEmptyProfile } from '../../types/profile';
import {
  getProfile,
  saveProfile,
  setupVault,
} from '../../utils/storage';
import {
  getVaultState,
  unlockVault,
  lockVault,
  hasLegacyData,
  tryRestoreSession,
  loadFromVault,
} from '../../utils/vault';
import Navigation from '../../components/Navigation';
import ProfileSection from '../../components/ProfileSection';
import AutofillButton from '../../components/AutofillButton';
import AgentChat from '../../components/AgentChat';
import VaultLock from '../../components/VaultLock';
import DocumentsSection from '../../components/DocumentsSection';

type TabId = 'details' | 'documents' | 'agent';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [profile, setProfile] = useState<UserProfile>(createEmptyProfile());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vaultState, setVaultState] = useState<VaultState>('uninitialized');
  const [hasMigration, setHasMigration] = useState(false);

  // Check vault state on mount
  useEffect(() => {
    async function init() {
      const state = await getVaultState();

      if (state === 'uninitialized') {
        // Check if there's legacy data to migrate
        const legacy = await hasLegacyData();
        setHasMigration(legacy);
        setVaultState('uninitialized');
        setLoading(false);
        return;
      }

      if (state === 'unlocked') {
        // Already unlocked (cached key from this session in-memory)
        const p = await getProfile();
        setProfile(p);
        setVaultState('unlocked');
        setLoading(false);
        return;
      }

      // State is 'locked' — try session restoration first
      const restoredKey = await tryRestoreSession();
      if (restoredKey) {
        // Session key was valid — vault is now unlocked
        try {
          const p = await loadFromVault();
          setProfile(p);
          setVaultState('unlocked');
          setLoading(false);
          return;
        } catch {
          // Key was stale or invalid — fall through to locked
        }
      }

      setVaultState('locked');
      setLoading(false);
    }
    init();
  }, []);

  // Handle vault setup (first time)
  const handleSetup = useCallback(async (password: string) => {
    const p = await setupVault(password);
    setProfile(p);
    setVaultState('unlocked');
  }, []);

  // Handle vault unlock
  const handleUnlock = useCallback(async (password: string) => {
    const p = await unlockVault(password);
    setProfile(p);
    setVaultState('unlocked');
  }, []);

  // Handle vault lock (now async due to session cleanup)
  const handleLock = useCallback(async () => {
    await lockVault();
    setProfile(createEmptyProfile());
    setVaultState('locked');
  }, []);

  // Save profile (debounced via explicit save)
  const handleSaveProfile = useCallback(async (updated: UserProfile) => {
    setProfile(updated);
    setSaving(true);
    try {
      await saveProfile(updated);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setTimeout(() => setSaving(false), 500);
    }
  }, []);

  // ---- Loading State ----

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
          Decrypting your vault…
        </div>
      </div>
    );
  }

  // ---- Vault Lock / Setup Screen ----

  if (vaultState !== 'unlocked') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
        {/* Header */}
        <header className="header">
          <div className="header-title">
            <span className="icon">🧠</span>
            <span className="gradient-text">Personal Copilot</span>
          </div>
        </header>

        <VaultLock
          vaultState={vaultState}
          onUnlock={handleUnlock}
          onSetup={handleSetup}
        />

        {hasMigration && vaultState === 'uninitialized' && (
          <div style={{
            padding: '8px 20px',
            fontSize: '0.72rem',
            color: 'var(--color-pc-info)',
            textAlign: 'center',
          }}>
            ℹ Your existing profile data will be encrypted and migrated automatically.
          </div>
        )}
      </div>
    );
  }

  // ---- Main App (Vault Unlocked) ----

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
      {/* Header */}
      <header className="header">
        <div className="header-title">
          <span className="icon">🧠</span>
          <span className="gradient-text">Personal Copilot</span>
          {saving ? (
            <span className="save-indicator animate-fade-in">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="save-check-icon">
                <circle cx="7" cy="7" r="6" stroke="var(--color-pc-success)" strokeWidth="1.5" opacity="0.3" />
                <path d="M4 7.2L6 9.2L10 5" stroke="var(--color-pc-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Saved
            </span>
          ) : (
            <button
              className="btn-lock"
              onClick={handleLock}
              title="Lock vault"
            >
              🔒 Lock
            </button>
          )}
        </div>
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
