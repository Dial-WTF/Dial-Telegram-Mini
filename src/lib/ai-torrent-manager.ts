/**
 * P2P Torrent Manager for AI Models
 * 
 * BitTorrent-style distribution using WebTorrent
 */

import type { TorrentStats } from '@/types/ai-model';
import { updateModelProgress, updateModelUploadStats, updateModelStatus } from './ai-model-storage';

// Lazy-load WebTorrent to avoid build-time issues
let WebTorrent: any = null;

async function getWebTorrent() {
  if (!WebTorrent) {
    try {
      // Use dynamic import for Node.js environment
      const module = await import('webtorrent');
      WebTorrent = module.default || module;
    } catch (err) {
      console.error('Failed to load WebTorrent:', err);
      throw new Error('WebTorrent not available');
    }
  }
  return WebTorrent;
}

// Global WebTorrent client instance
let client: any = null;

/**
 * Get or create WebTorrent client
 */
export async function getTorrentClient(): Promise<any> {
  if (client) return client;
  
  const WT = await getWebTorrent();
  client = new WT({
    maxConns: 100,
    dht: true,
    lsd: true,
    webSeeds: true,
  });
  
  return client;
}

/**
 * Download model via torrent
 */
export async function downloadModelTorrent(
  modelId: string,
  magnetUri: string,
  downloadPath: string,
  onProgress?: (progress: number, downloadSpeed: number, peers: number) => void
): Promise<string> {
  const client = await getTorrentClient();
  
  return new Promise((resolve, reject) => {
    const torrent = client.add(magnetUri, {
      path: downloadPath,
    });
    
    torrent.on('error', (err: Error) => {
      console.error(`[Torrent] Error for model ${modelId}:`, err);
      updateModelStatus(modelId, 'error');
      reject(err);
    });
    
    torrent.on('warning', (err: Error) => {
      console.warn(`[Torrent] Warning for model ${modelId}:`, err);
    });
    
    // Progress updates
    const progressInterval = setInterval(() => {
      const progress = Math.round(torrent.progress * 100);
      const downloadSpeed = torrent.downloadSpeed;
      const peers = torrent.numPeers;
      
      updateModelProgress(modelId, progress, torrent.downloaded, peers);
      updateModelUploadStats(modelId, torrent.uploaded, torrent.numPeers);
      
      if (onProgress) {
        onProgress(progress, downloadSpeed, peers);
      }
      
      console.log(
        `[Torrent] ${modelId}: ${progress}% | ` +
        `DL: ${formatSpeed(downloadSpeed)} | ` +
        `UL: ${formatSpeed(torrent.uploadSpeed)} | ` +
        `Peers: ${peers}`
      );
    }, 2000);
    
    torrent.on('done', () => {
      clearInterval(progressInterval);
      updateModelProgress(modelId, 100, torrent.downloaded, torrent.numPeers);
      updateModelStatus(modelId, 'ready');
      
      console.log(`[Torrent] Model ${modelId} download complete`);
      console.log(`[Torrent] Downloaded: ${formatBytes(torrent.downloaded)}`);
      console.log(`[Torrent] Uploaded: ${formatBytes(torrent.uploaded)}`);
      console.log(`[Torrent] Ratio: ${(torrent.uploaded / torrent.downloaded).toFixed(2)}`);
      
      // Keep seeding after download
      console.log(`[Torrent] Continuing to seed ${modelId}...`);
      
      resolve(torrent.files[0]?.path || downloadPath);
    });
  });
}

/**
 * Create torrent from local model file
 */
export async function createModelTorrent(
  modelId: string,
  filePath: string,
  onSeed?: (magnetUri: string, infoHash: string) => void
): Promise<{ magnetUri: string; infoHash: string }> {
  const client = await getTorrentClient();
  
  return new Promise((resolve, reject) => {
    client.seed(filePath, (torrent: any) => {
      const magnetUri = torrent.magnetURI;
      const infoHash = torrent.infoHash;
      
      console.log(`[Torrent] Created torrent for ${modelId}`);
      console.log(`[Torrent] Magnet URI: ${magnetUri}`);
      console.log(`[Torrent] Info Hash: ${infoHash}`);
      
      if (onSeed) {
        onSeed(magnetUri, infoHash);
      }
      
      // Update upload stats periodically
      const uploadInterval = setInterval(() => {
        updateModelUploadStats(modelId, torrent.uploaded, torrent.numPeers);
        console.log(
          `[Torrent] Seeding ${modelId}: ` +
          `UL: ${formatSpeed(torrent.uploadSpeed)} | ` +
          `Peers: ${torrent.numPeers}`
        );
      }, 5000);
      
      torrent.on('error', (err: Error) => {
        clearInterval(uploadInterval);
        reject(err);
      });
      
      resolve({ magnetUri, infoHash });
    });
  });
}

/**
 * Get torrent stats
 */
export async function getTorrentStats(infoHash: string): Promise<TorrentStats | null> {
  const client = await getTorrentClient();
  const torrent = client.get(infoHash);
  
  if (!torrent) return null;
  
  return {
    infoHash: torrent.infoHash,
    magnetUri: torrent.magnetURI,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    peers: torrent.numPeers,
    seeders: torrent.numPeers, // WebTorrent doesn't distinguish
    files: torrent.files.map((f: any) => ({
      name: f.name,
      path: f.path,
      length: f.length,
      progress: f.progress,
    })),
  };
}

/**
 * Stop torrent (pause download/seed)
 */
export async function stopTorrent(infoHash: string): Promise<void> {
  const client = await getTorrentClient();
  const torrent = client.get(infoHash);
  
  if (torrent) {
    return new Promise((resolve) => {
      torrent.destroy(() => {
        console.log(`[Torrent] Stopped torrent: ${infoHash}`);
        resolve();
      });
    });
  }
}

/**
 * Resume torrent
 */
export async function resumeTorrent(
  modelId: string,
  magnetUri: string,
  downloadPath: string
): Promise<void> {
  console.log(`[Torrent] Resuming torrent for ${modelId}`);
  await downloadModelTorrent(modelId, magnetUri, downloadPath);
}

/**
 * Get all active torrents
 */
export async function getActiveTorrents(): Promise<TorrentStats[]> {
  const client = await getTorrentClient();
  
  if (!client || !client.torrents) return [];
  
  return client.torrents.map((torrent: any) => ({
    infoHash: torrent.infoHash,
    magnetUri: torrent.magnetURI,
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    peers: torrent.numPeers,
    seeders: torrent.numPeers,
    files: torrent.files.map((f: any) => ({
      name: f.name,
      path: f.path,
      length: f.length,
      progress: f.progress,
    })),
  }));
}

/**
 * Destroy torrent client
 */
export async function destroyTorrentClient(): Promise<void> {
  if (!client) return;
  
  return new Promise((resolve) => {
    client.destroy(() => {
      console.log('[Torrent] Client destroyed');
      client = null;
      resolve();
    });
  });
}

// Helper functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
