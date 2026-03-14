export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  timestamp: Date;
}

export interface SourceRef {
  fileId: string;
  fileName: string;
  excerpt: string;
}

export interface KnowledgeChunk {
  fileId: string;
  fileName: string;
  content: string;
}
