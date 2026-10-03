// ============================================================
// Cloud Storage — Supabase
// ============================================================
// Replaces local IndexedDB storage with Supabase cloud storage.
// Profile data → Supabase `profiles` table
// Document metadata → Supabase `documents` table
// Document files → Supabase Storage `user-documents` bucket
// ============================================================

import type { UserProfile } from '../types/profile';
import type { StoredDocument } from '../types/document';
import { createEmptyProfile } from '../types/profile';
import { supabase, getCurrentUser } from './supabase';

// ---- Profile Operations ----

/** Load user profile from Supabase */
export async function cloudGetProfile(): Promise<UserProfile> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    // Return empty profile if not found yet
    return createEmptyProfile();
  }

  // Parse the JSON profile data stored in the `summary` column
  // We store the full UserProfile as JSON in the summary field
  try {
    if (data.summary && data.summary.startsWith('{')) {
      return JSON.parse(data.summary) as UserProfile;
    }
  } catch {
    // If parse fails, construct from individual fields
  }

  // Fallback: construct profile from individual columns
  const profile = createEmptyProfile();
  const nameParts = (data.full_name || '').split(' ');
  profile.personal.firstName = nameParts[0] || '';
  profile.personal.lastName = nameParts.slice(1).join(' ') || '';
  if (data.email) {
    profile.emails = [{ id: crypto.randomUUID(), value: data.email, label: 'Personal', primary: true }];
  }
  if (data.phone) {
    profile.phones = [{ id: crypto.randomUUID(), value: data.phone, label: 'Personal', primary: true }];
  }
  if (data.address) {
    profile.addresses = [{ id: crypto.randomUUID(), label: 'Current', primary: true, line1: data.address, city: '', state: '', postalCode: '', country: '' }];
  }
  if (data.linkedin_url) {
    profile.professional.linkedin = data.linkedin_url;
  }
  return profile;
}

/** Save user profile to Supabase */
export async function cloudSaveProfile(profile: UserProfile): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const primaryEmail = profile.emails.find(e => e.primary)?.value || profile.emails[0]?.value || '';
  const primaryPhone = profile.phones.find(p => p.primary)?.value || profile.phones[0]?.value || '';
  const primaryAddress = profile.addresses.find(a => a.primary)?.line1 || profile.addresses[0]?.line1 || '';

  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      full_name: `${profile.personal.firstName} ${profile.personal.lastName}`.trim(),
      email: primaryEmail,
      phone: primaryPhone,
      address: primaryAddress,
      linkedin_url: profile.professional?.linkedin || '',
      summary: JSON.stringify(profile), // Store full profile as JSON
      updated_at: new Date().toISOString(),
    });

  if (error) throw new Error(`Failed to save profile: ${error.message}`);
}

// ---- Document Operations ----

/** Save a document (metadata + file) to Supabase */
export async function cloudSaveDocument(
  meta: StoredDocument,
  blob: Blob,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const storagePath = `${user.id}/${meta.id}`;

  // Upload file to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from('user-documents')
    .upload(storagePath, blob, {
      contentType: meta.mimeType,
      upsert: true,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // Save metadata to documents table
  const { error: metaError } = await supabase
    .from('documents')
    .upsert({
      id: meta.id,
      user_id: user.id,
      original_name: meta.originalName,
      mime_type: meta.mimeType,
      size: meta.sizeBytes,
      category: meta.category,
      storage_path: storagePath,
      created_at: meta.createdAt,
    });

  if (metaError) throw new Error(`Metadata save failed: ${metaError.message}`);
}

/** Load all document metadata from Supabase */
export async function cloudLoadAllDocumentMetadata(): Promise<StoredDocument[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return data.map((doc) => ({
    id: doc.id,
    name: doc.original_name,
    originalName: doc.original_name,
    mimeType: doc.mime_type,
    category: doc.category as StoredDocument['category'],
    sizeBytes: doc.size,
    createdAt: doc.created_at,
    updatedAt: doc.created_at,
  }));
}

/** Load a document's file blob from Supabase Storage */
export async function cloudLoadDocumentBlob(docId: string): Promise<Blob> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const storagePath = `${user.id}/${docId}`;

  const { data, error } = await supabase.storage
    .from('user-documents')
    .download(storagePath);

  if (error || !data) throw new Error(`Download failed: ${error?.message || 'No data'}`);

  return data;
}

/** Delete a document (metadata + file) from Supabase */
export async function cloudDeleteDocument(docId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not authenticated');

  const storagePath = `${user.id}/${docId}`;

  // Delete file from storage
  await supabase.storage
    .from('user-documents')
    .remove([storagePath]);

  // Delete metadata from table
  await supabase
    .from('documents')
    .delete()
    .eq('id', docId)
    .eq('user_id', user.id);
}

/** Get document count for the current user */
export async function cloudGetDocumentCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;

  const { count, error } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (error) return 0;
  return count || 0;
}
