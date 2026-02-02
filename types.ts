
export interface ImageTask {
  id: string;
  sheet: string;
  fullName: string;
  url: string;
  filename: string;
  registrationDate?: Date | null;
  isSelected: boolean;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'skipped';
  error?: string;
  blob?: Blob;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  selected: number;
}

export interface ExcelRow {
  'Full Name': string;
  'Image URL': string;
  'Registration Date'?: string | number;
}
