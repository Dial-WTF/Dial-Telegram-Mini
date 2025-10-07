#!/bin/bash

# Enhanced setup script for Decentralized AI System
# Supports one-command install incl. llama.cpp build into ./.deps

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

AUTO=0
GPU=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto)
      AUTO=1
      shift
      ;;
    --gpu)
      GPU=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

echo "Setting up Decentralized AI System..."

OS=$(uname -s)
ARCH=$(uname -m)
echo "OS: $OS  ARCH: $ARCH"

ensure_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo -e "${RED}Missing dependency: $1"; return 1
  fi
  echo -e "${GREEN}$1 found"
}

install_brew_pkg() {
  local pkg="$1"
  if command -v brew >/dev/null 2>&1; then
    if ! brew list "$pkg" >/dev/null 2>&1; then
      echo "Installing $pkg via Homebrew..."
      brew install "$pkg"
    fi
  fi
}

install_apt_pkg() {
  local pkg="$1"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y "$pkg"
  fi
}

echo "Checking Node.js..."
if ! ensure_cmd node; then
  echo -e "${RED}Please install Node.js 18+ and re-run${NC}"
  exit 1
fi

echo "Checking pnpm..."
if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${YELLOW}Installing pnpm globally"
  npm install -g pnpm
else
  echo -e "${GREEN}pnpm $(pnpm -v)"
fi

echo "Detecting project directory..."
# Priority: env var > current dir if package.json exists
PROJECT_DIR=""
if [ -n "$DIAL_AI_PROJECT_ROOT" ] && [ -f "$DIAL_AI_PROJECT_ROOT/package.json" ]; then
  PROJECT_DIR="$DIAL_AI_PROJECT_ROOT"
elif [ -f "package.json" ]; then
  PROJECT_DIR="$(pwd)"
fi

if [ -n "$PROJECT_DIR" ]; then
  echo "Project detected at: $PROJECT_DIR"
  echo "Installing Node.js dependencies with pnpm..."
  (cd "$PROJECT_DIR" && pnpm install)
else
  echo "No Node project detected (no package.json). Skipping pnpm install."
  echo "You can set DIAL_AI_PROJECT_ROOT to your project path to enable dependency installation."
fi

echo "Preparing install locations..."
INSTALL_BASE="$HOME/.dial-ai"
mkdir -p "$INSTALL_BASE"

if [ -n "$PROJECT_DIR" ]; then
  mkdir -p "$PROJECT_DIR/models" "$PROJECT_DIR/torrents"
  echo -e "${GREEN}Project storage at ${PROJECT_DIR}/{models,torrents}"
else
  mkdir -p "$INSTALL_BASE/models" "$INSTALL_BASE/torrents"
  echo -e "${GREEN}User storage at ${INSTALL_BASE}/{models,torrents}"
fi

echo "Ensuring build tools (cmake, git)..."
case "$OS" in
  Darwin)
    install_brew_pkg cmake || true
    install_brew_pkg git || true
    ;;
  Linux)
    install_apt_pkg build-essential || true
    install_apt_pkg cmake || true
    install_apt_pkg git || true
    ;;
esac

echo "Setting up llama.cpp (llama-server)..."
LLAMA_DIR="$INSTALL_BASE/.deps/llama.cpp"
mkdir -p "$(dirname "$LLAMA_DIR")"
if [ ! -d "$LLAMA_DIR" ]; then
  echo "Cloning llama.cpp..."
  git clone --depth=1 https://github.com/ggerganov/llama.cpp "$LLAMA_DIR"
fi

pushd "$LLAMA_DIR" >/dev/null
echo "Building llama-server..."
if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
  echo "Detected Apple Silicon. Building with Metal..."
  make -j llama-server LLAMA_METAL=1
else
  if [ "$GPU" = "1" ]; then
    echo "GPU flag set. Attempting CUDA build (requires CUDA toolkit)..."
    make -j llama-server LLAMA_CUBLAS=1 || { echo -e "${YELLOW}! CUDA build failed, falling back to CPU"; make -j llama-server; }
  else
    make -j llama-server
  fi
fi

LLAMA_BIN_PATH="$LLAMA_DIR/llama-server"
echo -e "${GREEN}Built llama-server at ${LLAMA_BIN_PATH}"

echo "Checking .env configuration..."
# Decide where to write env: project .env or user-level ~/.dial-ai/.env
ENV_TARGET=""
if [ -n "$PROJECT_DIR" ]; then
  ENV_TARGET="$PROJECT_DIR/.env"
  if [ ! -f "$ENV_TARGET" ]; then
    if [ -f "$PROJECT_DIR/.env.example" ]; then
      cp "$PROJECT_DIR/.env.example" "$ENV_TARGET"
      echo -e "${GREEN}✓${NC} Created .env from .env.example in project"
    else
      echo -e "${YELLOW}!${NC} .env.example not found; creating minimal .env in project"
      touch "$ENV_TARGET"
    fi
  fi
else
  mkdir -p "$INSTALL_BASE"
  ENV_TARGET="$INSTALL_BASE/.env"
  if [ ! -f "$ENV_TARGET" ]; then
    echo "Creating user-level env at $ENV_TARGET"
    touch "$ENV_TARGET"
  fi
fi

ensure_env_kv() {
  local key="$1"; shift
  local val="$1"; shift
  if grep -q "^${key}=" "$ENV_TARGET"; then
    if [ "$OS" = "Darwin" ]; then
      sed -i '' "s|^${key}=.*$|${key}=${val}|" "$ENV_TARGET"
    else
      sed -i "s|^${key}=.*$|${key}=${val}|" "$ENV_TARGET"
    fi
  else
    echo "${key}=${val}" >> "$ENV_TARGET"
  fi
}

if [ -n "$PROJECT_DIR" ]; then
  ensure_env_kv AI_MODEL_DIR "$PROJECT_DIR/models"
  ensure_env_kv AI_TORRENT_DIR "$PROJECT_DIR/torrents"
else
  ensure_env_kv AI_MODEL_DIR "$INSTALL_BASE/models"
  ensure_env_kv AI_TORRENT_DIR "$INSTALL_BASE/torrents"
fi
ensure_env_kv LLAMA_SERVER_BIN "$LLAMA_BIN_PATH"

echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}Setup Complete!${NC}"
echo "═══════════════════════════════════════════════════"
echo "Storage:"
if [ -n "$PROJECT_DIR" ]; then
  echo "  $PROJECT_DIR/models"
  echo "  $PROJECT_DIR/torrents"
else
  echo "  $INSTALL_BASE/models"
  echo "  $INSTALL_BASE/torrents"
fi
echo "llama-server: $LLAMA_BIN_PATH"
echo "Env file: $ENV_TARGET (AI_MODEL_DIR, AI_TORRENT_DIR, LLAMA_SERVER_BIN)"
echo ""
echo "To run the app: pnpm dev"
echo ""
echo "Quick test (after starting server): /ai <hf_url> -> /ai-list -> /ai"

echo ""
echo "NEXT STEPS (in Telegram):"
echo "  1) Return to the bot chat."
echo "  2) Tap 'I ran the installer'."
echo "  3) Tap 'Download DeepSeek' (recommended) OR send:" 
echo "     /ai https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
echo "  4) Use /ai-list to watch download progress."
echo "  5) Use /ai to open the chat selector and start 'Serve & Chat'."
