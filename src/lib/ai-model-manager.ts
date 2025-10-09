/**
 * AI Model Manager
 * 
 * Central coordinator for downloading, serving, and managing AI models
 */

import type { AIModel, ModelDownloadOptions } from '@/types/ai-model';
import {
  getAllModels,
  getModelById,
  saveModel,
  deleteModel,
  updateModelStatus,
  updateModelProgress,
  generateModelId,
  MODEL_STORAGE_DIR,
  TORRENT_STORAGE_DIR,
} from './ai-model-storage';
import { parseHuggingFaceUrl, downloadHFModel } from './ai-huggingface';
// Torrent helpers are loaded dynamically to avoid bundling optional deps
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { readdir, stat, readFile, writeFile } from 'fs/promises';

/**
 * Initialize model manager
 */
export async function initModelManager(): Promise<void> {
  // Create storage directories
  await mkdir(MODEL_STORAGE_DIR, { recursive: true });
  await mkdir(TORRENT_STORAGE_DIR, { recursive: true });
  
  console.log('[Model Manager] Initialized');
  console.log(`[Model Manager] Model storage: ${MODEL_STORAGE_DIR}`);
  console.log(`[Model Manager] Torrent storage: ${TORRENT_STORAGE_DIR}`);
}

/**
 * Rescan local models from disk and load into memory store.
 * Looks for models/<modelId>/model.json first; if missing, infers from files.
 */
export async function rescanLocalModelsFromDisk(): Promise<number> {
  const baseDir = MODEL_STORAGE_DIR;
  let count = 0;
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const modelId = e.name;
      try {
        const metaPath = join(baseDir, modelId, 'model.json');
        try {
          const buf = await readFile(metaPath, 'utf8');
          const data = JSON.parse(buf);
          saveModel(data);
          count++;
          continue;
        } catch {}
        // Fallback: guess from files
        const dirFiles = await readdir(join(baseDir, modelId));
        const file = dirFiles.find(f => /\.(gguf|safetensors|bin|pt|pth|onnx)$/i.test(f));
        if (!file) continue;
        const fp = join(baseDir, modelId, file);
        const st = await stat(fp);
        // Heuristic: repoId::fileName from id
        let repoId = '';
        let fileName = file;
        const parts = modelId.split('__');
        if (parts.length >= 2) {
          // first part may be repoId with underscores for '/'
          const first = parts[0];
          const idx = first.indexOf('_');
          if (idx > 0) repoId = first.slice(0, idx) + '/' + first.slice(idx + 1).replace(/_/g, '-');
        }
        const model: AIModel = {
          id: modelId,
          name: repoId || modelId,
          huggingFaceUrl: '',
          repoId,
          fileName,
          size: st.size,
          format: (file.endsWith('.gguf') ? 'gguf' : file.endsWith('.onnx') ? 'onnx' : 'pytorch'),
          status: 'ready',
          downloadProgress: 100,
          uploadedBytes: 0,
          downloadedBytes: st.size,
          peers: 0,
          seeders: 0,
          addedAt: Date.now(),
          metadata: {},
          localPath: fp,
        };
        saveModel(model);
        count++;
      } catch {}
    }
  } catch {}
  return count;
}

/**
 * Add model from HuggingFace URL
 */
export async function addModelFromHuggingFace(
  options: ModelDownloadOptions,
  onProgress?: (modelId: string, progress: number, speed: number) => void
): Promise<AIModel> {
  const info = parseHuggingFaceUrl(options.huggingFaceUrl);
  
  if (!info) {
    throw new Error('Invalid HuggingFace URL');
  }
  
  const modelId = generateModelId(info.repoId, options.fileName || info.fileName);
  
  // Check if model already exists
  const existing = getModelById(modelId);
  if (existing) {
    if (existing.status === 'ready' || existing.status === 'serving') {
      return existing;
    }
    if (existing.status === 'downloading') {
      throw new Error('Model is already being downloaded');
    }
  }
  
  // Create initial model entry
  const model: AIModel = {
    id: modelId,
    name: info.repoId,
    huggingFaceUrl: options.huggingFaceUrl,
    repoId: info.repoId,
    fileName: options.fileName || info.fileName,
    size: 0,
    format: 'gguf',
    status: 'downloading',
    downloadProgress: 0,
    uploadedBytes: 0,
    downloadedBytes: 0,
    peers: 0,
    seeders: 0,
    addedAt: Date.now(),
    metadata: {},
  };
  
  saveModel(model);
  
  try {
    // Download from HuggingFace
    const { filePath, model: modelInfo } = await downloadHFModel(
      options.huggingFaceUrl,
      (downloaded, total, percent) => {
        updateModelStatus(modelId, 'downloading');
        // Keep in-memory progress updated so /ai-list reflects it
        try { updateModelProgress(modelId, Math.max(0, Math.min(100, Math.round(percent))), downloaded, 0); } catch {}
        if (onProgress) {
          const speed = 0; // HF doesn't provide speed
          onProgress(modelId, percent, speed);
        }
      }
    );
    
    // Update model with downloaded info
    const updatedModel: AIModel = {
      ...model,
      ...modelInfo,
      status: 'ready',
      downloadProgress: 100,
      downloadedBytes: modelInfo.size || 0,
      localPath: filePath,
    };
    
    saveModel(updatedModel);
    // Persist metadata for rescan
    try {
      const metaPath = join(MODEL_STORAGE_DIR, modelId, 'model.json');
      await writeFile(metaPath, JSON.stringify(updatedModel, null, 2), 'utf8');
    } catch {}
    // Best-effort immediate registry update so peers list reflects new model
    try {
      const { registerSelf } = await import('./swarm-client');
      const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
      registerSelf(base).catch(() => {});
    } catch {}
    
    // Create torrent for P2P sharing if explicitly enabled
    if (options.createTorrent && process.env.ENABLE_TORRENTS === '1') {
      try {
        const { createModelTorrent } = await import('./ai-torrent-manager');
        const { magnetUri, infoHash } = await createModelTorrent(
          modelId,
          filePath,
          (uri, hash) => {
            console.log(`[Model Manager] Torrent created for ${modelId}`);
            updatedModel.magnetUri = uri;
            updatedModel.infoHash = hash;
            saveModel(updatedModel);
            try {
              const metaPath = join(MODEL_STORAGE_DIR, modelId, 'model.json');
              // Use promise-based write to avoid 'await' in a non-async callback
              writeFile(metaPath, JSON.stringify(updatedModel, null, 2), 'utf8').catch(() => {});
            } catch {}
            try {
              // Use dynamic import without await in this non-async callback
              import('./swarm-client').then(({ registerSelf }) => {
                const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
                registerSelf(base).catch(() => {});
              }).catch(() => {});
            } catch {}
          }
        );
        
        updatedModel.magnetUri = magnetUri;
        updatedModel.infoHash = infoHash;
        saveModel(updatedModel);
      } catch (err) {
        console.error('[Model Manager] Failed to create torrent:', err);
      }
    }
    
    console.log(`[Model Manager] Model ${modelId} ready`);
    return updatedModel;
  } catch (err) {
    console.error(`[Model Manager] Failed to download model ${modelId}:`, err);
    updateModelStatus(modelId, 'error');
    throw err;
  }
}

/**
 * Add model from magnet URI
 */
export async function addModelFromMagnet(
  magnetUri: string,
  metadata?: Partial<AIModel>,
  onProgress?: (modelId: string, progress: number, speed: number, peers: number) => void
): Promise<AIModel> {
  // Extract info hash from magnet URI
  const infoHashMatch = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
  if (!infoHashMatch) {
    throw new Error('Invalid magnet URI');
  }
  
  const infoHash = infoHashMatch[1].toLowerCase();
  const modelId = metadata?.id || `model_${infoHash.slice(0, 12)}`;
  
  // Check if already exists
  const existing = getModelById(modelId);
  if (existing && existing.status === 'downloading') {
    throw new Error('Model is already being downloaded');
  }
  
  const model: AIModel = {
    id: modelId,
    name: metadata?.name || `Model ${modelId}`,
    huggingFaceUrl: metadata?.huggingFaceUrl || '',
    repoId: metadata?.repoId || '',
    magnetUri,
    infoHash,
    size: metadata?.size || 0,
    format: metadata?.format || 'gguf',
    status: 'downloading',
    downloadProgress: 0,
    uploadedBytes: 0,
    downloadedBytes: 0,
    peers: 0,
    seeders: 0,
    addedAt: Date.now(),
    metadata: metadata?.metadata || {},
  };
  
  saveModel(model);
  
  try {
    const downloadPath = join(MODEL_STORAGE_DIR, modelId);
    await mkdir(downloadPath, { recursive: true });
    
    const { downloadModelTorrent } = await import('./ai-torrent-manager');
    const filePath = await downloadModelTorrent(
      modelId,
      magnetUri,
      downloadPath,
      (progress, speed, peers) => {
        // Update in-memory progress so /ai-list reflects torrent progress
        try { updateModelProgress(modelId, Math.max(0, Math.min(100, Math.round(progress))), 0, peers); } catch {}
        if (onProgress) {
          onProgress(modelId, progress, speed, peers);
        }
      }
    );
    
    const updatedModel: AIModel = {
      ...model,
      status: 'ready',
      downloadProgress: 100,
      localPath: filePath,
    };
    
    saveModel(updatedModel);
    
    console.log(`[Model Manager] Model ${modelId} ready from torrent`);
    return updatedModel;
  } catch (err) {
    console.error(`[Model Manager] Failed to download from torrent:`, err);
    updateModelStatus(modelId, 'error');
    throw err;
  }
}

/**
 * Remove model
 */
export async function removeModel(modelId: string): Promise<void> {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error('Model not found');
  }
  
  // Delete local files
  if (model.localPath) {
    try {
      const modelDir = join(MODEL_STORAGE_DIR, modelId);
      await rm(modelDir, { recursive: true, force: true });
      console.log(`[Model Manager] Deleted files for ${modelId}`);
    } catch (err) {
      console.error(`[Model Manager] Failed to delete files:`, err);
    }
  }
  
  // Remove from storage
  deleteModel(modelId);
  console.log(`[Model Manager] Removed model ${modelId}`);
}

/**
 * List all models
 */
export function listModels(): AIModel[] {
  return getAllModels();
}

/**
 * Get model details
 */
export function getModel(modelId: string): AIModel | undefined {
  return getModelById(modelId);
}

/**
 * Pause model download
 */
export async function pauseModelDownload(modelId: string): Promise<void> {
  const model = getModelById(modelId);
  if (!model || model.status !== 'downloading') {
    throw new Error('Model is not downloading');
  }
  
  // TODO: Implement pause for HF downloads
  // For torrents, we can stop the torrent
  if (model.infoHash) {
    const { stopTorrent } = await import('./ai-torrent-manager');
    await stopTorrent(model.infoHash);
  }
  
  updateModelStatus(modelId, 'paused');
}

/**
 * Resume model download
 */
export async function resumeModelDownload(modelId: string): Promise<void> {
  const model = getModelById(modelId);
  if (!model || model.status !== 'paused') {
    throw new Error('Model is not paused');
  }
  
  if (model.magnetUri) {
    const { resumeTorrent } = await import('./ai-torrent-manager');
    const downloadPath = join(MODEL_STORAGE_DIR, modelId);
    await resumeTorrent(modelId, model.magnetUri, downloadPath);
  } else {
    // For HF downloads, restart from scratch
    throw new Error('Cannot resume HuggingFace downloads yet');
  }
}
