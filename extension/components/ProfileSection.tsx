import { useState, useCallback } from 'react';
import type {
  UserProfile,
  PhoneNumber,
  EmailAddress,
  Address,
  Education,
  Experience,
} from '../types/profile';
import ProfileCard from './ProfileCard';
import ArrayField from './ArrayField';
import CopyButton from './CopyButton';

interface ProfileSectionProps {
  profile: UserProfile;
  onSave: (profile: UserProfile) => void;
}

export default function ProfileSection({ profile, onSave }: ProfileSectionProps) {
  // ---- Helpers ----
  const update = useCallback(
    <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
      onSave({ ...profile, [key]: value });
    },
    [profile, onSave],
  );

  const summaryText = (items: { primary?: boolean; value?: string; label?: string }[]) => {
    const primary = items.find((i) => i.primary) ?? items[0];
    if (!primary) return 'Not set';
    return primary.value ?? primary.label ?? 'Set';
  };

  const fullName = `${profile.personal.firstName} ${profile.personal.lastName}`.trim();

  // ---- Personal ----
  const personalSubtitle =
    profile.personal.firstName || profile.personal.lastName
      ? fullName
      : 'Not set';

  // ---- Skills state ----
  const [skillInput, setSkillInput] = useState('');

  const addSkill = () => {
    const trimmed = skillInput.trim();
    if (trimmed && !profile.professional.skills.includes(trimmed)) {
      update('professional', {
        ...profile.professional,
        skills: [...profile.professional.skills, trimmed],
      });
    }
    setSkillInput('');
  };

  const removeSkill = (skill: string) => {
    update('professional', {
      ...profile.professional,
      skills: profile.professional.skills.filter((s) => s !== skill),
    });
  };

  // ---- Address formatter ----
  const formatAddress = (addr: Address) => {
    return [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country]
      .filter(Boolean)
      .join(', ');
  };

  return (
    <div>
      {/* ===== PERSONAL ===== */}
      <ProfileCard
        icon="👤"
        iconClass="personal"
        title="Personal"
        subtitle={personalSubtitle}
        defaultOpen={!profile.personal.firstName}
        staggerIndex={0}
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">
              First Name
              <CopyButton value={profile.personal.firstName} label="first name" />
            </label>
            <input
              id="profile-first-name"
              className="form-input"
              type="text"
              placeholder="Adithya"
              value={profile.personal.firstName}
              onChange={(e) =>
                update('personal', { ...profile.personal, firstName: e.target.value })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Last Name
              <CopyButton value={profile.personal.lastName} label="last name" />
            </label>
            <input
              id="profile-last-name"
              className="form-input"
              type="text"
              placeholder="T.S."
              value={profile.personal.lastName}
              onChange={(e) =>
                update('personal', { ...profile.personal, lastName: e.target.value })
              }
            />
          </div>
        </div>
        {fullName && (
          <div className="copy-full-name">
            <span className="copy-full-name-label">Full Name</span>
            <span className="copy-full-name-value">{fullName}</span>
            <CopyButton value={fullName} label="full name" />
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Middle Name</label>
            <input
              id="profile-middle-name"
              className="form-input"
              type="text"
              placeholder="Optional"
              value={profile.personal.middleName ?? ''}
              onChange={(e) =>
                update('personal', { ...profile.personal, middleName: e.target.value })
              }
            />
          </div>
          <div className="form-group">
            <label className="form-label">Date of Birth</label>
            <input
              id="profile-dob"
              className="form-input"
              type="date"
              value={profile.personal.dateOfBirth ?? ''}
              onChange={(e) =>
                update('personal', { ...profile.personal, dateOfBirth: e.target.value })
              }
            />
          </div>
        </div>
      </ProfileCard>

      {/* ===== PHONES ===== */}
      <ProfileCard
        icon="📱"
        iconClass="contact"
        title="Phone Numbers"
        subtitle={summaryText(profile.phones)}
        staggerIndex={1}
      >
        <ArrayField<PhoneNumber>
          items={profile.phones}
          onChange={(phones) => update('phones', phones)}
          showPrimary
          addLabel="Add Phone"
          emptyLabel="No phone numbers added"
          copyValue={(item) => item.value}
          createDefault={() => ({
            value: '',
            label: 'Personal' as const,
            primary: false,
          })}
          renderItem={(item) => (
            <div className="array-item-value">{item.value}</div>
          )}
          renderForm={(draft, setDraft) => (
            <div>
              <div className="form-group">
                <label className="form-label">Phone Number</label>
                <input
                  className="form-input"
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  value={(draft as Partial<PhoneNumber>).value ?? ''}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Label</label>
                <select
                  className="form-select"
                  value={(draft as Partial<PhoneNumber>).label ?? 'Personal'}
                  onChange={(e) =>
                    setDraft({ ...draft, label: e.target.value as PhoneNumber['label'] })
                  }
                >
                  <option value="Personal">Personal</option>
                  <option value="Work">Work</option>
                  <option value="Home">Home</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          )}
        />
      </ProfileCard>

      {/* ===== EMAILS ===== */}
      <ProfileCard
        icon="✉️"
        iconClass="contact"
        title="Email Addresses"
        subtitle={summaryText(profile.emails)}
        staggerIndex={2}
      >
        <ArrayField<EmailAddress>
          items={profile.emails}
          onChange={(emails) => update('emails', emails)}
          showPrimary
          addLabel="Add Email"
          emptyLabel="No email addresses added"
          copyValue={(item) => item.value}
          createDefault={() => ({
            value: '',
            label: 'Personal' as const,
            primary: false,
          })}
          renderItem={(item) => (
            <div className="array-item-value">{item.value}</div>
          )}
          renderForm={(draft, setDraft) => (
            <div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="user@example.com"
                  value={(draft as Partial<EmailAddress>).value ?? ''}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Label</label>
                <select
                  className="form-select"
                  value={(draft as Partial<EmailAddress>).label ?? 'Personal'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      label: e.target.value as EmailAddress['label'],
                    })
                  }
                >
                  <option value="Personal">Personal</option>
                  <option value="Work">Work</option>
                  <option value="University">University</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          )}
        />
      </ProfileCard>

      {/* ===== ADDRESSES ===== */}
      <ProfileCard
        icon="🏠"
        iconClass="address"
        title="Addresses"
        subtitle={
          profile.addresses.length > 0
            ? `${profile.addresses[0].city}, ${profile.addresses[0].state}`
            : 'Not set'
        }
        staggerIndex={3}
      >
        <ArrayField<Address>
          items={profile.addresses}
          onChange={(addresses) => update('addresses', addresses)}
          showPrimary
          addLabel="Add Address"
          emptyLabel="No addresses added"
          copyValue={(item) => formatAddress(item)}
          createDefault={() => ({
            label: 'Current' as const,
            primary: false,
            line1: '',
            city: '',
            state: '',
            postalCode: '',
            country: '',
          })}
          renderItem={(item) => (
            <div className="array-item-value">
              {item.line1}, {item.city}
            </div>
          )}
          renderForm={(draft, setDraft) => {
            const d = draft as Partial<Address>;
            return (
              <div>
                <div className="form-group">
                  <label className="form-label">Address Line 1</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Street address"
                    value={d.line1 ?? ''}
                    onChange={(e) => setDraft({ ...draft, line1: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Address Line 2</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Apt, suite, etc. (optional)"
                    value={d.line2 ?? ''}
                    onChange={(e) => setDraft({ ...draft, line2: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">City</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="City"
                      value={d.city ?? ''}
                      onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">State</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="State"
                      value={d.state ?? ''}
                      onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Postal Code</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="PIN Code"
                      value={d.postalCode ?? ''}
                      onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Country</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="India"
                      value={d.country ?? ''}
                      onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Label</label>
                  <select
                    className="form-select"
                    value={d.label ?? 'Current'}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        label: e.target.value as Address['label'],
                      })
                    }
                  >
                    <option value="Current">Current</option>
                    <option value="Permanent">Permanent</option>
                    <option value="Work">Work</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            );
          }}
        />
      </ProfileCard>

      {/* ===== EDUCATION ===== */}
      <ProfileCard
        icon="🎓"
        iconClass="education"
        title="Education"
        subtitle={
          profile.education.length > 0
            ? `${profile.education[0].degree} — ${profile.education[0].institution}`
            : 'Not set'
        }
        staggerIndex={4}
      >
        <ArrayField<Education>
          items={profile.education}
          onChange={(education) => update('education', education)}
          addLabel="Add Education"
          emptyLabel="No education added"
          createDefault={() => ({
            institution: '',
            degree: '',
            field: '',
            current: false,
          })}
          renderItem={(item) => (
            <div>
              <div className="array-item-value">{item.degree}</div>
              <div className="array-item-label">{item.institution} • {item.field}</div>
            </div>
          )}
          renderForm={(draft, setDraft) => {
            const d = draft as Partial<Education>;
            return (
              <div>
                <div className="form-group">
                  <label className="form-label">Institution</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="University / College name"
                    value={d.institution ?? ''}
                    onChange={(e) => setDraft({ ...draft, institution: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Degree</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="B.Tech, M.Sc, etc."
                      value={d.degree ?? ''}
                      onChange={(e) => setDraft({ ...draft, degree: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Field of Study</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="Computer Science"
                      value={d.field ?? ''}
                      onChange={(e) => setDraft({ ...draft, field: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Start Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={d.startDate ?? ''}
                      onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={d.endDate ?? ''}
                      disabled={d.current}
                      onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">GPA / Percentage</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="8.5 / 85%"
                      value={d.gpa ?? ''}
                      onChange={(e) => setDraft({ ...draft, gpa: e.target.value })}
                    />
                  </div>
                  <div className="checkbox-group" style={{ marginTop: '22px' }}>
                    <input
                      type="checkbox"
                      id="edu-current"
                      checked={d.current ?? false}
                      onChange={(e) => setDraft({ ...draft, current: e.target.checked })}
                    />
                    <label htmlFor="edu-current">Currently studying</label>
                  </div>
                </div>
              </div>
            );
          }}
        />
      </ProfileCard>

      {/* ===== EXPERIENCE ===== */}
      <ProfileCard
        icon="💼"
        iconClass="experience"
        title="Work Experience"
        subtitle={
          profile.experience.length > 0
            ? `${profile.experience[0].title} at ${profile.experience[0].company}`
            : 'Not set'
        }
        staggerIndex={5}
      >
        <ArrayField<Experience>
          items={profile.experience}
          onChange={(experience) => update('experience', experience)}
          addLabel="Add Experience"
          emptyLabel="No work experience added"
          createDefault={() => ({
            company: '',
            title: '',
            current: false,
          })}
          renderItem={(item) => (
            <div>
              <div className="array-item-value">{item.title}</div>
              <div className="array-item-label">{item.company}</div>
            </div>
          )}
          renderForm={(draft, setDraft) => {
            const d = draft as Partial<Experience>;
            return (
              <div>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Company name"
                    value={d.company ?? ''}
                    onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Job Title</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="Software Engineer"
                      value={d.title ?? ''}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location</label>
                    <input
                      className="form-input"
                      type="text"
                      placeholder="City, Country"
                      value={d.location ?? ''}
                      onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Start Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={d.startDate ?? ''}
                      onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={d.endDate ?? ''}
                      disabled={d.current}
                      onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="checkbox-group">
                  <input
                    type="checkbox"
                    id="exp-current"
                    checked={d.current ?? false}
                    onChange={(e) => setDraft({ ...draft, current: e.target.checked })}
                  />
                  <label htmlFor="exp-current">Currently working here</label>
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Describe your responsibilities..."
                    value={d.description ?? ''}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    style={{ resize: 'vertical', minHeight: '60px' }}
                  />
                </div>
              </div>
            );
          }}
        />
      </ProfileCard>

      {/* ===== PROFESSIONAL ===== */}
      <ProfileCard
        icon="🔗"
        iconClass="professional"
        title="Professional"
        subtitle={
          profile.professional.linkedin || profile.professional.github
            ? [profile.professional.linkedin ? 'LinkedIn' : '', profile.professional.github ? 'GitHub' : '']
                .filter(Boolean)
                .join(' • ')
            : 'Not set'
        }
        staggerIndex={6}
      >
        <div className="form-group">
          <label className="form-label">
            LinkedIn
            <CopyButton value={profile.professional.linkedin ?? ''} label="LinkedIn URL" />
          </label>
          <input
            id="profile-linkedin"
            className="form-input"
            type="url"
            placeholder="https://linkedin.com/in/username"
            value={profile.professional.linkedin ?? ''}
            onChange={(e) =>
              update('professional', {
                ...profile.professional,
                linkedin: e.target.value,
              })
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            GitHub
            <CopyButton value={profile.professional.github ?? ''} label="GitHub URL" />
          </label>
          <input
            id="profile-github"
            className="form-input"
            type="url"
            placeholder="https://github.com/username"
            value={profile.professional.github ?? ''}
            onChange={(e) =>
              update('professional', {
                ...profile.professional,
                github: e.target.value,
              })
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">
            Portfolio / Website
            <CopyButton value={profile.professional.portfolio ?? ''} label="portfolio URL" />
          </label>
          <input
            id="profile-portfolio"
            className="form-input"
            type="url"
            placeholder="https://yoursite.com"
            value={profile.professional.portfolio ?? ''}
            onChange={(e) =>
              update('professional', {
                ...profile.professional,
                portfolio: e.target.value,
              })
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">Skills</label>
          <div className="tag-container">
            {profile.professional.skills.map((skill) => (
              <span key={skill} className="tag">
                {skill}
                <button
                  className="tag-remove"
                  onClick={() => removeSkill(skill)}
                  title="Remove skill"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <input
              className="form-input"
              type="text"
              placeholder="Add a skill..."
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSkill();
                }
              }}
            />
            <button className="btn btn-secondary btn-sm" onClick={addSkill}>
              Add
            </button>
          </div>
        </div>
      </ProfileCard>
    </div>
  );
}
