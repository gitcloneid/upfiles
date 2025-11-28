export interface Meja {
  id: string;
  nomor: number;
  kode: string;
  nama_peserta: string | null;
  files: FileInfo[];
  last_upload: string | null;
}

export interface FileInfo {
  id: string;
  filename: string;
  size: number;
  uploaded_at: string;
  path: string;
}

export interface TimerState {
  is_running: boolean;
  duration_seconds: number;
  remaining_seconds: number;
  started_at: string | null;
}

export interface SoalFile {
  id: string;
  filename: string;
  path: string;
  uploaded_at: string;
}

export interface AppState {
  meja_list: Record<string, Meja>;
  timer: TimerState;
  soal_files: SoalFile[];
  lomba_title: string;
}

export interface ArchiveEntry {
  name: string;
  size: number;
  is_dir: boolean;
}

export interface ArchiveContent {
  files: ArchiveEntry[];
}

export interface FilePreview {
  filename: string;
  content: string | null;
  is_text: boolean;
  size: number;
}
