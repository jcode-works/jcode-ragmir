import type { PathLike } from "node:fs";

export interface Config {
  projectRoot: string;
  rawDir: string;
  storageDir: string;
  sourcesFile: string;
  tableName: string;
  ollamaHost: string;
  embedModel: string;
  llmModel: string;
  topK: number;
  chunkSize: number;
  chunkOverlap: number;
}

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  source: string;
  extension: string;
  bytes: number;
  mtimeMs: number;
  checksum: string;
}

export interface ParsedDocument {
  file: SourceFile;
  text: string;
}

export interface TextChunk {
  id: string;
  source: string;
  relativePath: string;
  chunkIndex: number;
  text: string;
  checksum: string;
  bytes: number;
  mtimeMs: number;
}

export interface VectorRow extends TextChunk {
  vector: number[];
}

export interface IngestOptions {
  cwd?: PathLike;
  rebuild?: boolean;
}

export interface IngestResult {
  indexedFiles: number;
  chunks: number;
  skippedFiles: number;
  errors: Array<{ path: string; message: string }>;
}

export interface SearchOptions {
  cwd?: PathLike;
  topK?: number;
}

export interface SearchResult {
  source: string;
  relativePath: string;
  chunkIndex: number;
  text: string;
  distance: number | null;
}

export interface AskResult {
  answer: string;
  sources: SearchResult[];
}

export interface AuditReport {
  indexedFiles: Array<{ source: string; chunks: number }>;
  supportedFiles: string[];
  missingFromIndex: string[];
  staleInIndex: string[];
  totalChunks: number;
}
