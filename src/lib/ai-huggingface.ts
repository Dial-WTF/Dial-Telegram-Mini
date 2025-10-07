/**
 * HuggingFace Model Downloader
 * 
 * Downloads models from HuggingFace Hub
 */

import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import type { AIModel, ModelFormat } from '@/types/ai-model';
import { generateModelId, MODEL_STORAGE_DIR } from './ai-model-storage';
import { setDefaultResultOrder } from 'dns';

export interface HFModelInfo {
  repoId: string;
  fileName?: string;
  branch?: string;
}

export interface HFFileInfo {
  name: string;
  size: number;
  url: string;
  downloadUrl: string;
}

// Prefer IPv4 to avoid some network environments where IPv6 causes TLS/DNS failures
try { setDefaultResultOrder('ipv4first'); } catch {}

function buildHeaders(kind: 'json' | 'file' = 'json'): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'DialAI/1.0 (+https://dial.wtf)'
  };
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (kind === 'json') headers['Accept'] = 'application/json';
  if (kind === 'file') headers['Accept'] = 'application/octet-stream';
  return headers;
}

async function fetchWithRetry(url: string, init: RequestInit & { timeoutMs?: number } = {}, attempts = 3): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    const timeoutMs = init.timeoutMs || 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // simple backoff: 500ms, 1500ms
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (i + 1) * 3));
      }
    }
  }
  throw lastErr;
}

/**
 * Parse HuggingFace URL
 */
export function parseHuggingFaceUrl(url: string): HFModelInfo | null {
  // Examples:
  // https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B
  // https://huggingface.co/TheBloke/Llama-2-7B-GGUF/blob/main/llama-2-7b.Q4_K_M.gguf
  
  const patterns = [
    // With file
    /huggingface\.co\/([^\/]+\/[^\/]+)\/(?:blob|resolve)\/([^\/]+)\/(.+)/,
    // Repo only
    /huggingface\.co\/([^\/]+\/[^\/]+)\/?$/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      if (match[3]) {
        // Has file
        return {
          repoId: match[1],
          branch: match[2],
          fileName: match[3],
        };
      } else {
        // Repo only
        return {
          repoId: match[1],
          branch: 'main',
        };
      }
    }
  }
  
  return null;
}

/**
 * Get model info from HuggingFace API
 */
export async function getHFModelInfo(repoId: string): Promise<any> {
  const url = `https://huggingface.co/api/models/${repoId}`;
  const response = await fetchWithRetry(url, { headers: buildHeaders('json'), timeoutMs: 20000 }, 3);
  
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to fetch model info: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0,200)}` : ''}`);
  }
  
  return response.json();
}

/**
 * List files in HuggingFace repo
 */
export async function listHFRepoFiles(repoId: string, branch: string = 'main'): Promise<HFFileInfo[]> {
  const url = `https://huggingface.co/api/models/${repoId}/tree/${branch}`;
  const response = await fetchWithRetry(url, { headers: buildHeaders('json'), timeoutMs: 20000 }, 3);
  
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to list repo files: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0,200)}` : ''}`);
  }
  
  const files = await response.json();
  
  return files.map((f: any) => ({
    name: f.path,
    size: f.size || 0,
    url: `https://huggingface.co/${repoId}/blob/${branch}/${f.path}`,
    downloadUrl: `https://huggingface.co/${repoId}/resolve/${branch}/${f.path}`,
  }));
}

/**
 * Download file from HuggingFace
 */
export async function downloadHFFile(
  downloadUrl: string,
  outputPath: string,
  onProgress?: (downloaded: number, total: number, percent: number) => void
): Promise<string> {
  // Create directory if it doesn't exist
  await mkdir(dirname(outputPath), { recursive: true });
  
  const response = await fetchWithRetry(downloadUrl, { headers: buildHeaders('file'), timeoutMs: 120000 }, 3);
  
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Download failed: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0,200)}` : ''}`);
  }
  
  const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
  let downloaded = 0;
  
  if (!response.body) {
    throw new Error('Response body is null');
  }
  
  // Convert Web ReadableStream to Node.js Readable
  const nodeReadable = Readable.fromWeb(response.body as any);

  // Progress transform
  const progressTransform = new Transform({
    transform(chunk, _enc, cb) {
      try {
        const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        downloaded += buf.length;
        const percent = totalSize > 0 ? (downloaded / totalSize) * 100 : 0;
        if (onProgress) onProgress(downloaded, totalSize, percent);
        this.push(buf);
        cb();
      } catch (e) {
        cb(e as Error);
      }
    }
  });

  // Download using Node streams
  const fileStream = createWriteStream(outputPath);
  await pipeline(nodeReadable, progressTransform, fileStream);
  
  return outputPath;
}

/**
 * Download model from HuggingFace
 */
export async function downloadHFModel(
  url: string,
  onProgress?: (downloaded: number, total: number, percent: number) => void
): Promise<{ filePath: string; model: Partial<AIModel> }> {
  const info = parseHuggingFaceUrl(url);
  
  if (!info) {
    throw new Error('Invalid HuggingFace URL');
  }
  
  // If no specific file, list files and pick the largest GGUF/safetensors
  let fileName = info.fileName;
  let fileSize = 0;
  
  if (!fileName) {
    const files = await listHFRepoFiles(info.repoId, info.branch);
    
    // Prioritize GGUF files, then safetensors
    const modelFiles = files.filter(f =>
      f.name.endsWith('.gguf') ||
      f.name.endsWith('.safetensors') ||
      f.name.endsWith('.bin')
    );
    
    if (modelFiles.length === 0) {
      throw new Error('No model files found in repository');
    }
    
    // Sort by size descending and pick the largest
    modelFiles.sort((a, b) => b.size - a.size);
    const targetFile = modelFiles[0];
    
    fileName = targetFile.name;
    fileSize = targetFile.size;
  } else {
    // Get file size for specific file
    const files = await listHFRepoFiles(info.repoId, info.branch);
    const targetFile = files.find(f => f.name === fileName);
    fileSize = targetFile?.size || 0;
  }
  
  const modelId = generateModelId(info.repoId, fileName);
  const downloadUrl = `https://huggingface.co/${info.repoId}/resolve/${info.branch || 'main'}/${fileName}`;
  const outputPath = join(MODEL_STORAGE_DIR, modelId, fileName);
  
  console.log(`[HF] Downloading ${info.repoId}/${fileName}`);
  console.log(`[HF] Size: ${formatBytes(fileSize)}`);
  console.log(`[HF] URL: ${downloadUrl}`);
  
  await downloadHFFile(downloadUrl, outputPath, onProgress);
  
  // Detect format from file extension
  const format = detectModelFormat(fileName);
  
  // Extract metadata from model info
  let modelInfo: any = {};
  try {
    modelInfo = await getHFModelInfo(info.repoId);
  } catch (err) {
    console.warn('[HF] Failed to fetch model info:', err);
  }
  
  const model: Partial<AIModel> = {
    id: modelId,
    name: modelInfo.modelId || info.repoId,
    huggingFaceUrl: url,
    repoId: info.repoId,
    fileName,
    size: fileSize,
    format,
    localPath: outputPath,
    metadata: {
      description: modelInfo.description,
      license: modelInfo.license,
      architecture: modelInfo.pipeline_tag,
    },
  };
  
  return { filePath: outputPath, model };
}

/**
 * Detect model format from file extension
 */
function detectModelFormat(fileName: string): ModelFormat {
  const ext = fileName.toLowerCase();
  if (ext.endsWith('.gguf')) return 'gguf';
  if (ext.endsWith('.safetensors')) return 'safetensors';
  if (ext.endsWith('.bin') || ext.endsWith('.pt') || ext.endsWith('.pth')) return 'pytorch';
  if (ext.endsWith('.onnx')) return 'onnx';
  return 'gguf'; // default
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
