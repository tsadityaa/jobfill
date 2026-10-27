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
  /** false when a lazy scan did not open the dropdown, so `options` is empty until probed. Missing means loaded. */
  optionsLoaded?: boolean;
  /** Text currently shown by the dropdown, when readable without opening it. */
  currentValue?: string;
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
  /** Do not open dropdowns to read their options; report them with optionsLoaded=false. */
  lazy?: boolean;
}

export interface DropdownProbeRequest {
  type: 'DROPDOWN_PROBE';
  selectors: string[];
}

export interface DropdownProbeResponse {
  type: 'DROPDOWN_PROBE_RESULT';
  results: Array<{ selector: string; options: DropdownOption[] }>;
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
