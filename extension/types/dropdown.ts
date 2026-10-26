export type DropdownControlKind = 'select' | 'google-forms' | 'combobox';

export interface DropdownOption {
  index: number;
  label: string;
  value: string;
  disabled: boolean;
  selected: boolean;
  selector?: string;
}

export interface DropdownControl {
  id: string;
  kind: DropdownControlKind;
  selector: string;
  question: string;
  options: DropdownOption[];
}

export interface DropdownDecision {
  controlId: string;
  selector: string;
  selectedIndex: number;
  selectedLabel: string;
  confidence: number;
  optionSelector?: string;
  source?: 'profile' | 'ai';
}

export interface DropdownScanRequest {
  type: 'DROPDOWN_SCAN';
}

export interface DropdownScanResponse {
  type: 'DROPDOWN_SCAN_RESULT';
  controls: DropdownControl[];
}

export interface DropdownApplyRequest {
  type: 'DROPDOWN_APPLY';
  decisions: DropdownDecision[];
}

export interface DropdownApplyResponse {
  type: 'DROPDOWN_APPLY_RESULT';
  applied: string[];
  unresolved: string[];
}

export interface DropdownPipelineResult {
  type: 'DROPDOWN_PIPELINE_RESULT';
  tabId: number;
  detectedCount: number;
  filledCount: number;
  unresolvedCount: number;
}

export interface TriggerDropdownAutofillRequest {
  type: 'TRIGGER_DROPDOWN_AUTOFILL';
  tabId: number;
}
