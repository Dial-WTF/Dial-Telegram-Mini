/**
 * AI Model Storage Management
 * 
 * In-memory storage for model metadata and state
 * In production, this should use a database
 */

import type { AIModel, ModelServeStatus } from '@/types/ai-model';

// In-memory storage (replace with database in production)
const models = new Map<string, AIModel>();
const servingStatus = new Map<string, ModelServeStatus>();

// Model storage directory
export const MODEL_STORAGE_DIR = process.env.AI_MODEL_DIR || './models';
export const TORRENT_STORAGE_DIR = process.env.AI_TORRENT_DIR || './torrents';

/**
 * Get all models
 */
export function getAllModels(): AIModel[] {
  return Array.from(models.values());
}

/**
 * Get model by ID
 */
export function getModelById(id: string): AIModel | undefined {
  return models.get(id);
}

/**
 * Get model by HuggingFace repo ID
 */
export function getModelByRepoId(repoId: string): AIModel | undefined {
  return Array.from(models.values()).find(m => m.repoId === repoId);
}

/**
 * Get model by info hash
 */
export function getModelByInfoHash(infoHash: string): AIModel | undefined {
  return Array.from(models.values()).find(m => m.infoHash === infoHash);
}

/**
 * Add or update model
 */
export function saveModel(model: AIModel): void {
  models.set(model.id, model);
}

/**
 * Delete model
 */
export function deleteModel(id: string): boolean {
  return models.delete(id);
}

/**
 * Get models by status
 */
export function getModelsByStatus(status: AIModel['status']): AIModel[] {
  return Array.from(models.values()).filter(m => m.status === status);
}

/**
 * Get ready models (available for use)
 */
export function getReadyModels(): AIModel[] {
  return getModelsByStatus('ready');
}

/**
 * Get serving models
 */
export function getServingModels(): AIModel[] {
  return getModelsByStatus('serving');
}

/**
 * Update model download progress
 */
export function updateModelProgress(
  id: string,
  progress: number,
  downloadedBytes: number,
  peers: number = 0
): void {
  const model = models.get(id);
  if (model) {
    model.downloadProgress = progress;
    model.downloadedBytes = downloadedBytes;
    model.peers = peers;
    models.set(id, model);
  }
}

/**
 * Update model status
 */
export function updateModelStatus(id: string, status: AIModel['status']): void {
  const model = models.get(id);
  if (model) {
    model.status = status;
    if (status === 'ready' || status === 'serving') {
      model.lastUsedAt = Date.now();
    }
    models.set(id, model);
  }
}

/**
 * Get model serve status
 */
export function getServeStatus(modelId: string): ModelServeStatus | undefined {
  return servingStatus.get(modelId);
}

/**
 * Update model serve status
 */
export function updateServeStatus(status: ModelServeStatus): void {
  servingStatus.set(status.modelId, status);
}

/**
 * Stop serving model
 */
export function stopServing(modelId: string): void {
  servingStatus.delete(modelId);
  updateModelStatus(modelId, 'ready');
}

/**
 * Update model upload stats (for P2P sharing)
 */
export function updateModelUploadStats(id: string, uploadedBytes: number, seeders: number = 0): void {
  const model = models.get(id);
  if (model) {
    model.uploadedBytes = uploadedBytes;
    model.seeders = seeders;
    models.set(id, model);
  }
}

/**
 * Generate unique model ID from HuggingFace URL
 */
export function generateModelId(repoId: string, fileName?: string): string {
  const base = repoId.replace(/\//g, '_');
  return fileName ? `${base}__${fileName.replace(/\./g, '_')}` : base;
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Calculate ETA from download speed
 */
export function calculateETA(remainingBytes: number, bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return 'Unknown';
  const seconds = Math.floor(remainingBytes / bytesPerSecond);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
