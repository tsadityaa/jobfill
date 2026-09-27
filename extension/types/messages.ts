// ============================================================
// Extension Messaging Types
// ============================================================
// Type-safe messages between popup ↔ content script ↔ background.
// Uses discriminated unions for exhaustive pattern matching.
// ============================================================

import type { UserProfile } from './profile';
import type { ScanResult, AutofillResult, FieldMapping } from './autofill';
import type { SanitizedField, FieldIdLookup } from './aiMapper';

// ---- Request Messages (popup/background → content script) ----

export interface ScanFieldsRequest {
  type: 'SCAN_FIELDS';
}

export interface FillFieldsRequest {
  type: 'FILL_FIELDS';
  mappings: FieldMapping[];
}

export interface AIScanFieldsRequest {
  type: 'AI_SCAN_FIELDS';
}

// ---- Response Messages (content script → popup/background) ----

export interface ScanFieldsResponse {
  type: 'SCAN_FIELDS_RESULT';
  result: ScanResult;
}

export interface FillFieldsResponse {
  type: 'FILL_FIELDS_RESULT';
  result: AutofillResult;
}

export interface AIScanFieldsResponse {
  type: 'AI_SCAN_FIELDS_RESULT';
  sanitizedFields: SanitizedField[];
  selectorLookup: FieldIdLookup;
}

// ---- Profile Messages (popup ↔ background) ----

export interface GetProfileRequest {
  type: 'GET_PROFILE';
}

export interface GetProfileResponse {
  type: 'GET_PROFILE_RESULT';
  profile: UserProfile;
}

export interface SaveProfileRequest {
  type: 'SAVE_PROFILE';
  profile: UserProfile;
}

export interface SaveProfileResponse {
  type: 'SAVE_PROFILE_RESULT';
  success: boolean;
}

// ---- Union Types ----

export type ExtensionMessage =
  | ScanFieldsRequest
  | FillFieldsRequest
  | AIScanFieldsRequest
  | ScanFieldsResponse
  | FillFieldsResponse
  | AIScanFieldsResponse
  | GetProfileRequest
  | GetProfileResponse
  | SaveProfileRequest
  | SaveProfileResponse;

export type ContentScriptRequest = ScanFieldsRequest | FillFieldsRequest | AIScanFieldsRequest;
export type ContentScriptResponse = ScanFieldsResponse | FillFieldsResponse | AIScanFieldsResponse;
