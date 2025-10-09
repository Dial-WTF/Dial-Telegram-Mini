/**
 * AI Model Inference Engine
 * 
 * Runs local LLM inference using llama.cpp
 */

import type { ChatMessage, ChatRequest, ChatResponse, ModelServeConfig } from '@/types/ai-model';
import { getModelById, updateModelStatus, getServeStatus, updateServeStatus } from './ai-model-storage';
import { saveModel } from './ai-model-storage';
import { getPeerId, getRegistryUrl } from './swarm-client';
import { createHash } from 'crypto';
import { spawn, ChildProcess } from 'child_process';

// Store running inference processes
const runningProcesses = new Map<string, ChildProcess>();
const claimIntervals = new Map<string, NodeJS.Timer>();

/**
 * Start serving a model using llama.cpp server
 */
export async function startModelServer(config: ModelServeConfig): Promise<void> {
  const model = getModelById(config.modelId);
  
  if (!model) {
    throw new Error('Model not found');
  }
  if (!model.localPath) {
    throw new Error('Model file path not found');
  }
  
  if (model.status !== 'ready') {
    throw new Error('Model is not ready');
  }
  
  // Check if already serving
  const existingStatus = getServeStatus(config.modelId);
  if (existingStatus?.isServing) {
    throw new Error('Model is already being served');
  }
  
  const port = config.port || 8080;
  const host = config.host || '127.0.0.1';
  
  // Build llama.cpp server command
  const args = [
    '-m', model.localPath,
    '--host', host,
    '--port', String(port),
    '-c', String(config.contextSize || 2048),
    '-t', String(config.threads || 4),
  ];
  
  if (config.gpuLayers && config.gpuLayers > 0) {
    args.push('-ngl', String(config.gpuLayers));
  }
  
  // Try multiple paths for llama-server
  const envBin = (globalThis as any)?.process?.env?.LLAMA_SERVER_BIN;
  let bin = envBin || 'llama-server';
  
  // Check common install locations if default fails
  const { existsSync } = await import('fs');
  const fallbackPaths = [
    '/opt/homebrew/bin/llama-server',
    '/usr/local/bin/llama-server',
    `${process.env.HOME}/.dial-ai/.deps/llama.cpp/llama-server`,
  ];
  
  if (!envBin) {
    for (const path of fallbackPaths) {
      if (existsSync(path)) {
        bin = path;
        console.log(`[Inference] Found llama-server at ${bin}`);
        break;
      }
    }
  }
  console.log(`[Inference] Starting llama.cpp server for ${config.modelId}`);
  console.log(`[Inference] Command: ${bin} ${args.join(' ')}`);
  
  // Start llama.cpp server process
  const serverProc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  
  runningProcesses.set(config.modelId, serverProc);
  
  // Handle process output
  serverProc.stdout?.on('data', (data: Buffer) => {
    console.log(`[Inference ${config.modelId}] ${data.toString().trim()}`);
  });
  
  serverProc.stderr?.on('data', (data: Buffer) => {
    console.error(`[Inference ${config.modelId}] ${data.toString().trim()}`);
  });
  
  serverProc.on('exit', (code: number | null) => {
    console.log(`[Inference] Server exited for ${config.modelId} with code ${code}`);
    runningProcesses.delete(config.modelId);
    updateModelStatus(config.modelId, 'ready');
    updateServeStatus({
      modelId: config.modelId,
      isServing: false,
    });
    // Release serve claim and stop refresher
    try {
      const timer = claimIntervals.get(config.modelId);
      if (timer) { clearInterval(timer as any); claimIntervals.delete(config.modelId); }
      const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
      const peerId = getPeerId(base);
      const m = getModelById(config.modelId);
      if (m) {
        const codeStr = m.infoHash
          ? String(m.infoHash).slice(0,7).toLowerCase()
          : createHash('sha1').update(m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id).digest('hex').slice(0,7).toLowerCase();
        const registry = getRegistryUrl(base);
        fetch(`${registry}/api/swarm/claim?code=${encodeURIComponent(codeStr)}&peerId=${encodeURIComponent(peerId)}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      }
    } catch {}
  });
  
  // Poll health until server is ready (max ~20s)
  const startedAt = Date.now();
  const healthUrl = `http://${host}:${port}/health`;
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) { healthy = true; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  if (!healthy) {
    console.error(`[Inference] Health check failed for ${config.modelId} on ${host}:${port}`);
    try { serverProc.kill('SIGKILL'); } catch {}
    updateModelStatus(config.modelId, 'ready');
    updateServeStatus({ modelId: config.modelId, isServing: false });
    throw new Error('Model server failed to start');
  }

  // Mark serving only after health is OK
  updateModelStatus(config.modelId, 'serving');
  updateServeStatus({
    modelId: config.modelId,
    isServing: true,
    port,
    host,
    startedAt,
    requestCount: 0,
    errorCount: 0,
  });
  console.log(`[Inference] Server started for ${config.modelId} on ${host}:${port}`);

  // Maintain a serve-claim while serving to avoid duplicates across peers
  try {
    const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const peerId = getPeerId(base);
    const registry = getRegistryUrl(base);
    const m = getModelById(config.modelId);
    if (m) {
      const code = m.infoHash
        ? String(m.infoHash).slice(0,7).toLowerCase()
        : createHash('sha1').update(m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id).digest('hex').slice(0,7).toLowerCase();
      // Immediately claim and then refresh periodically
      const claimOnce = async () => {
        try {
          await fetch(`${registry}/api/swarm/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, peerId, ttlMs: 60000 }),
            signal: AbortSignal.timeout(4000),
          });
        } catch {}
      };
      await claimOnce();
      const timer = setInterval(() => { claimOnce(); }, 30000);
      claimIntervals.set(config.modelId, timer);
    }
  } catch {}

  // Optional: enable file seeding only if explicitly requested
  if (process.env.ENABLE_TORRENTS === '1') {
    try {
      if (!model.infoHash && model.localPath) {
        const { createModelTorrent } = await import('./ai-torrent-manager');
        const { magnetUri, infoHash } = await createModelTorrent(config.modelId, model.localPath);
        const updated = getModelById(config.modelId);
        if (updated) {
          (updated as any).magnetUri = magnetUri;
          (updated as any).infoHash = infoHash;
          saveModel(updated);
          console.log(`[Inference] Seeding enabled for ${config.modelId}`);
        }
      }
    } catch (err) {
      console.warn('[Inference] Failed to enable seeding:', err);
    }
  }
}

/**
 * Stop serving a model
 */
export async function stopModelServer(modelId: string): Promise<void> {
  const process = runningProcesses.get(modelId);
  
  if (!process) {
    throw new Error('Model server is not running');
  }
  
  return new Promise((resolve, reject) => {
    process.on('exit', () => {
      runningProcesses.delete(modelId);
      updateModelStatus(modelId, 'ready');
      updateServeStatus({
        modelId,
        isServing: false,
      });
      resolve();
    });
    
    process.kill('SIGTERM');
    
    // Force kill after 5 seconds
    setTimeout(() => {
      if (runningProcesses.has(modelId)) {
        process.kill('SIGKILL');
        reject(new Error('Failed to stop server gracefully'));
      }
    }, 5000);
  });
}

/**
 * Chat with a model
 */
export async function chat(request: ChatRequest): Promise<ChatResponse> {
  const serveStatus = getServeStatus(request.modelId);
  
  if (!serveStatus?.isServing) {
    throw new Error('Model is not being served');
  }
  
  const url = `http://${serveStatus.host}:${serveStatus.port}/v1/chat/completions`;
  
  const payload = {
    messages: request.messages,
    max_tokens: request.maxTokens || 512,
    temperature: request.temperature || 0.7,
    stream: request.stream || false,
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`Inference failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Update request count
    const status = getServeStatus(request.modelId);
    if (status) {
      updateServeStatus({
        ...status,
        requestCount: (status.requestCount || 0) + 1,
      });
    }
    
    return {
      content: data.choices[0]?.message?.content || '',
      finishReason: data.choices[0]?.finish_reason,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
    };
  } catch (err) {
    // Update error count
    const status = getServeStatus(request.modelId);
    if (status) {
      updateServeStatus({
        ...status,
        errorCount: (status.errorCount || 0) + 1,
      });
    }
    
    throw err;
  }
}

/**
 * Simple text completion (non-chat)
 */
export async function complete(
  modelId: string,
  prompt: string,
  maxTokens: number = 256
): Promise<string> {
  const serveStatus = getServeStatus(modelId);
  
  if (!serveStatus?.isServing) {
    throw new Error('Model is not being served');
  }
  
  const url = `http://${serveStatus.host}:${serveStatus.port}/completion`;
  
  const payload = {
    prompt,
    n_predict: maxTokens,
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    throw new Error(`Completion failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.content || '';
}

/**
 * Check if a model server is healthy
 */
export async function checkServerHealth(modelId: string): Promise<boolean> {
  const serveStatus = getServeStatus(modelId);
  
  if (!serveStatus?.isServing) {
    return false;
  }
  
  try {
    const url = `http://${serveStatus.host}:${serveStatus.port}/health`;
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    
    return response.ok;
  } catch (err) {
    return false;
  }
}

/**
 * Generate the next token (best-effort) using llama.cpp completion with n_predict=1.
 */
export async function nextToken(modelId: string, prompt: string, temperature: number = 0.7): Promise<string> {
  const serveStatus = getServeStatus(modelId);
  if (!serveStatus?.isServing) {
    throw new Error('Model is not being served');
  }
  const url = `http://${serveStatus.host}:${serveStatus.port}/completion`;
  const payload = {
    prompt,
    n_predict: 1,
    temperature,
  } as any;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Next token failed: ${response.statusText}`);
  }
  const data = await response.json();
  const token: string = data?.content || '';
  return token;
}
