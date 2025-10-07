# Decentralized AI System

A peer-to-peer AI model distribution and inference system integrated with the Telegram bot.

## Overview

This system allows users to:
- Download AI models from HuggingFace via BitTorrent-style P2P distribution
- Serve models locally for inference
- Chat with AI models directly in Telegram
- Share bandwidth with other users (automatic seeding)

## Architecture

### Components

1. **Model Storage** (`src/lib/ai-model-storage.ts`)
   - In-memory model metadata management
   - Status tracking (downloading, ready, serving, error)
   - P2P statistics (peers, upload/download bytes)

2. **Torrent Manager** (`src/lib/ai-torrent-manager.ts`)
   - WebTorrent integration for P2P file sharing
   - Automatic seeding after download
   - Progress tracking and peer management

3. **HuggingFace Integration** (`src/lib/ai-huggingface.ts`)
   - Model metadata fetching
   - Direct HTTP downloads from HuggingFace
   - Automatic torrent creation for downloaded models

4. **Model Manager** (`src/lib/ai-model-manager.ts`)
   - Coordinated download orchestration
   - Support for both HuggingFace and magnet URIs
   - Model lifecycle management

5. **Inference Engine** (`src/lib/ai-inference.ts`)
   - llama.cpp server integration
   - OpenAI-compatible API
   - Multi-model serving support

6. **Chat Sessions** (`src/lib/ai-chat-session.ts`)
   - Multi-turn conversation management
   - Session timeout handling
   - Per-user conversation history

## Telegram Bot Commands

### Model Management

#### `/ai <huggingface_url>`
Download a model from HuggingFace and create a torrent for P2P sharing.

**Example:**
```
/ai https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B
```

**Features:**
- Downloads the largest model file automatically
- Creates magnet link for P2P sharing
- Progress tracking with peer count

#### `/ai-list`
List all downloaded models with their status.

**Shows:**
- Model name and ID
- Download progress (for downloading models)
- Size and format
- Serving status
- P2P stats (peers, uploaded/downloaded bytes)

#### `/ai-serve <model_id>`
Start serving a model for inference.

**Example:**
```
/ai-serve deepseek-ai_DeepSeek-R1-Distill-Qwen-1.5B
```

**Options:**
- Default context size: 2048 tokens
- Default threads: 4
- GPU layers: 0 (CPU only, configure in API call)

#### `/ai-stop <model_id>`
Stop serving a model.

**Example:**
```
/ai-stop deepseek-ai_DeepSeek-R1-Distill-Qwen-1.5B
```

### Chat Interface

#### `/ai`
Start chatting with an AI model (shows inline keyboard with serving models).

**Flow:**
1. Run `/ai` to see available models
2. Select a model from the inline keyboard
3. Start typing messages to chat
4. All messages are sent to the selected model
5. Use `/ai-clear` to end the session

#### `/ai-clear`
Clear the current chat session and conversation history.

#### `/ai-help`
Show comprehensive help for all AI commands.

## API Routes

### POST `/api/ai/download`
Download a model from HuggingFace or magnet URI.

**Body:**
```json
{
  "url": "https://huggingface.co/model/repo",
  "fileName": "optional-specific-file.gguf",
  "createTorrent": true
}
```

**Or:**
```json
{
  "magnetUri": "magnet:?xt=urn:btih:...",
  "metadata": {
    "name": "Model Name",
    "size": 1000000
  }
}
```

### GET `/api/ai/list`
Get all models with their status.

**Response:**
```json
{
  "ok": true,
  "result": [
    {
      "id": "model_id",
      "name": "Model Name",
      "status": "ready",
      "downloadProgress": 100,
      "size": 1000000,
      "peers": 5,
      "magnetUri": "magnet:?xt=...",
      ...
    }
  ]
}
```

### POST `/api/ai/serve`
Start serving a model.

**Body:**
```json
{
  "modelId": "model_id",
  "port": 8080,
  "contextSize": 2048,
  "threads": 4,
  "gpuLayers": 0
}
```

### DELETE `/api/ai/serve?modelId=<model_id>`
Stop serving a model.

### POST `/api/ai/chat`
Chat with a served model.

**Body:**
```json
{
  "modelId": "model_id",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "maxTokens": 512,
  "temperature": 0.7
}
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "content": "AI response...",
    "usage": {
      "promptTokens": 10,
      "completionTokens": 50,
      "totalTokens": 60
    }
  }
}
```

## Setup

### Prerequisites

1. **llama.cpp server**
   ```bash
   # Install llama.cpp with server support
   git clone https://github.com/ggerganov/llama.cpp
   cd llama.cpp
   make llama-server
   
   # Add to PATH or symlink
   sudo ln -s $(pwd)/llama-server /usr/local/bin/llama-server
   ```

2. **Node.js dependencies**
   ```bash
   pnpm install webtorrent
   ```

3. **Storage directories**
   ```bash
   mkdir -p models torrents
   ```

### Environment Variables

Add to `.env`:

```bash
# AI Model Storage
AI_MODEL_DIR=./models
AI_TORRENT_DIR=./torrents

# Optional: GPU support
LLAMA_CUBLAS=1
```

### Usage Flow

1. **Download a model:**
   ```
   /ai https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF
   ```

2. **Wait for download** (check progress):
   ```
   /ai-list
   ```

3. **Start serving:**
   ```
   /ai-serve TheBloke_Llama-2-7B-Chat-GGUF
   ```

4. **Chat with it:**
   ```
   /ai
   [Select model from keyboard]
   Hello, how are you?
   ```

## P2P Features

### BitTorrent-Style Distribution

- **Automatic Seeding**: Downloaded models are automatically shared via WebTorrent
- **Peer Discovery**: Uses DHT, LSD, and WebSeeds for peer discovery
- **Resume Support**: Interrupted downloads can be resumed
- **Bandwidth Sharing**: Upload speeds contribute to the network

### Statistics

Each model tracks:
- **Downloaded Bytes**: Total data received
- **Uploaded Bytes**: Total data shared with peers
- **Active Peers**: Current peer count
- **Share Ratio**: Uploaded/Downloaded ratio

### Magnet Links

Models can be shared via magnet URIs:
```
magnet:?xt=urn:btih:[INFO_HASH]&dn=[MODEL_NAME]
```

Use `/ai-list` to see magnet links for downloaded models.

## Performance Considerations

### Model Sizes
- **Small models** (1-3GB): Fast download, suitable for CPU inference
- **Medium models** (3-7GB): Slower download, CPU or GPU inference
- **Large models** (7GB+): Very slow download, GPU recommended

### Inference Speed
- **CPU**: 1-10 tokens/sec (varies by model size)
- **GPU**: 10-100+ tokens/sec (varies by GPU)

### Storage
- Models are stored in `./models/` by default
- Ensure sufficient disk space (models can be 1-20GB each)

## Troubleshooting

### Download Stuck
```
/ai-list  # Check status
```
If stuck at 0%, ensure firewall allows P2P connections.

### Server Won't Start
Check if `llama-server` is installed:
```bash
which llama-server
```

### Out of Memory
Reduce context size:
```json
{
  "contextSize": 512,
  "threads": 2
}
```

### No Peers
- Initial HuggingFace download creates the first seed
- More users = more peers = faster downloads
- Share magnet links to increase peer count

## Security Notes

1. **Local Inference**: All inference runs locally, no data leaves your machine
2. **P2P Privacy**: IP addresses are visible to peers (use VPN if concerned)
3. **Model Verification**: Verify model sources before downloading
4. **Resource Limits**: Set CPU/memory limits for llama-server processes

## Future Enhancements

- [ ] Model verification (checksums, signatures)
- [ ] DHT bootstrap nodes for faster peer discovery
- [ ] GPU auto-detection and configuration
- [ ] Model quantization support
- [ ] Multi-model routing
- [ ] Web UI for model management
- [ ] Distributed inference across multiple nodes
