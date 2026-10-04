export type QuestionTaskStatus =
  | 'RETRIEVING'
  | 'GENERATING'
  | 'READY_TO_FILL'
  | 'FILLING'
  | 'FILLED'
  | 'ERROR';

export interface QuestionTask {
  fieldId: string;
  selector: string;
  frameId: number;
  question: string;
  type: 'application_question';
  status: QuestionTaskStatus;
  answer?: string;
  error?: string;
}

export interface TabQuestionState {
  tabId: number;
  url: string;
  frameId: number;
  autofillRequested: boolean;
  profileMappingPending?: boolean;
  tasks: QuestionTask[];
}