export type ChoiceControlKind = 'radio' | 'checkbox';

export interface ChoiceOption {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  selected: boolean;
  selector?: string;
}

export interface ChoiceControl {
  id: string;
  kind: ChoiceControlKind;
  selector: string;
  question: string;
  options: ChoiceOption[];
  multiple: boolean;
}

export interface ChoiceDecision {
  controlId: string;
  selectedOptionIds: string[];
  confidence: number;
  source: 'profile' | 'form' | 'memory' | 'ai' | 'user_preference';
}

export interface ChoiceScanRequest {
  type: 'CHOICE_SCAN';
}

export interface ChoiceApplyRequest {
  type: 'CHOICE_APPLY';
  decisions: ChoiceDecision[];
}

export interface ChoiceEvidence {
  profileFacts: string[];
  memories: string[];
  formAnswers: string[];
}

export interface ChoiceFormAnswer {
  question: string;
  answer: string;
}

export interface ChoiceScanResponse {
  type: 'CHOICE_SCAN_RESULT';
  controls: ChoiceControl[];
  formAnswers: ChoiceFormAnswer[];
}

export interface ChoiceApplyResponse {
  type: 'CHOICE_APPLY_RESULT';
  applied: string[];
  unresolved: string[];
}