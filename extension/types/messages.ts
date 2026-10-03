// ============================================================
// Extension Messaging Types
// ============================================================
// Type-safe messages between popup ↔ content script ↔ background.
// Uses discriminated unions for exhaustive pattern matching.
// ============================================================

import type { UserProfile } from './profile';
import type { ScanResult, AutofillResult, FieldMapping } from './autofill';
import type { SanitizedField, FieldIdLookup } from './aiMapper';
import type { JobPageClassification } from '../utils/jobPageDetector';

// ---- Request Messages (popup/background → content script) ----

export interface ScanFieldsRequest {
  type: 'SCAN_FIELDS';
}

/** Ask the content script to run the local job-page detector */
export interface DetectJobPageRequest {
  type: 'DETECT_JOB_PAGE';
}

export interface WaitForFormReadyRequest {
  type: 'WAIT_FOR_FORM_READY';
}

/** Ask the content script to run a full pre-scan (detect + regex + sanitized fields + fingerprint) */
export interface PrescanRequest {
  type: 'PRESCAN';
}

export interface FillFieldsRequest {
  type: 'FILL_FIELDS';
  mappings: FieldMapping[];
}

export interface InjectFileRequest {
  type: 'INJECT_FILE';
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface AIScanFieldsRequest {
  type: 'AI_SCAN_FIELDS';
}

// ---- Response Messages (content script → popup/background) ----

export interface DetectJobPageResponse {
  type: 'DETECT_JOB_PAGE_RESULT';
  classification: JobPageClassification;
  score: number;
}

export interface WaitForFormReadyResponse {
  type: 'WAIT_FOR_FORM_READY_RESULT';
  ready: boolean;
}

export interface PrescanResponse {
  type: 'PRESCAN_RESULT';
  scanResult: ScanResult;
  sanitizedFields: SanitizedField[];
  selectorLookup: FieldIdLookup;
  fingerprint: string;
}

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

export interface InjectFileResponse {
  type: 'INJECT_FILE_RESULT';
  success: boolean;
  message: string;
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
  | DetectJobPageRequest
  | WaitForFormReadyRequest
  | PrescanRequest
  | ScanFieldsResponse
  | FillFieldsResponse
  | AIScanFieldsResponse
  | DetectJobPageResponse
  | WaitForFormReadyResponse
  | PrescanResponse
  | GetProfileRequest
  | GetProfileResponse
  | SaveProfileRequest
  | SaveProfileResponse
  | InjectFileRequest
  | InjectFileResponse;

export type ContentScriptRequest =
  | ScanFieldsRequest
  | FillFieldsRequest
  | AIScanFieldsRequest
  | DetectJobPageRequest
  | WaitForFormReadyRequest
  | PrescanRequest
  | InjectFileRequest;

export type ContentScriptResponse =
  | ScanFieldsResponse
  | FillFieldsResponse
  | AIScanFieldsResponse
  | DetectJobPageResponse
  | WaitForFormReadyResponse
  | PrescanResponse
  | InjectFileResponse;
