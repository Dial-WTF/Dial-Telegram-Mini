/**
 * Decentralized AI Model Types
 * 
 * Supports P2P model downloading, serving, and inference
 */

export type ModelStatus = 'downloading' | 'ready' | 'serving' | 'error' | 'paused';
export type ModelFormat = 'gguf' | 'safetensors' | 'pytorch' | 'onnx';

export interface AIModel {
  id: string;
  name: string;
  huggingFaceUrl: string;
  repoId: string; // e.g., "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
  fileName?: string; // Specific file to download
  magnetUri?: string; // BitTorrent magnet link
  infoHash?: string; // Torrent info hash
  size: number; // bytes
  format: ModelFormat;
  status: ModelStatus;
  downloadProgress: number; // 0-100
  uploadedBytes: number; // P2P sharing stats
  downloadedBytes: number;
  peers: number; // Active peers
  seeders: number;
  addedAt: number; // timestamp
  lastUsedAt?: number;
  localPath?: string;
  metadata: {
    description?: string;
    parameters?: string; // e.g., "1.5B"
    quantization?: string; // e.g., "Q4_K_M"
    license?: string;
    contextLength?: number;
    architecture?: string;
  };
}

export interface ModelDownloadOptions {
  huggingFaceUrl: string;
  fileName?: string; // Optional specific file
  createTorrent?: boolean; // Create torrent for P2P sharing
}

export interface ModelServeConfig {
  modelId: string;
  port?: number;
  host?: string;
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;
  maxTokens?: number;
}

export interface ModelServeStatus {
  modelId: string;
  isServing: boolean;
  port?: number;
  host?: string;
  startedAt?: number;
  requestCount?: number;
  errorCount?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  modelId: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface TorrentStats {
  infoHash: string;
  magnetUri: string;
  progress: number; // 0-1
  downloadSpeed: number; // bytes/sec
  uploadSpeed: number; // bytes/sec
  downloaded: number; // bytes
  uploaded: number; // bytes
  peers: number;
  seeders: number;
  files: {
    name: string;
    path: string;
    length: number;
    progress: number;
  }[];
}
