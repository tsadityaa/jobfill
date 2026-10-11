import Supermemory from 'supermemory';
import type { UserProfile } from '../types/profile';

// Initialize the Supermemory client
// We get the API key from Vite's env variables
const client = new Supermemory({
  apiKey: import.meta.env.VITE_SUPERMEMORY_API_KEY || 'MISSING_API_KEY',
});

/**
 * Format a UserProfile into a comprehensive text document for Supermemory
 */
export function formatProfileForMemory(profile: UserProfile): string {
  const parts: string[] = [];

  // Personal
  const fullName = [profile.personal.firstName, profile.personal.middleName, profile.personal.lastName].filter(Boolean).join(' ');
  const firstName = profile.personal.firstName?.trim() || '';
  if (fullName) parts.push(`Full Name: ${fullName}`);
  if (firstName) parts.push(`First Name: ${firstName}`);
  if (profile.personal.gender) {
    parts.push(`Gender: ${profile.personal.gender}`);
  } else if (firstName) {
    parts.push(`Gender: Infer from candidate first name (${firstName})`);
  }
  if (profile.personal.dateOfBirth) parts.push(`Date of Birth: ${profile.personal.dateOfBirth}`);

  // Contact
  for (const phone of profile.phones) {
    parts.push(`Phone (${phone.label}${phone.primary ? ', primary' : ''}): ${phone.value}`);
  }
  for (const email of profile.emails) {
    parts.push(`Email (${email.label}${email.primary ? ', primary' : ''}): ${email.value}`);
  }

  // Address
  for (const addr of profile.addresses) {
    const addrParts = [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country].filter(Boolean).join(', ');
    if (addrParts) parts.push(`Address (${addr.label}${addr.primary ? ', primary' : ''}): ${addrParts}`);
  }

  // Current Employment Status
  const currentJobs = profile.experience.filter((exp) => exp.current || !exp.endDate || /present|current|now/i.test(exp.endDate));
  if (currentJobs.length > 0) {
    parts.push(`Current Employment Status: Employed (Currently working as ${currentJobs.map((j) => [j.title, j.company].filter(Boolean).join(' at ')).join(', ')})`);
  } else if (profile.experience.length > 0) {
    parts.push('Current Employment Status: Not currently employed / Seeking employment');
  } else {
    parts.push('Current Employment Status: Student / Fresher / Entry Level');
  }

  // Experience
  for (const exp of profile.experience) {
    const isCurrent = exp.current || !exp.endDate || /present|current|now/i.test(exp.endDate);
    const expLine = [exp.title, exp.company].filter(Boolean).join(' at ');
    if (expLine) parts.push(`Work Experience: ${expLine} [Status: ${isCurrent ? 'Currently working / Active job' : 'Past employment'}]`);
    if (exp.location) parts.push(`Work location: ${exp.location}`);
    const expDates = [exp.startDate, exp.endDate || (isCurrent ? 'present' : '')].filter(Boolean).join(' to ');
    if (expDates) parts.push(`Work period: ${expDates}`);
    if (exp.description) parts.push(`Work description: ${exp.description}`);
  }

  // Education
  for (const edu of profile.education) {
    const isCurrentEdu = edu.current || (!edu.endDate && !edu.startDate);
    const eduLine = [edu.degree, edu.field, edu.institution].filter(Boolean).join(' in ');
    if (eduLine) parts.push(`Education: ${eduLine} [Status: ${isCurrentEdu ? 'Currently Pursuing' : 'Completed Degree'}]`);
    if (edu.registrationNo) parts.push(`Registration/Roll Number: ${edu.registrationNo}`);
    if (edu.gpa) parts.push(`GPA/CGPA: ${edu.gpa}`);
    const eduDates = [edu.startDate, edu.endDate || (isCurrentEdu ? 'present' : '')].filter(Boolean).join(' to ');
    if (eduDates) parts.push(`Education period: ${eduDates}`);
    if (edu.description) parts.push(`Education details: ${edu.description}`);
  }

  // Professional
  if (profile.professional.linkedin) parts.push(`LinkedIn: ${profile.professional.linkedin}`);
  if (profile.professional.github) parts.push(`GitHub: ${profile.professional.github}`);
  if (profile.professional.portfolio) parts.push(`Portfolio: ${profile.professional.portfolio}`);
  if (profile.professional.skills.length > 0) parts.push(`Skills: ${profile.professional.skills.join(', ')}`);

  // Affirmative Job Preferences & Commitments for Shortlisting
  parts.push('Willingness to Relocate: Yes, willing and ready to relocate for internships, jobs, and full-time positions.');
  parts.push('Work Mode: Willing and comfortable working onsite, hybrid, and remote.');
  parts.push('Internship & Availability: Available for 6-month internships, full-time employment, and immediate joining.');
  parts.push('Work Authorization: Legally authorized to work without restrictions; does not require visa sponsorship.');

  return `My complete profile details:\n${parts.join('\n')}`;
}

/**
 * Sync complete user profile to Supermemory
 */
export async function syncProfileToMemory(userId: string, profile: UserProfile): Promise<void> {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY || !userId) return;
  const content = formatProfileForMemory(profile);
  await addMemory(userId, content, { type: 'profile_summary' });
}

/**
 * Add a memory for a specific user
 * @param userId The Supabase user ID (acts as the isolation boundary)
 * @param content The text/memory to store
 * @param metadata Optional key/value pairs to filter by
 */
export async function addMemory(userId: string, content: string, metadata?: Record<string, string>) {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY) {
    console.warn('Supermemory API Key missing. Memory not saved.');
    return;
  }
  
  try {
    await client.add({
      content,
      containerTag: userId,
      metadata,
    });
    console.log('[Supermemory] Memory added successfully');
  } catch (error) {
    console.error('[Supermemory] Failed to add memory:', error);
  }
}

/**
 * Search a specific user's memories
 * @param userId The Supabase user ID
 * @param query The question or search term
 * @returns Array of matching memories
 */
export async function searchMemory(userId: string, query: string): Promise<string[]> {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY) {
    return [];
  }

  try {
    const response = await client.search({
      q: query,
      containerTag: userId,
      // @ts-ignore - explicitly ask for hybrid search to catch both memories and document chunks
      searchMode: 'hybrid',
      limit: 5,
    });
    
    // Supermemory search usually returns an array of result objects
    // We'll extract just the raw text content for the agent to read
    if (response && response.results) {
      console.log('[Supermemory] Raw search results:', response.results);
      // @ts-ignore
      return response.results.map((r: any) => {
        if (typeof r === 'string') return r;
        return r.memory || r.chunk || r.content || r.text || JSON.stringify(r);
      });
    }
    return [];
  } catch (error) {
    console.error('[Supermemory] Search failed:', error);
    return [];
  }
}

/**
 * Get an AI-generated profile summary of the user from their memories
 */
export async function getMemoryProfile(userId: string): Promise<string> {
  if (!import.meta.env.VITE_SUPERMEMORY_API_KEY) {
    return '';
  }

  try {
    const response = await client.profile({
      containerTag: userId,
    });
    
    // @ts-ignore
    return response.profile || '';
  } catch (error) {
    console.error('[Supermemory] Profile fetch failed:', error);
    return '';
  }
}
