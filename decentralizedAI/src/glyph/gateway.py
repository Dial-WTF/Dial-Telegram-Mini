from __future__ import annotations

import asyncio
import uuid
from typing import Dict, Optional, List

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .crypto import generate_identity, load_or_create_identity
from .dht_sync import DHTSync
from .reward_minter import RewardMinter
from .ledger import Ledger
from .receipt import UsageReceipt


class RegisterRequest(BaseModel):
    public_name: str
    node_url: str  # http endpoint the gateway can call, e.g. http://ip:port
    node_pubkey: str


class InferenceRequest(BaseModel):
    prompt: str
    max_new_tokens: int = 256
    temperature: float = 0.7
    user_pubkey: str | None = None


class InferenceResult(BaseModel):
    text: str
    input_tokens: int
    output_tokens: int
    wall_time_ms: int


class AddressRequest(BaseModel):
    node_pubkey: str
    eth_address: str


class EpochPlan(BaseModel):
    token_ticker: str = "GLYPH"
    total_amount: int
    start_time: float | None = None
    end_time: float | None = None


def build_app(identity_path: str | None = None, dht_peers: list[str] | None = None) -> FastAPI:
    app = FastAPI(title="Glyph Gateway")
    gateway_pk, gateway_sk = (
        load_or_create_identity(identity_path) if identity_path else generate_identity()
    )
    nodes: Dict[str, Dict] = {}
    peers: List[str] = []  # list of peer gateway URLs
    rr_index = 0
    ledger = Ledger()
    dht: DHTSync | None = None
    minter = RewardMinter(ledger)
    # In-memory decentralized mint coordination (demo): proposals and signatures
    mint_proposals: Dict[str, Dict] = {}
    try:
        if dht_peers is not None:
            dht = DHTSync(initial_peers=dht_peers, start=True)
    except Exception:
        dht = None
    # Initialize quorum defaults (can be tuned via admin ops)
    if not ledger.list_validators():
        # by default trust this gateway only; users can add more validators via /validators/add
        # we derive a dummy public key from our gateway pubkey (for demo; in prod, load configured keys)
        ledger.add_validator(gateway_pk)
        ledger.set_quorum_threshold(1)

    @app.post("/register")
    async def register(req: RegisterRequest):
        nodes[req.node_pubkey] = {
            "name": req.public_name,
            "url": req.node_url,
            "pubkey": req.node_pubkey,
        }
        return {"ok": True}

    @app.post("/add_peer")
    async def add_peer(url: str):
        if url not in peers:
            peers.append(url)
        return {"ok": True, "peers": peers}

    @app.get("/peers")
    async def list_peers():
        return peers

    class PriceQuoteRequest(BaseModel):
        input_tokens: int
        output_tokens: int
        wall_time_ms: int | None = None

    @app.post("/price/quote")
    async def price_quote(req: PriceQuoteRequest):
        # aggregate recent asks from DHT to derive a fair market price
        base_mglyph_per_1k = 100
        try:
            if dht is not None:
                asks = dht.fetch_price_asks() or {}
                values = [a.get("milli_glyph_per_1k", base_mglyph_per_1k) for a in asks.values() if isinstance(a, dict)]
                if values:
                    # use median to resist outliers
                    values.sort()
                    mid = len(values) // 2
                    base_mglyph_per_1k = values[mid] if len(values) % 2 == 1 else (values[mid - 1] + values[mid]) // 2
        except Exception:
            pass
        in_cost = (req.input_tokens * base_mglyph_per_1k) // 1000
        out_cost = (req.output_tokens * base_mglyph_per_1k) // 1000
        time_cost = (max(req.wall_time_ms or 0, 0) * 1) // 1000  # 1 mGLYPH per second compute
        total_mglyph = int(in_cost + out_cost + time_cost)
        return {"milli_glyph": total_mglyph, "milli_glyph_per_1k": base_mglyph_per_1k}

    @app.post("/set_eth_address")
    async def set_eth_address(req: AddressRequest):
        """Set the Ethereum address for a node to receive ERC20 rewards."""
        try:
            ledger.set_node_address(req.node_pubkey, req.eth_address)
            return {"ok": True}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/inference")
    async def inference(req: InferenceRequest):
        if not nodes:
            raise HTTPException(status_code=503, detail="No nodes available")

        # round-robin across available nodes (basic multi-node support)
        nonlocal rr_index
        if not nodes:
            raise HTTPException(status_code=503, detail="No nodes available")
        node_list = list(nodes.values())
        node = node_list[rr_index % len(node_list)]
        rr_index += 1
        session_id = str(uuid.uuid4())

        # call node
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{node['url']}/generate",
                json=req.model_dump(),
            )
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Node failed: {r.text}")
            data = r.json()

        result = InferenceResult(**data)

        # If client is paying, compute price and debit before issuing receipt
        if req.user_pubkey:
            quote = await price_quote(
                PriceQuoteRequest(
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    wall_time_ms=result.wall_time_ms,
                )
            )
            mglyph = int(quote["milli_glyph"]) if isinstance(quote, dict) else 0
            try:
                ledger.debit_account(req.user_pubkey, mglyph, memo="inference", ref_id=session_id)
            except ValueError:
                raise HTTPException(status_code=402, detail="insufficient GLYPH balance")

        # issue receipt and ask node to countersign
        receipt = UsageReceipt.create(
            gateway_pubkey=gateway_pk,
            node_pubkey=node["pubkey"],
            session_id=session_id,
            route=node["pubkey"],
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            wall_time_ms=result.wall_time_ms,
        )
        receipt.sign_gateway(gateway_sk)

        async with httpx.AsyncClient(timeout=30) as client:
            rr = await client.post(f"{node['url']}/sign_receipt", json=receipt.__dict__)
            if rr.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Node did not countersign receipt: {rr.text}")
            signed = rr.json()
        receipt.node_sig = signed.get("node_sig")

        if not receipt.verify():
            raise HTTPException(status_code=500, detail="Invalid receipt after countersign")

        ledger.add(receipt)
        # market signal: publish local price ask
        try:
            if dht is not None:
                dht.publish_price_ask(
                    gateway_pk,
                    {
                        "milli_glyph_per_1k": 100,
                        "timestamp": __import__("time").time(),
                    },
                )
        except Exception:
            pass
        # publish to DHT best-effort
        try:
            if dht is not None:
                dht.publish_receipts([receipt.__dict__])
        except Exception:
            pass
        # Gossip to peers (best effort)
        async with httpx.AsyncClient(timeout=5) as client:
            for p in peers:
                try:
                    await client.post(f"{p}/gossip/receipts", json=[receipt.__dict__])
                except Exception:
                    pass
        return {"text": result.text}

    @app.get("/receipts")
    async def list_receipts():
        return [r.__dict__ for r in ledger.list()]

    @app.get("/nodes")
    async def list_nodes():
        addr_map = ledger.all_node_addresses()
        return [
            {**n, "has_eth_address": n["pubkey"] in addr_map, "eth_address": addr_map.get(n["pubkey"]) }
            for n in nodes.values()
        ]

    @app.post("/epoch/settle")
    async def settle_epoch(plan: EpochPlan):
        import time, json, hashlib

        # aggregate contributions
        # Weighted by quality (Proof-of-Intelligence validation scores)
        totals = ledger.aggregate_weighted_contributions(plan.start_time, plan.end_time)
        if not totals:
            return {"error": "no receipts in epoch"}

        # map to btc addresses; skip nodes without address
        addr_map = ledger.all_node_addresses()
        payouts = []
        sum_out = sum(totals.values())
        for node_pk, contrib in totals.items():
            addr = addr_map.get(node_pk)
            if not addr:
                continue
            amount = max(0, plan.total_amount * contrib // max(1, sum_out))
            payouts.append({"node_pubkey": node_pk, "eth_address": addr, "amount": int(amount)})

        epoch_id = f"{int(plan.start_time or 0)}-{int(plan.end_time or time.time())}-{plan.token_ticker}"
        snapshot = {
            "epoch_id": epoch_id,
            "created_at": time.time(),
            "start_time": plan.start_time,
            "end_time": plan.end_time,
            "token_ticker": plan.token_ticker,
            "total_amount": plan.total_amount,
            "payouts": payouts,
        }
        # merkle-like root over snapshot json
        payload = json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
        root = hashlib.sha256(payload).hexdigest()
        snapshot["root"] = root

        # sign with gateway identity
        from .crypto import sign

        snapshot["gateway_sig"] = sign(gateway_sk, payload)
        ledger.save_epoch(epoch_id, snapshot)
        try:
            if dht is not None:
                dht.publish_epoch(epoch_id, snapshot)
        except Exception:
            pass
        return snapshot

    # Gossip endpoints for decentralized replication
    @app.post("/gossip/receipts")
    async def gossip_receipts(items: List[dict]):
        """Accept a list of receipt dicts, validate signatures, store if new."""
        accepted = 0
        for d in items:
            try:
                r = UsageReceipt(**d)
                if not r.verify():
                    continue
                ledger.add(r)
                accepted += 1
            except Exception:
                continue
        return {"accepted": accepted}

    # Quorum signatures for epochs (validators co-sign snapshot root)
    class EpochSignRequest(BaseModel):
        epoch_id: str
        validator_pubkey: str
        signature: str

    @app.post("/epoch/sign")
    async def epoch_sign(req: EpochSignRequest):
        snap = ledger.get_epoch(req.epoch_id)
        if not snap:
            raise HTTPException(status_code=404, detail="epoch not found")
        # Verify validator is allowed (registered)
        if req.validator_pubkey not in ledger.list_validators():
            raise HTTPException(status_code=403, detail="validator not authorized")
        # Verify signature against payload
        import json
        from .crypto import verify

        payload = json.dumps(snap, sort_keys=True, separators=(",", ":")).encode()
        if not verify(req.validator_pubkey, payload, req.signature):
            raise HTTPException(status_code=400, detail="invalid signature")
        ledger.add_epoch_signature(req.epoch_id, req.validator_pubkey, req.signature)
        sigs = ledger.get_epoch_signatures(req.epoch_id)
        return {"ok": True, "signatures": sigs, "quorum": ledger.get_quorum_threshold()}

    # Admin endpoints for validator set (insecure demo: add auth in production)
    class ValidatorRequest(BaseModel):
        pubkey: str
        weight: float = 1.0

    @app.post("/validators/add")
    async def validators_add(v: ValidatorRequest):
        ledger.add_validator(v.pubkey, v.weight)
        return {"ok": True, "validators": ledger.get_validators()}

    @app.post("/validators/remove")
    async def validators_remove(v: ValidatorRequest):
        ledger.remove_validator(v.pubkey)
        return {"ok": True, "validators": ledger.get_validators()}

    @app.get("/epoch/status/{epoch_id}")
    async def epoch_status(epoch_id: str):
        snap = ledger.get_epoch(epoch_id)
        if not snap:
            raise HTTPException(status_code=404, detail="epoch not found")
        sigs = ledger.get_epoch_signatures(epoch_id)
        return {"snapshot": snap, "signatures": sigs, "quorum": ledger.get_quorum_threshold()}

    # Simple pull API to reconcile receipts from a given time (watermark)
    @app.get("/pull/receipts")
    async def pull_receipts(since: float = 0.0, limit: int = 200):
        return ledger.list_receipts_since(since, limit)

    # Basic validation endpoint to record quality scores (e.g., from independent validators)
    class QualityReport(BaseModel):
        receipt_id: str
        node_pubkey: str
        score: float  # 0..1

    @app.post("/validate/quality")
    async def validate_quality(rep: QualityReport):
        if rep.score < 0 or rep.score > 1:
            raise HTTPException(status_code=400, detail="score out of range")
        ledger.record_quality(rep.receipt_id, rep.node_pubkey, rep.score)
        return {"ok": True}

    # ERC20 Token configuration and minting endpoints
    @app.get("/config/token")
    async def get_token_config():
        return {
            "token_address": ledger.get_token_address(),
            "network": ledger.get_token_network(),
            "rpc_url": ledger.get_rpc_url()
        }

    class TokenConfigRequest(BaseModel):
        token_address: str
        network: str = "polygon"  # "polygon" | "base" | "arbitrum" | "ethereum"
        rpc_url: str | None = None

    @app.post("/config/token")
    async def set_token_config(req: TokenConfigRequest):
        """Configure the ERC20 token contract for rewards."""
        try:
            ledger.set_token_address(req.token_address)
            ledger.set_token_network(req.network)
            if req.rpc_url:
                ledger.set_rpc_url(req.rpc_url)
            return {"ok": True}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    class MintPreviewRequest(BaseModel):
        epoch_id: str

    @app.post("/mint/preview")
    async def mint_preview(req: MintPreviewRequest):
        """Preview the reward distribution for an epoch."""
        try:
            cfg = minter.get_config()
            payouts = minter.select_epoch_payouts(req.epoch_id)
            return {
                "epoch_id": req.epoch_id,
                "config": cfg,
                "payouts": [{"address": p.eth_address, "amount": p.amount} for p in payouts],
                "total_recipients": len(payouts)
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    class MintAnchorRequest(BaseModel):
        epoch_id: str
        txid: str

    @app.post("/mint/anchor")
    async def mint_anchor(req: MintAnchorRequest):
        """Record the transaction hash for an epoch mint."""
        if not ledger.get_epoch(req.epoch_id):
            raise HTTPException(status_code=404, detail="epoch not found")
        minter.anchor_epoch(req.epoch_id, req.txid)
        return {"ok": True}
    
    class MintExecuteRequest(BaseModel):
        epoch_id: str
        dry_run: bool = False
    
    @app.post("/mint/execute")
    async def mint_execute(req: MintExecuteRequest):
        """Execute the reward minting for an epoch (requires private key configured)."""
        try:
            tx_hash = minter.mint_rewards(req.epoch_id, dry_run=req.dry_run)
            return {"ok": True, "tx_hash": tx_hash}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.get("/token/supply")
    async def token_supply():
        """Get current token supply information."""
        try:
            return minter.get_token_supply()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Decentralized mint coordination (demo endpoints)
    class MintPSBTProposal(BaseModel):
        epoch_id: str
        epoch_root: str
        psbt_base64: str
        proposer_pubkey: str

    @app.post("/mint/propose_psbt")
    async def mint_propose_psbt(prop: MintPSBTProposal):
        import uuid
        snap = ledger.get_epoch(prop.epoch_id)
        if not snap:
            raise HTTPException(status_code=404, detail="epoch not found")
        if snap.get("root") != prop.epoch_root:
            raise HTTPException(status_code=400, detail="epoch root mismatch")
        pid = str(uuid.uuid4())
        mint_proposals[pid] = {
            "epoch_id": prop.epoch_id,
            "epoch_root": prop.epoch_root,
            "psbt_base64": prop.psbt_base64,
            "proposer_pubkey": prop.proposer_pubkey,
            "signatures": {},  # signer_pubkey -> partial signature blob (opaque)
            "created_at": __import__("time").time(),
        }
        # Best-effort gossip to peers
        async with httpx.AsyncClient(timeout=5) as client:
            for p in peers:
                try:
                    await client.post(f"{p}/gossip/mint_proposals", json=[{**mint_proposals[pid], "id": pid}])
                except Exception:
                    pass
        return {"ok": True, "proposal_id": pid}

    class MintPSBTSignature(BaseModel):
        proposal_id: str
        signer_pubkey: str
        signature: str  # opaque; PSBT partial or external scheme

    @app.post("/mint/submit_signature")
    async def mint_submit_signature(sig: MintPSBTSignature):
        prop = mint_proposals.get(sig.proposal_id)
        if not prop:
            raise HTTPException(status_code=404, detail="proposal not found")
        prop["signatures"][sig.signer_pubkey] = sig.signature
        return {"ok": True, "num_signatures": len(prop["signatures"]) }

    @app.get("/mint/proposals")
    async def list_mint_proposals():
        out = []
        for pid, p in mint_proposals.items():
            out.append({
                "id": pid,
                "epoch_id": p["epoch_id"],
                "epoch_root": p["epoch_root"],
                "proposer_pubkey": p["proposer_pubkey"],
                "num_signatures": len(p["signatures"]),
                "created_at": p["created_at"],
            })
        return out

    class GossipMintProposal(BaseModel):
        id: str
        epoch_id: str
        epoch_root: str
        psbt_base64: str
        proposer_pubkey: str
        signatures: Dict[str, str] | None = None
        created_at: float | None = None

    @app.post("/gossip/mint_proposals")
    async def gossip_mint_proposals(items: List[GossipMintProposal]):
        accepted = 0
        for item in items:
            if item.id in mint_proposals:
                continue
            snap = ledger.get_epoch(item.epoch_id)
            if not snap or snap.get("root") != item.epoch_root:
                continue
            mint_proposals[item.id] = {
                "epoch_id": item.epoch_id,
                "epoch_root": item.epoch_root,
                "psbt_base64": item.psbt_base64,
                "proposer_pubkey": item.proposer_pubkey,
                "signatures": item.signatures or {},
                "created_at": item.created_at or __import__("time").time(),
            }
            accepted += 1
        return {"accepted": accepted}


    return app


def main(host: str = "0.0.0.0", port: int = 8080, identity_path: str | None = None, dht_peer: list[str] | None = None):
    import uvicorn

    app = build_app(identity_path=identity_path, dht_peers=dht_peer)
    uvicorn.run(app, host=host, port=port)


