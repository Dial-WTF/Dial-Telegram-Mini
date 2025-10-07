from __future__ import annotations

import time
from typing import Optional
import os

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from .crypto import generate_identity, sign, load_or_create_identity
from .dht_sync import DHTSync


class GenerateRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 256
    temperature: float = 0.7


class GenerateResponse(BaseModel):
    text: str
    input_tokens: int
    output_tokens: int
    wall_time_ms: int


class SignReceiptRequest(BaseModel):
    payload: dict | None = None
    # accept passthrough fields


def build_app(
    model_path: str,
    gateway_url: str | None = None,
    public_name: str | None = None,
    host: str = "0.0.0.0",
    port: int = 8090,
    identity_path: str | None = None,
    dht_peers: list[str] | None = None,
) -> FastAPI:
    app = FastAPI(title="Glyph Node")
    node_pk, node_sk = (
        load_or_create_identity(identity_path) if identity_path else generate_identity()
    )
    dht: DHTSync | None = None
    try:
        if dht_peers is not None:
            dht = DHTSync(initial_peers=dht_peers, start=True)
    except Exception:
        dht = None

    def _load_model_and_tokenizer(path_or_id: str):
        tok = AutoTokenizer.from_pretrained(path_or_id, trust_remote_code=True)
        mdl = AutoModelForCausalLM.from_pretrained(
            path_or_id,
            torch_dtype=torch.bfloat16,
            trust_remote_code=True,
        )
        if tok.pad_token_id is None and tok.eos_token_id is not None:
            tok.pad_token_id = tok.eos_token_id
        return tok, mdl

    try:
        tokenizer, model = _load_model_and_tokenizer(model_path)
    except Exception:
        # Fallback: download from hub if local files are corrupted or incomplete
        try:
            from huggingface_hub import snapshot_download

            repo_id = model_path if not os.path.isdir(model_path) else "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B"
            local_dir = model_path if os.path.isdir(model_path) else os.path.join(os.getcwd(), "DeepSeek-R1-Distill-Qwen-1.5B")
            snapshot_download(repo_id=repo_id, local_dir=local_dir, local_dir_use_symlinks=False)
            tokenizer, model = _load_model_and_tokenizer(local_dir)
        except Exception as e:
            raise RuntimeError(f"Failed to load model: {e}")

    if torch.cuda.is_available():
        model = model.to("cuda")
    elif torch.backends.mps.is_available():
        model = model.to("mps")
    
    # Optional self-registration with gateway
    if gateway_url:
        import requests
        try:
            requests.post(
                f"{gateway_url}/register",
                json={
                    "public_name": public_name or "glyph-node",
                    "node_url": f"http://{host}:{port}",
                    "node_pubkey": node_pk,
                },
                timeout=10,
            )
        except Exception:
            pass

    @app.post("/generate")
    def generate(req: GenerateRequest) -> GenerateResponse:
        t0 = time.time()
        inputs = tokenizer(req.prompt, return_tensors="pt").to(model.device)
        input_tokens = inputs.input_ids.shape[1]
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=req.max_new_tokens,
                do_sample=True,
                temperature=req.temperature,
                pad_token_id=tokenizer.eos_token_id,
            )
        text = tokenizer.decode(out[0], skip_special_tokens=True)
        wall = int((time.time() - t0) * 1000)
        output_tokens = out.shape[1] - input_tokens
        return GenerateResponse(text=text, input_tokens=input_tokens, output_tokens=output_tokens, wall_time_ms=wall)

    @app.get("/health")
    def health():
        return {"ok": True, "device": str(model.device)}

    @app.post("/sign_receipt")
    def sign_receipt(receipt: dict):
        # mutate provided dict to attach node signature on the payload (without signatures)
        import copy, json

        data = copy.deepcopy(receipt)
        data.pop("gateway_sig", None)
        data.pop("node_sig", None)
        payload = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        node_sig = sign(node_sk, payload)
        return {"node_sig": node_sig, "node_pubkey": node_pk}

    return app


def main(
    model: str,
    host: str = "0.0.0.0",
    port: int = 8090,
    gateway: str | None = None,
    public_name: str | None = None,
    identity: str | None = None,
    dht_peer: list[str] | None = None,
):
    import uvicorn

    app = build_app(
        model,
        gateway_url=gateway,
        public_name=public_name,
        host=host,
        port=port,
        identity_path=identity,
        dht_peers=dht_peer,
    )
    uvicorn.run(app, host=host, port=port)


