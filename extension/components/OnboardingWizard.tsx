import { useState, useCallback, useRef, useEffect } from 'react';
import type { UserProfile, Education, Experience, SchoolEducation } from '../types/profile';
import { createEmptyProfile, generateId } from '../types/profile';
import { parseResumeToProfile } from '../utils/resumeParser';
import { uploadToPdfCo, pdfToText, wordToPdf } from '../utils/pdfco';
import {
  cloudSaveDocument as saveDocument,
} from '../utils/cloudStorage';
import { saveDocumentRegistryMetadata, withInferredDocumentMetadata } from '../utils/documentRegistry';
import type { StoredDocument } from '../types/document';
import { guessCategoryFromFile } from '../types/document';
import { generateThumbnail, getImageDimensions } from '../utils/documentProcessor';
import { isImageType } from '../types/document';
import { getCurrentUser } from '../utils/supabase';
import { addMemory } from '../utils/memory';

interface OnboardingWizardProps {
  initialProfile?: UserProfile;
  onComplete: (profile: UserProfile) => void;
  onSkip: () => void;
}

type Step = 'welcome' | 'method' | 'resume-upload' | 'resume-parsing' | 'manual-personal' | 'manual-contact' | 'manual-education' | 'manual-experience' | 'manual-professional' | 'review' | 'complete';

const STEP_ORDER_MANUAL: Step[] = [
  'welcome', 'method', 'manual-personal', 'manual-contact', 'manual-education', 'manual-experience', 'manual-professional', 'review', 'complete',
];
const STEP_ORDER_RESUME: Step[] = [
  'welcome', 'method', 'resume-upload', 'resume-parsing', 'review', 'complete',
];

// Gender options for the selector
const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

export default function OnboardingWizard({ initialProfile, onComplete, onSkip }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [profile, setProfile] = useState<UserProfile>(() => {
    if (initialProfile) {
      return {
        ...createEmptyProfile(),
        ...initialProfile,
        secondaryEducation: {
          twelfth: { institution: '', percentage: '', year: '', board: '', stream: '', ...(initialProfile.secondaryEducation?.twelfth || {}) },
          tenth: { institution: '', percentage: '', year: '', board: '', ...(initialProfile.secondaryEducation?.tenth || {}) },
        },
      };
    }
    return createEmptyProfile();
  });
  const [method, setMethod] = useState<'resume' | 'manual' | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStatus, setParseStatus] = useState('');
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync initialProfile if it loads asynchronously
  useEffect(() => {
    if (initialProfile) {
      setProfile((prev) => {
        const next = { ...prev };
        let modified = false;
        if (!next.personal.firstName && initialProfile.personal.firstName) {
          next.personal.firstName = initialProfile.personal.firstName;
          modified = true;
        }
        if (!next.personal.lastName && initialProfile.personal.lastName) {
          next.personal.lastName = initialProfile.personal.lastName;
          modified = true;
        }
        if ((!next.emails || next.emails.length === 0) && initialProfile.emails?.length) {
          next.emails = initialProfile.emails;
          modified = true;
        }
        if ((!next.education || next.education.length === 0) && initialProfile.education?.length) {
          next.education = initialProfile.education;
          modified = true;
        }
        if (initialProfile.secondaryEducation) {
          const prevTwelfth = next.secondaryEducation?.twelfth;
          const prevTenth = next.secondaryEducation?.tenth;
          const initTwelfth = initialProfile.secondaryEducation.twelfth;
          const initTenth = initialProfile.secondaryEducation.tenth;

          if (
            (!prevTwelfth?.institution && initTwelfth?.institution) ||
            (!prevTenth?.institution && initTenth?.institution)
          ) {
            next.secondaryEducation = {
              twelfth: { institution: '', percentage: '', year: '', board: '', stream: '', ...(prevTwelfth || {}), ...(initTwelfth || {}) },
              tenth: { institution: '', percentage: '', year: '', board: '', ...(prevTenth || {}), ...(initTenth || {}) },
            };
            modified = true;
          }
        }
        return modified ? next : prev;
      });
    }
  }, [initialProfile]);

  // Animation mount tracking
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // --- Step navigation ---
  const getStepIndex = () => {
    const steps = method === 'resume' ? STEP_ORDER_RESUME : STEP_ORDER_MANUAL;
    return steps.indexOf(step);
  };
  const getStepCount = () => {
    return method === 'resume' ? STEP_ORDER_RESUME.length : STEP_ORDER_MANUAL.length;
  };

  const goNext = (nextStep: Step) => {
    setDirection('forward');
    setError('');
    setStep(nextStep);
  };
  const goBack = (prevStep: Step) => {
    setDirection('backward');
    setError('');
    setStep(prevStep);
  };

  // --- Profile updaters ---
  const updatePersonal = useCallback((key: string, value: string) => {
    setProfile((prev) => ({
      ...prev,
      personal: { ...prev.personal, [key]: value },
    }));
  }, []);

  const updateProfessional = useCallback((key: string, value: string | string[]) => {
    setProfile((prev) => ({
      ...prev,
      professional: { ...prev.professional, [key]: value },
    }));
  }, []);

  // --- Resume upload handler ---
  const handleResumeFile = useCallback(async (file: File) => {
    const mimeType = file.type.toLowerCase();
    const isWord = /\.docx?$/i.test(file.name) || mimeType.includes('word');
    const isPdf = mimeType === 'application/pdf';

    if (!isPdf && !isWord) {
      setError('Please upload a PDF or Word document (.pdf, .doc, .docx)');
      return;
    }

    setError('');
    goNext('resume-parsing');
    setParsing(true);
    setParseProgress(10);
    setParseStatus('Uploading your resume...');

    try {
      // 1. Store the resume in documents section
      setParseProgress(15);
      setParseStatus('Saving to your documents...');
      const docId = generateId();
      const now = new Date().toISOString();

      let thumbnail: string | undefined;
      let width: number | undefined;
      let height: number | undefined;

      if (isImageType(mimeType)) {
        const dims = await getImageDimensions(file);
        width = dims.width;
        height = dims.height;
        thumbnail = await generateThumbnail(file, 80);
      }

      const metadata: StoredDocument = withInferredDocumentMetadata({
        id: docId,
        name: file.name.replace(/\.[^.]+$/, ''),
        originalName: file.name,
        mimeType: isPdf ? 'application/pdf' : mimeType,
        category: 'resume' as const,
        sizeBytes: file.size,
        width,
        height,
        thumbnail,
        createdAt: now,
        updatedAt: now,
      });
      metadata.isPrimary = true;

      await saveDocument(metadata, file);
      await saveDocumentRegistryMetadata(metadata);

      // 2. Upload to PDF.co for text extraction
      setParseProgress(30);
      setParseStatus('Uploading to text extractor...');
      const sourceUrl = await uploadToPdfCo(file, file.name);

      // Convert Word to PDF if needed
      const readableUrl = isPdf ? sourceUrl : await wordToPdf(sourceUrl);

      setParseProgress(50);
      setParseStatus('Extracting text from your resume...');
      const text = await pdfToText(readableUrl);

      if (!text || text.trim().length < 50) {
        throw new Error('Could not extract enough text from the document. Try a different file or fill manually.');
      }

      // 3. Save to Supermemory
      setParseProgress(60);
      setParseStatus('Indexing in your memory vault...');
      try {
        const user = await getCurrentUser();
        if (user) {
          const contentToStore = `Document Category: resume\nFile Name: ${file.name}\n\nContent:\n${text}`;
          await addMemory(user.id, contentToStore, { type: 'resume', filename: file.name });
        }
      } catch (memErr) {
        console.error('[Onboarding] Memory indexing failed:', memErr);
      }

      // 4. Parse with AI
      setParseProgress(75);
      setParseStatus('AI is reading your resume...');
      const extractedProfile = await parseResumeToProfile(text);

      setParseProgress(95);
      setParseStatus('Almost done...');
      // Preserve pre-existing name or email if extracted profile missed them
      if (!extractedProfile.personal.firstName && profile.personal.firstName) {
        extractedProfile.personal.firstName = profile.personal.firstName;
      }
      if (!extractedProfile.personal.lastName && profile.personal.lastName) {
        extractedProfile.personal.lastName = profile.personal.lastName;
      }
      if ((!extractedProfile.emails || extractedProfile.emails.length === 0) && profile.emails?.length) {
        extractedProfile.emails = profile.emails;
      }
      setProfile(extractedProfile);

      setParseProgress(100);
      setParseStatus('Profile extracted successfully!');
      await new Promise((r) => setTimeout(r, 800));

      setParsing(false);
      goNext('review');
    } catch (err) {
      console.error('[Onboarding] Resume parsing failed:', err);
      setParsing(false);
      setError(err instanceof Error ? err.message : 'Failed to parse resume. Try again or fill manually.');
      setStep('resume-upload');
    }
  }, []);

  // --- Drag & drop ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) {
      handleResumeFile(e.dataTransfer.files[0]);
    }
  }, [handleResumeFile]);

  // --- Skill input ---
  const [skillInput, setSkillInput] = useState('');
  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !profile.professional.skills.includes(trimmed)) {
      updateProfessional('skills', [...profile.professional.skills, trimmed]);
    }
    setSkillInput('');
  };

  // --- Add education entry ---
  const addEducation = () => {
    setProfile((prev) => ({
      ...prev,
      education: [...prev.education, {
        id: generateId(),
        institution: '',
        degree: '',
        field: '',
        current: false,
      }],
    }));
  };

  const updateEducation = (index: number, key: keyof Education, value: string | boolean) => {
    setProfile((prev) => {
      const updated = [...prev.education];
      updated[index] = { ...updated[index], [key]: value };
      return { ...prev, education: updated };
    });
  };

  const removeEducation = (index: number) => {
    setProfile((prev) => ({
      ...prev,
      education: prev.education.filter((_, i) => i !== index),
    }));
  };

  const updateTwelfth = (key: keyof SchoolEducation, value: string) => {
    setProfile((prev) => {
      const currentSec = prev.secondaryEducation ?? {};
      const currentTwelfth = currentSec.twelfth ?? { institution: '' };
      return {
        ...prev,
        secondaryEducation: {
          ...currentSec,
          twelfth: { ...currentTwelfth, [key]: value },
        },
      };
    });
  };

  const updateTenth = (key: keyof SchoolEducation, value: string) => {
    setProfile((prev) => {
      const currentSec = prev.secondaryEducation ?? {};
      const currentTenth = currentSec.tenth ?? { institution: '' };
      return {
        ...prev,
        secondaryEducation: {
          ...currentSec,
          tenth: { ...currentTenth, [key]: value },
        },
      };
    });
  };

  // --- Add experience entry ---
  const addExperience = () => {
    setProfile((prev) => ({
      ...prev,
      experience: [...prev.experience, {
        id: generateId(),
        company: '',
        title: '',
        current: false,
      }],
    }));
  };

  const updateExperience = (index: number, key: keyof Experience, value: string | boolean) => {
    setProfile((prev) => {
      const updated = [...prev.experience];
      updated[index] = { ...updated[index], [key]: value };
      return { ...prev, experience: updated };
    });
  };

  const removeExperience = (index: number) => {
    setProfile((prev) => ({
      ...prev,
      experience: prev.experience.filter((_, i) => i !== index),
    }));
  };

  // --- Complete onboarding ---
  const handleComplete = () => {
    goNext('complete');
    setTimeout(() => {
      onComplete(profile);
    }, 1500);
  };

  // --- Progress bar ---
  const progressPercent = Math.round(((getStepIndex()) / (getStepCount() - 1)) * 100);

  // ================================================================
  // RENDER
  // ================================================================

  const slideClass = `onboarding-slide ${direction === 'forward' ? 'slide-in-right' : 'slide-in-left'}`;

  return (
    <div className={`onboarding-wizard ${mounted ? 'onboarding-mounted' : ''}`}>
      {/* Background particles */}
      <div className="onboarding-particles">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="onboarding-particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 4}s`,
            }}
          />
        ))}
      </div>

      {/* Progress bar */}
      {step !== 'welcome' && step !== 'complete' && (
        <div className="onboarding-progress-bar">
          <div
            className="onboarding-progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Step content */}
      <div className="onboarding-content">
        {/* ===== WELCOME ===== */}
        {step === 'welcome' && (
          <div className={slideClass} key="welcome">
            <div className="onboarding-hero-badge">
              {/* Concentric aura pulse waves */}
              <div className="hero-badge-pulse hero-badge-pulse-1" />
              <div className="hero-badge-pulse hero-badge-pulse-2" />

              {/* Ambient core bloom */}
              <div className="hero-badge-glow" />

              {/* Cyber glass shield badge */}
              <div className="hero-badge-shield">
                {/* Laser scan line passing periodically */}
                <div className="hero-badge-scanner" />

                {/* Constellation sparkle nodes */}
                <span className="hero-badge-spark spark-top-right" />
                <span className="hero-badge-spark spark-bottom-left" />

                {/* 3D Levitating SVG Logo */}
                <svg
                  className="hero-logo-svg"
                  width="46"
                  height="46"
                  viewBox="0 0 28 28"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="heroCyanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#00e5ff" />
                      <stop offset="100%" stopColor="#00b4d8" />
                    </linearGradient>
                    <linearGradient id="heroAmberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffb703" />
                      <stop offset="100%" stopColor="#ff8500" />
                    </linearGradient>
                  </defs>

                  {/* Top Layer: Levitating Cyan Diamond with high-gloss sheen */}
                  <g className="hero-layer-top">
                    <path
                      d="M14 3.5L3.5 9L14 14.5L24.5 9L14 3.5Z"
                      fill="url(#heroCyanGrad)"
                    />
                    <path
                      d="M14 4.5L5.5 9L14 13.5"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth="0.8"
                      strokeLinecap="round"
                    />
                  </g>

                  {/* Middle Layer: Orange Stack Plate */}
                  <g className="hero-layer-mid">
                    <path
                      d="M4 14L14 19L24 14"
                      stroke="url(#heroAmberGrad)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>

                  {/* Bottom Layer: Base Orange Plate */}
                  <g className="hero-layer-bot">
                    <path
                      d="M4 18.5L14 23.5L24 18.5"
                      stroke="url(#heroAmberGrad)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                </svg>
              </div>
            </div>
            <h1 className="onboarding-title">
              Welcome to <span className="gradient-text">JobFill</span>
            </h1>
            <p className="onboarding-subtitle">
              {profile.personal.firstName
                ? `Hey ${profile.personal.firstName}! Let's set up your profile so we can autofill job applications for you — instantly and accurately.`
                : "Let's set up your profile so we can autofill job applications for you — instantly and accurately."}
            </p>
            <button
              className="onboarding-btn-primary"
              onClick={() => goNext('method')}
            >
              <span className="onboarding-btn-glow" />
              Get Started
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
            <button
              className="onboarding-btn-ghost"
              onClick={onSkip}
            >
              I'll do this later
            </button>
          </div>
        )}

        {/* ===== METHOD SELECTION ===== */}
        {step === 'method' && (
          <div className={slideClass} key="method">
            <h2 className="onboarding-step-title">How would you like to set up?</h2>
            <p className="onboarding-step-subtitle">
              Choose the fastest way to fill your profile
            </p>

            <div className="onboarding-method-cards">
              <button
                className={`onboarding-method-card ${method === 'resume' ? 'selected' : ''}`}
                onClick={() => { setMethod('resume'); goNext('resume-upload'); }}
              >
                <div className="method-card-icon method-card-icon-resume">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                </div>
                <h3 className="method-card-title">Upload Resume</h3>
                <p className="method-card-desc">
                  AI extracts your details automatically from your resume PDF or Word doc
                </p>
                <span className="method-card-badge">⚡ Recommended</span>
              </button>

              <button
                className={`onboarding-method-card ${method === 'manual' ? 'selected' : ''}`}
                onClick={() => { setMethod('manual'); goNext('manual-personal'); }}
              >
                <div className="method-card-icon method-card-icon-manual">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </div>
                <h3 className="method-card-title">Fill Manually</h3>
                <p className="method-card-desc">
                  Step-by-step guided form with smart suggestions and autosave
                </p>
                <span className="method-card-badge method-card-badge-alt">✍️ Full Control</span>
              </button>
            </div>

            <button
              className="onboarding-btn-back"
              onClick={() => goBack('welcome')}
            >
              ← Back
            </button>
          </div>
        )}

        {/* ===== RESUME UPLOAD ===== */}
        {step === 'resume-upload' && (
          <div className={slideClass} key="resume-upload">
            <h2 className="onboarding-step-title">Upload your Resume</h2>
            <p className="onboarding-step-subtitle">
              Drop your PDF or Word file and our AI will do the rest
            </p>

            <div
              className={`onboarding-drop-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className="drop-zone-text">
                <strong>Drag & drop</strong> your resume here
              </p>
              <p className="drop-zone-hint">or click to browse • PDF, DOC, DOCX</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleResumeFile(e.target.files[0]);
                }}
              />
            </div>

            {error && (
              <div className="onboarding-error">{error}</div>
            )}

            <div className="onboarding-actions">
              <button
                className="onboarding-btn-back"
                onClick={() => goBack('method')}
              >
                ← Back
              </button>
              <button
                className="onboarding-btn-ghost"
                onClick={() => { setMethod('manual'); goNext('manual-personal'); }}
              >
                Fill manually instead
              </button>
            </div>
          </div>
        )}

        {/* ===== RESUME PARSING ===== */}
        {step === 'resume-parsing' && (
          <div className={slideClass} key="resume-parsing">
            <div className="onboarding-parsing-animation">
              <div className="parsing-ring parsing-ring-outer" />
              <div className="parsing-ring parsing-ring-middle" />
              <div className="parsing-ring parsing-ring-inner" />
              <div className="parsing-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-pc-accent-start)" strokeWidth="1.5">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round"/>
                  <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>

            <h2 className="onboarding-step-title" style={{ marginTop: 24 }}>
              Parsing your Resume...
            </h2>
            <p className="onboarding-parsing-status">{parseStatus}</p>

            <div className="onboarding-parse-progress">
              <div
                className="onboarding-parse-progress-fill"
                style={{ width: `${parseProgress}%` }}
              />
            </div>
            <p className="onboarding-parse-percent">{parseProgress}%</p>
          </div>
        )}

        {/* ===== MANUAL: PERSONAL ===== */}
        {step === 'manual-personal' && (
          <div className={slideClass} key="manual-personal">
            <div className="onboarding-step-header">
              <span className="onboarding-step-badge">👤</span>
              <h2 className="onboarding-step-title">Personal Details</h2>
              <p className="onboarding-step-subtitle">Let's start with the basics</p>
            </div>

            <div className="onboarding-form">
              <div className="onboarding-form-row">
                <div className="onboarding-form-group">
                  <label className="onboarding-label">First Name *</label>
                  <input
                    className="onboarding-input"
                    type="text"
                    placeholder="Aditya"
                    value={profile.personal.firstName}
                    onChange={(e) => updatePersonal('firstName', e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Last Name *</label>
                  <input
                    className="onboarding-input"
                    type="text"
                    placeholder="Sharma"
                    value={profile.personal.lastName}
                    onChange={(e) => updatePersonal('lastName', e.target.value)}
                  />
                </div>
              </div>

              <div className="onboarding-form-row">
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Middle Name</label>
                  <input
                    className="onboarding-input"
                    type="text"
                    placeholder="Optional"
                    value={profile.personal.middleName || ''}
                    onChange={(e) => updatePersonal('middleName', e.target.value)}
                  />
                </div>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Date of Birth</label>
                  <input
                    className="onboarding-input"
                    type="date"
                    value={profile.personal.dateOfBirth || ''}
                    onChange={(e) => updatePersonal('dateOfBirth', e.target.value)}
                  />
                </div>
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">Gender</label>
                <div className="onboarding-gender-options">
                  {GENDER_OPTIONS.map((g) => (
                    <button
                      key={g}
                      className={`onboarding-gender-btn ${profile.personal.gender === g ? 'selected' : ''}`}
                      onClick={() => updatePersonal('gender', g)}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && <div className="onboarding-error">{error}</div>}

            <div className="onboarding-actions">
              <button className="onboarding-btn-back" onClick={() => goBack('method')}>
                ← Back
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={() => {
                  if (!profile.personal.firstName.trim() || !profile.personal.lastName.trim()) {
                    setError('Please enter your first and last name');
                    return;
                  }
                  goNext('manual-contact');
                }}
              >
                <span className="onboarding-btn-glow" />
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ===== MANUAL: CONTACT ===== */}
        {step === 'manual-contact' && (
          <div className={slideClass} key="manual-contact">
            <div className="onboarding-step-header">
              <span className="onboarding-step-badge">📱</span>
              <h2 className="onboarding-step-title">Contact Info</h2>
              <p className="onboarding-step-subtitle">How can employers reach you?</p>
            </div>

            <div className="onboarding-form">
              <div className="onboarding-form-group">
                <label className="onboarding-label">Primary Email *</label>
                <input
                  className="onboarding-input"
                  type="email"
                  placeholder="you@example.com"
                  value={profile.emails[0]?.value || ''}
                  onChange={(e) => {
                    setProfile((prev) => ({
                      ...prev,
                      emails: [{
                        id: prev.emails[0]?.id || generateId(),
                        value: e.target.value,
                        label: 'Personal',
                        primary: true,
                      }, ...prev.emails.slice(1)],
                    }));
                  }}
                  autoFocus
                />
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">Phone Number *</label>
                <input
                  className="onboarding-input"
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={profile.phones[0]?.value || ''}
                  onChange={(e) => {
                    setProfile((prev) => ({
                      ...prev,
                      phones: [{
                        id: prev.phones[0]?.id || generateId(),
                        value: e.target.value,
                        label: 'Personal',
                        primary: true,
                      }, ...prev.phones.slice(1)],
                    }));
                  }}
                />
              </div>

              <div className="onboarding-form-row">
                <div className="onboarding-form-group">
                  <label className="onboarding-label">City</label>
                  <input
                    className="onboarding-input"
                    type="text"
                    placeholder="Vellore"
                    value={profile.addresses[0]?.city || ''}
                    onChange={(e) => {
                      setProfile((prev) => ({
                        ...prev,
                        addresses: [{
                          id: prev.addresses[0]?.id || generateId(),
                          label: 'Current',
                          primary: true,
                          line1: prev.addresses[0]?.line1 || '',
                          line2: prev.addresses[0]?.line2 || '',
                          city: e.target.value,
                          state: prev.addresses[0]?.state || '',
                          postalCode: prev.addresses[0]?.postalCode || '',
                          country: prev.addresses[0]?.country || '',
                        }, ...prev.addresses.slice(1)],
                      }));
                    }}
                  />
                </div>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Country</label>
                  <input
                    className="onboarding-input"
                    type="text"
                    placeholder="India"
                    value={profile.addresses[0]?.country || ''}
                    onChange={(e) => {
                      setProfile((prev) => ({
                        ...prev,
                        addresses: [{
                          ...prev.addresses[0] || {
                            id: generateId(),
                            label: 'Current' as const,
                            primary: true,
                            line1: '',
                            line2: '',
                            city: '',
                            state: '',
                            postalCode: '',
                          },
                          country: e.target.value,
                        }, ...prev.addresses.slice(1)],
                      }));
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-btn-back" onClick={() => goBack('manual-personal')}>
                ← Back
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={() => {
                  if (!profile.emails[0]?.value.trim()) {
                    setError('Please enter your email address');
                    return;
                  }
                  if (profile.education.length === 0) {
                    addEducation();
                  }
                  goNext('manual-education');
                }}
              >
                <span className="onboarding-btn-glow" />
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ===== MANUAL: EDUCATION ===== */}
        {step === 'manual-education' && (
          <div className={slideClass} key="manual-education">
            <div className="onboarding-step-header">
              <span className="onboarding-step-badge">🎓</span>
              <h2 className="onboarding-step-title">Education</h2>
              <p className="onboarding-step-subtitle">Your academic background</p>
            </div>

            <div className="onboarding-form onboarding-form-scrollable">
              {profile.education.map((edu, index) => (
                <div key={edu.id} className="onboarding-entry-card">
                  <div className="onboarding-entry-header">
                    <span className="onboarding-entry-number">{index + 1}</span>
                    <button
                      className="onboarding-entry-remove"
                      onClick={() => removeEducation(index)}
                      title="Remove"
                    >✕</button>
                  </div>
                  <div className="onboarding-form-row">
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Institution</label>
                      <input
                        className="onboarding-input"
                        placeholder="VIT University"
                        value={edu.institution}
                        onChange={(e) => updateEducation(index, 'institution', e.target.value)}
                      />
                    </div>
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Reg. No.</label>
                      <input
                        className="onboarding-input"
                        placeholder="22BCE7451"
                        value={edu.registrationNo || ''}
                        onChange={(e) => updateEducation(index, 'registrationNo', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="onboarding-form-row">
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Degree</label>
                      <input
                        className="onboarding-input"
                        placeholder="B.Tech"
                        value={edu.degree}
                        onChange={(e) => updateEducation(index, 'degree', e.target.value)}
                      />
                    </div>
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Field of Study</label>
                      <input
                        className="onboarding-input"
                        placeholder="Computer Science"
                        value={edu.field}
                        onChange={(e) => updateEducation(index, 'field', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="onboarding-form-row">
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Start Date</label>
                      <input
                        className="onboarding-input"
                        type="date"
                        value={edu.startDate || ''}
                        onChange={(e) => updateEducation(index, 'startDate', e.target.value)}
                      />
                    </div>
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">End Date</label>
                      <input
                        className="onboarding-input"
                        type="date"
                        value={edu.endDate || ''}
                        disabled={edu.current}
                        onChange={(e) => updateEducation(index, 'endDate', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="onboarding-form-row">
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">GPA / Percentage</label>
                      <input
                        className="onboarding-input"
                        placeholder="8.9"
                        value={edu.gpa || ''}
                        onChange={(e) => updateEducation(index, 'gpa', e.target.value)}
                      />
                    </div>
                    <div className="onboarding-form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
                      <label className="onboarding-checkbox-label">
                        <input
                          type="checkbox"
                          checked={edu.current}
                          onChange={(e) => updateEducation(index, 'current', e.target.checked)}
                          className="onboarding-checkbox"
                        />
                        <span className="onboarding-checkbox-custom" />
                        Currently studying
                      </label>
                    </div>
                  </div>
                </div>
              ))}

              <button className="onboarding-add-btn" onClick={addEducation}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Education
              </button>

              {/* Secondary Education: Class 12th / PU / Junior College */}
              <div className="onboarding-entry-card" style={{ marginTop: '12px', borderLeft: '3px solid var(--color-pc-accent-start)' }}>
                <div className="onboarding-entry-header">
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-pc-accent-start)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
                    Class 12th / PU / Junior College
                  </span>
                </div>
                <div className="onboarding-form-row">
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">PU / College / School Name</label>
                    <input
                      className="onboarding-input"
                      placeholder="e.g. Sri Chaitanya / Narayana / DPS"
                      value={profile.secondaryEducation?.twelfth?.institution || ''}
                      onChange={(e) => updateTwelfth('institution', e.target.value)}
                    />
                  </div>
                </div>
                <div className="onboarding-form-row">
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Percentage / GPA</label>
                    <input
                      className="onboarding-input"
                      placeholder="e.g. 92% or 9.2"
                      value={profile.secondaryEducation?.twelfth?.percentage || ''}
                      onChange={(e) => updateTwelfth('percentage', e.target.value)}
                    />
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Passing Year</label>
                    <input
                      className="onboarding-input"
                      placeholder="e.g. 2022"
                      value={profile.secondaryEducation?.twelfth?.year || ''}
                      onChange={(e) => updateTwelfth('year', e.target.value)}
                    />
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Board / Stream</label>
                    <input
                      className="onboarding-input"
                      placeholder="CBSE / State"
                      value={profile.secondaryEducation?.twelfth?.board || ''}
                      onChange={(e) => updateTwelfth('board', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Secondary Education: Class 10th / High School */}
              <div className="onboarding-entry-card" style={{ marginTop: '10px', borderLeft: '3px solid var(--color-pc-accent-mid)' }}>
                <div className="onboarding-entry-header">
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-pc-accent-mid)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>
                    Class 10th / High School
                  </span>
                </div>
                <div className="onboarding-form-row">
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">School Name</label>
                    <input
                      className="onboarding-input"
                      placeholder="e.g. Kendriya Vidyalaya / St. Joseph's"
                      value={profile.secondaryEducation?.tenth?.institution || ''}
                      onChange={(e) => updateTenth('institution', e.target.value)}
                    />
                  </div>
                </div>
                <div className="onboarding-form-row">
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Percentage / GPA</label>
                    <input
                      className="onboarding-input"
                      placeholder="e.g. 90% or 9.0"
                      value={profile.secondaryEducation?.tenth?.percentage || ''}
                      onChange={(e) => updateTenth('percentage', e.target.value)}
                    />
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Passing Year</label>
                    <input
                      className="onboarding-input"
                      placeholder="e.g. 2020"
                      value={profile.secondaryEducation?.tenth?.year || ''}
                      onChange={(e) => updateTenth('year', e.target.value)}
                    />
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Board</label>
                    <input
                      className="onboarding-input"
                      placeholder="CBSE / State"
                      value={profile.secondaryEducation?.tenth?.board || ''}
                      onChange={(e) => updateTenth('board', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-btn-back" onClick={() => goBack('manual-contact')}>
                ← Back
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={() => goNext('manual-experience')}
              >
                <span className="onboarding-btn-glow" />
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ===== MANUAL: EXPERIENCE ===== */}
        {step === 'manual-experience' && (
          <div className={slideClass} key="manual-experience">
            <div className="onboarding-step-header">
              <span className="onboarding-step-badge">💼</span>
              <h2 className="onboarding-step-title">Experience</h2>
              <p className="onboarding-step-subtitle">Work, internships, freelance — add it all</p>
            </div>

            <div className="onboarding-form onboarding-form-scrollable">
              {profile.experience.map((exp, index) => (
                <div key={exp.id} className="onboarding-entry-card">
                  <div className="onboarding-entry-header">
                    <span className="onboarding-entry-number">{index + 1}</span>
                    <button
                      className="onboarding-entry-remove"
                      onClick={() => removeExperience(index)}
                      title="Remove"
                    >✕</button>
                  </div>
                  <div className="onboarding-form-row">
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Company</label>
                      <input
                        className="onboarding-input"
                        placeholder="Google"
                        value={exp.company}
                        onChange={(e) => updateExperience(index, 'company', e.target.value)}
                      />
                    </div>
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Job Title</label>
                      <input
                        className="onboarding-input"
                        placeholder="SWE Intern"
                        value={exp.title}
                        onChange={(e) => updateExperience(index, 'title', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Location</label>
                    <input
                      className="onboarding-input"
                      placeholder="Bangalore, India"
                      value={exp.location || ''}
                      onChange={(e) => updateExperience(index, 'location', e.target.value)}
                    />
                  </div>
                  <div className="onboarding-form-row">
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Start Date</label>
                      <input
                        className="onboarding-input"
                        type="date"
                        value={exp.startDate || ''}
                        onChange={(e) => updateExperience(index, 'startDate', e.target.value)}
                      />
                    </div>
                    <div className="onboarding-form-group">
                      <label className="onboarding-label">End Date</label>
                      <input
                        className="onboarding-input"
                        type="date"
                        value={exp.endDate || ''}
                        disabled={exp.current}
                        onChange={(e) => updateExperience(index, 'endDate', e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="onboarding-checkbox-label" style={{ marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={exp.current}
                      onChange={(e) => updateExperience(index, 'current', e.target.checked)}
                      className="onboarding-checkbox"
                    />
                    <span className="onboarding-checkbox-custom" />
                    Currently working here
                  </label>
                  <div className="onboarding-form-group" style={{ marginTop: 8 }}>
                    <label className="onboarding-label">Description</label>
                    <textarea
                      className="onboarding-input onboarding-textarea"
                      placeholder="What did you do? Key achievements..."
                      value={exp.description || ''}
                      onChange={(e) => updateExperience(index, 'description', e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              ))}

              <button className="onboarding-add-btn" onClick={addExperience}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Experience
              </button>

              <p className="onboarding-hint">
                💡 No experience yet? That's okay — skip this step!
              </p>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-btn-back" onClick={() => goBack('manual-education')}>
                ← Back
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={() => goNext('manual-professional')}
              >
                <span className="onboarding-btn-glow" />
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ===== MANUAL: PROFESSIONAL ===== */}
        {step === 'manual-professional' && (
          <div className={slideClass} key="manual-professional">
            <div className="onboarding-step-header">
              <span className="onboarding-step-badge">🔗</span>
              <h2 className="onboarding-step-title">Professional Links & Skills</h2>
              <p className="onboarding-step-subtitle">Show off your work and expertise</p>
            </div>

            <div className="onboarding-form">
              <div className="onboarding-form-group">
                <label className="onboarding-label">LinkedIn</label>
                <input
                  className="onboarding-input"
                  type="url"
                  placeholder="https://linkedin.com/in/yourname"
                  value={profile.professional.linkedin || ''}
                  onChange={(e) => updateProfessional('linkedin', e.target.value)}
                />
              </div>
              <div className="onboarding-form-row">
                <div className="onboarding-form-group">
                  <label className="onboarding-label">GitHub</label>
                  <input
                    className="onboarding-input"
                    type="url"
                    placeholder="https://github.com/you"
                    value={profile.professional.github || ''}
                    onChange={(e) => updateProfessional('github', e.target.value)}
                  />
                </div>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Portfolio</label>
                  <input
                    className="onboarding-input"
                    type="url"
                    placeholder="https://your-site.dev"
                    value={profile.professional.portfolio || ''}
                    onChange={(e) => updateProfessional('portfolio', e.target.value)}
                  />
                </div>
              </div>

              <div className="onboarding-form-group">
                <label className="onboarding-label">Skills</label>
                <div className="onboarding-skill-input-row">
                  <input
                    className="onboarding-input"
                    type="text"
                    placeholder="Type a skill & press Enter"
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
                    }}
                  />
                  <button className="onboarding-skill-add-btn" onClick={addSkill}>+</button>
                </div>
                {profile.professional.skills.length > 0 && (
                  <div className="onboarding-skill-tags">
                    {profile.professional.skills.map((skill) => (
                      <span key={skill} className="onboarding-skill-tag">
                        {skill}
                        <button
                          className="onboarding-skill-remove"
                          onClick={() => updateProfessional('skills', profile.professional.skills.filter((s) => s !== skill))}
                        >✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="onboarding-actions">
              <button className="onboarding-btn-back" onClick={() => goBack('manual-experience')}>
                ← Back
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={() => goNext('review')}
              >
                <span className="onboarding-btn-glow" />
                Review Profile →
              </button>
            </div>
          </div>
        )}

        {/* ===== REVIEW ===== */}
        {step === 'review' && (
          <div className={slideClass} key="review">
            <div className="onboarding-step-header">
              <span className="onboarding-step-badge">✅</span>
              <h2 className="onboarding-step-title">Review Your Profile</h2>
              <p className="onboarding-step-subtitle">
                {method === 'resume' ? 'Extracted from your resume — edit anything below' : 'Here\'s what you entered'}
              </p>
            </div>

            <div className="onboarding-review-scroll">
              {/* Personal */}
              <div className="onboarding-review-section">
                <h3 className="onboarding-review-heading">👤 Personal</h3>
                <div className="onboarding-review-grid">
                  <ReviewField label="Name" value={`${profile.personal.firstName} ${profile.personal.middleName || ''} ${profile.personal.lastName}`.replace(/\s+/g, ' ').trim()} />
                  <ReviewField label="Gender" value={profile.personal.gender} />
                  <ReviewField label="DOB" value={profile.personal.dateOfBirth} />
                </div>
              </div>

              {/* Contact */}
              <div className="onboarding-review-section">
                <h3 className="onboarding-review-heading">📱 Contact</h3>
                <div className="onboarding-review-grid">
                  <ReviewField label="Email" value={profile.emails[0]?.value} />
                  <ReviewField label="Phone" value={profile.phones[0]?.value} />
                  {profile.addresses[0] && (
                    <ReviewField label="Location" value={[profile.addresses[0].city, profile.addresses[0].state, profile.addresses[0].country].filter(Boolean).join(', ')} />
                  )}
                </div>
              </div>

              {/* Education */}
              {(profile.education.length > 0 || profile.secondaryEducation?.twelfth?.institution || profile.secondaryEducation?.tenth?.institution) && (
                <div className="onboarding-review-section">
                  <h3 className="onboarding-review-heading">🎓 Education</h3>
                  {profile.education.map((edu, i) => (
                    <div key={i} className="onboarding-review-card">
                      <strong>{edu.degree} {edu.field && `in ${edu.field}`}</strong>
                      {edu.institution && <span className="onboarding-review-sub"> — {edu.institution}</span>}
                      {edu.current && <span className="onboarding-review-badge">Currently Studying</span>}
                      {edu.gpa && <span className="onboarding-review-detail">GPA: {edu.gpa}</span>}
                    </div>
                  ))}
                  {profile.secondaryEducation?.twelfth?.institution && (
                    <div className="onboarding-review-card">
                      <strong>Class 12th / PUC</strong>
                      <span className="onboarding-review-sub"> — {profile.secondaryEducation.twelfth.institution}</span>
                      {profile.secondaryEducation.twelfth.percentage && <span className="onboarding-review-detail">Score: {profile.secondaryEducation.twelfth.percentage}</span>}
                      {profile.secondaryEducation.twelfth.year && <span className="onboarding-review-detail">Year: {profile.secondaryEducation.twelfth.year}</span>}
                    </div>
                  )}
                  {profile.secondaryEducation?.tenth?.institution && (
                    <div className="onboarding-review-card">
                      <strong>Class 10th / School</strong>
                      <span className="onboarding-review-sub"> — {profile.secondaryEducation.tenth.institution}</span>
                      {profile.secondaryEducation.tenth.percentage && <span className="onboarding-review-detail">Score: {profile.secondaryEducation.tenth.percentage}</span>}
                      {profile.secondaryEducation.tenth.year && <span className="onboarding-review-detail">Year: {profile.secondaryEducation.tenth.year}</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Experience */}
              {profile.experience.length > 0 && (
                <div className="onboarding-review-section">
                  <h3 className="onboarding-review-heading">💼 Experience</h3>
                  {profile.experience.map((exp, i) => (
                    <div key={i} className="onboarding-review-card">
                      <strong>{exp.title}</strong>
                      {exp.company && <span className="onboarding-review-sub"> at {exp.company}</span>}
                      {exp.current && <span className="onboarding-review-badge">Current</span>}
                      {exp.location && <span className="onboarding-review-detail">{exp.location}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Skills */}
              {profile.professional.skills.length > 0 && (
                <div className="onboarding-review-section">
                  <h3 className="onboarding-review-heading">🛠️ Skills</h3>
                  <div className="onboarding-skill-tags">
                    {profile.professional.skills.map((skill) => (
                      <span key={skill} className="onboarding-skill-tag">{skill}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              {(profile.professional.linkedin || profile.professional.github || profile.professional.portfolio) && (
                <div className="onboarding-review-section">
                  <h3 className="onboarding-review-heading">🔗 Links</h3>
                  <div className="onboarding-review-grid">
                    <ReviewField label="LinkedIn" value={profile.professional.linkedin} />
                    <ReviewField label="GitHub" value={profile.professional.github} />
                    <ReviewField label="Portfolio" value={profile.professional.portfolio} />
                  </div>
                </div>
              )}
            </div>

            <p className="onboarding-hint" style={{ marginTop: 8 }}>
              💡 You can always edit these details later in the Details tab
            </p>

            <div className="onboarding-actions">
              <button
                className="onboarding-btn-back"
                onClick={() => goBack(method === 'resume' ? 'resume-upload' : 'manual-professional')}
              >
                ← Back
              </button>
              <button
                className="onboarding-btn-primary onboarding-btn-complete"
                onClick={handleComplete}
              >
                <span className="onboarding-btn-glow" />
                🚀 Save & Start Using JobFill
              </button>
            </div>
          </div>
        )}

        {/* ===== COMPLETE ===== */}
        {step === 'complete' && (
          <div className={slideClass} key="complete">
            <div className="onboarding-complete-animation">
              <div className="complete-ring" />
              <div className="complete-check">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-pc-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
            </div>
            <h2 className="onboarding-step-title" style={{ marginTop: 24 }}>You're all set! 🎉</h2>
            <p className="onboarding-step-subtitle">
              Your profile is saved. JobFill will now autofill forms for you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Small helper component ---
function ReviewField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="onboarding-review-field">
      <span className="onboarding-review-label">{label}</span>
      <span className="onboarding-review-value">{value}</span>
    </div>
  );
}
