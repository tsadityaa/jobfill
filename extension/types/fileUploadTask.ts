import type { DocumentType } from './document';

export type FileUploadTaskStatus =
  | 'CLASSIFYING'
  | 'MATCHED'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'ERROR';

export interface FileUploadTask {
  fieldId: string;
  selector: string;
  frameId: number;
  label: string;
  accept?: string;
  expectedType?: DocumentType;
  documentId?: string;
  fileName?: string;
  status: FileUploadTaskStatus;
  error?: string;
}

export interface TabFileUploadState {
  tabId: number;
  url: string;
  autofillRequested: boolean;
  tasks: FileUploadTask[];
}