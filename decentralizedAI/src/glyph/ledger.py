from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import asdict
from typing import Iterable, List, Dict, Optional, Tuple
import hashlib

from .receipt import UsageReceipt


class Ledger:
    def __init__(self, path: str = "glyph_ledger.sqlite"):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        self._init()

    def _init(self) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS receipts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    receipt_id TEXT UNIQUE,
                    session_id TEXT,
                    node_pubkey TEXT,
                    gateway_pubkey TEXT,
                    payload TEXT,
                    gateway_sig TEXT,
                    node_sig TEXT,
                    created_at REAL,
                    prev_hash TEXT,
                    payload_hash TEXT,
                    chain_hash TEXT
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS accounts (
                    user_pubkey TEXT PRIMARY KEY,
                    balance INTEGER DEFAULT 0,
                    created_at REAL,
                    updated_at REAL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS account_txns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_pubkey TEXT,
                    delta_amount INTEGER,
                    kind TEXT,
                    memo TEXT,
                    ref_id TEXT,
                    created_at REAL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_pubkey TEXT,
                    amount INTEGER,
                    txid TEXT,
                    status TEXT,
                    created_at REAL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS node_addresses (
                    node_pubkey TEXT PRIMARY KEY,
                    eth_address TEXT NOT NULL,
                    created_at REAL,
                    updated_at REAL
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS epochs (
                    epoch_id TEXT PRIMARY KEY,
                    start_time REAL,
                    end_time REAL,
    token_ticker TEXT,
                    total_amount INTEGER,
                    root TEXT,
                    anchor_txid TEXT,
                    snapshot_payload TEXT,
                    gateway_sig TEXT,
                    created_at REAL,
                    finalized INTEGER DEFAULT 0
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS validators (
                    pubkey TEXT PRIMARY KEY,
                    weight REAL DEFAULT 1.0
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS epoch_signatures (
                    epoch_id TEXT,
                    pubkey TEXT,
                    signature TEXT,
                    PRIMARY KEY (epoch_id, pubkey)
                )
                """
            )
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS quality (
                    receipt_id TEXT PRIMARY KEY,
                    node_pubkey TEXT,
                    score REAL,
                    created_at REAL
                )
                """
            )
            db.commit()
            # Best-effort migrations for added columns
            try:
                cols = {r[1] for r in db.execute("PRAGMA table_info(epochs)").fetchall()}
                if "anchor_txid" not in cols:
                    db.execute("ALTER TABLE epochs ADD COLUMN anchor_txid TEXT")
                if "finalized" not in cols:
                    db.execute("ALTER TABLE epochs ADD COLUMN finalized INTEGER DEFAULT 0")
                db.commit()
            except Exception:
                pass
            try:
                cols = {r[1] for r in db.execute("PRAGMA table_info(receipts)").fetchall()}
                if "receipt_id" not in cols:
                    db.execute("ALTER TABLE receipts ADD COLUMN receipt_id TEXT")
                    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_rid ON receipts(receipt_id)")
                if "prev_hash" not in cols:
                    db.execute("ALTER TABLE receipts ADD COLUMN prev_hash TEXT")
                if "payload_hash" not in cols:
                    db.execute("ALTER TABLE receipts ADD COLUMN payload_hash TEXT")
                if "chain_hash" not in cols:
                    db.execute("ALTER TABLE receipts ADD COLUMN chain_hash TEXT")
                db.commit()
            except Exception:
                pass

    def add(self, receipt: UsageReceipt) -> None:
        assert receipt.verify(), "invalid receipt"
        rid = receipt.receipt_id()
        with sqlite3.connect(self.path) as db:
            payload = json.dumps(asdict(receipt))
            # compute append-only chain fields
            payload_hash = rid  # rid already hashes to_payload()
            prev_row = db.execute("SELECT chain_hash FROM receipts ORDER BY id DESC LIMIT 1").fetchone()
            prev_hash = prev_row[0] if prev_row and prev_row[0] else ""
            chain_hash = hashlib.sha256((prev_hash + payload_hash).encode()).hexdigest()
            db.execute(
                "INSERT OR IGNORE INTO receipts(receipt_id,session_id,node_pubkey,gateway_pubkey,payload,gateway_sig,node_sig,created_at,prev_hash,payload_hash,chain_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    rid,
                    receipt.session_id,
                    receipt.node_pubkey,
                    receipt.gateway_pubkey,
                    payload,
                    receipt.gateway_sig,
                    receipt.node_sig,
                    receipt.created_at,
                    prev_hash,
                    payload_hash,
                    chain_hash,
                ),
            )
            db.commit()

    def list(self) -> List[UsageReceipt]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute("SELECT payload FROM receipts ORDER BY id ASC").fetchall()
        return [UsageReceipt(**json.loads(r[0])) for r in rows]

    def verify_chain(self) -> bool:
        """Verify the append-only chain integrity across all receipts."""
        with sqlite3.connect(self.path) as db:
            rows = db.execute(
                "SELECT payload_hash, prev_hash, chain_hash FROM receipts ORDER BY id ASC"
            ).fetchall()
        prev = ""
        for payload_hash, prev_hash, chain_hash in rows:
            expected = hashlib.sha256((prev + payload_hash).encode()).hexdigest()
            if prev_hash != prev or chain_hash != expected:
                return False
            prev = expected
        return True

    def get_chain_head(self) -> Optional[str]:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT chain_hash FROM receipts ORDER BY id DESC LIMIT 1").fetchone()
        return row[0] if row else None

    # Node address registry
    def set_node_address(self, node_pubkey: str, eth_address: str) -> None:
        """Set the Ethereum address for a node (for ERC20 rewards)."""
        import time
        # Validate Ethereum address format
        if not self._is_valid_eth_address(eth_address):
            raise ValueError(f"Invalid Ethereum address: {eth_address}")
        now = time.time()
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT INTO node_addresses(node_pubkey, eth_address, created_at, updated_at) VALUES(?,?,?,?)\n                 ON CONFLICT(node_pubkey) DO UPDATE SET eth_address=excluded.eth_address, updated_at=excluded.updated_at",
                (node_pubkey, eth_address, now, now),
            )
            db.commit()
    
    def _is_valid_eth_address(self, address: str) -> bool:
        """Basic Ethereum address validation."""
        if not address or not isinstance(address, str):
            return False
        # Check if it starts with 0x and has 40 hex chars
        if not address.startswith('0x'):
            return False
        if len(address) != 42:
            return False
        try:
            int(address[2:], 16)
            return True
        except ValueError:
            return False

    def get_node_address(self, node_pubkey: str) -> Optional[str]:
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT eth_address FROM node_addresses WHERE node_pubkey=?", (node_pubkey,)
            ).fetchone()
        return row[0] if row else None

    def all_node_addresses(self) -> Dict[str, str]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute("SELECT node_pubkey, eth_address FROM node_addresses").fetchall()
        return {k: v for k, v in rows}

    # Epoch snapshots
    def save_epoch(self, epoch_id: str, payload: dict) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR REPLACE INTO epochs(epoch_id,start_time,end_time,rune_ticker,total_amount,root,anchor_txid,snapshot_payload,gateway_sig,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    epoch_id,
                    payload.get("start_time"),
                    payload.get("end_time"),
                    payload.get("token_ticker"),
                    payload.get("total_amount"),
                    payload.get("root"),
                    payload.get("anchor_txid"),
                    json.dumps(payload),
                    payload.get("gateway_sig"),
                    payload.get("created_at"),
                ),
            )
            db.commit()

    def get_epoch(self, epoch_id: str) -> Optional[dict]:
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT snapshot_payload FROM epochs WHERE epoch_id=?", (epoch_id,)
            ).fetchone()
        return json.loads(row[0]) if row else None

    # Aggregations
    def aggregate_contributions(self, start_time: Optional[float], end_time: Optional[float]) -> Dict[str, int]:
        """Return mapping node_pubkey -> total_output_tokens in [start_time, end_time]."""
        with sqlite3.connect(self.path) as db:
            q = "SELECT payload FROM receipts"
            params: Tuple = ()
            if start_time is not None and end_time is not None:
                q = (
                    "SELECT payload FROM receipts WHERE created_at>=? AND created_at<? ORDER BY id ASC"
                )
                params = (start_time, end_time)
            rows = db.execute(q, params).fetchall()
        totals: Dict[str, int] = {}
        for (p,) in rows:
            rec = json.loads(p)
            node = rec["node_pubkey"]
            out = int(rec.get("output_tokens", 0))
            totals[node] = totals.get(node, 0) + out
        return totals

    # Validators and quorum settings
    def add_validator(self, pubkey: str, weight: float = 1.0) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR REPLACE INTO validators(pubkey,weight) VALUES(?,?)",
                (pubkey, float(weight)),
            )
            db.commit()

    def remove_validator(self, pubkey: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute("DELETE FROM validators WHERE pubkey=?", (pubkey,))
            db.commit()

    def list_validators(self) -> List[str]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute("SELECT pubkey FROM validators").fetchall()
        return [r[0] for r in rows]

    def get_validators(self) -> List[Dict[str, float]]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute("SELECT pubkey, weight FROM validators").fetchall()
        return [{"pubkey": pk, "weight": wt} for pk, wt in rows]

    def set_quorum_threshold(self, threshold: int) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('quorum_threshold', ?)", (str(threshold),))
            db.commit()

    def get_quorum_threshold(self) -> int:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT value FROM settings WHERE key='quorum_threshold'").fetchone()
        return int(row[0]) if row else 1

    # Generic settings helpers
    def set_setting(self, key: str, value: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?, ?)", (key, value))
            db.commit()

    def get_setting(self, key: str) -> Optional[str]:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    # ERC20 Token configuration helpers
    def set_token_address(self, token_address: str) -> None:
        """Set the ERC20 token contract address."""
        if not self._is_valid_eth_address(token_address):
            raise ValueError(f"Invalid token address: {token_address}")
        self.set_setting("token_address", token_address)

    def get_token_address(self) -> Optional[str]:
        """Get the ERC20 token contract address."""
        return self.get_setting("token_address")

    def set_token_network(self, network: str) -> None:
        """Set the blockchain network (e.g., polygon, base, arbitrum, ethereum)."""
        self.set_setting("token_network", network)

    def get_token_network(self) -> str:
        """Get the blockchain network."""
        return self.get_setting("token_network") or "polygon"
    
    def set_rpc_url(self, rpc_url: str) -> None:
        """Set the RPC URL for the blockchain network."""
        self.set_setting("rpc_url", rpc_url)
    
    def get_rpc_url(self) -> Optional[str]:
        """Get the RPC URL for the blockchain network."""
        return self.get_setting("rpc_url")

    # Epoch signatures
    def add_epoch_signature(self, epoch_id: str, pubkey: str, signature: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR REPLACE INTO epoch_signatures(epoch_id,pubkey,signature) VALUES(?,?,?)",
                (epoch_id, pubkey, signature),
            )
            db.commit()

    def get_epoch_signatures(self, epoch_id: str) -> List[Dict[str, str]]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute(
                "SELECT pubkey, signature FROM epoch_signatures WHERE epoch_id=?", (epoch_id,)
            ).fetchall()
        return [{"pubkey": pk, "signature": sig} for pk, sig in rows]

    # Anchoring
    def set_epoch_anchor(self, epoch_id: str, txid: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE epochs SET anchor_txid=? WHERE epoch_id=?", (txid, epoch_id))
            db.commit()

    def set_epoch_finalized(self, epoch_id: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE epochs SET finalized=1 WHERE epoch_id=?", (epoch_id,))
            db.commit()

    def is_epoch_finalized(self, epoch_id: str) -> bool:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT finalized FROM epochs WHERE epoch_id=?", (epoch_id,)).fetchone()
        return bool(row and row[0])

    # Watermarks and pulls
    def get_latest_receipt_time(self) -> float:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT MAX(created_at) FROM receipts").fetchone()
        return float(row[0]) if row and row[0] is not None else 0.0

    def list_receipts_since(self, start_time: float, limit: int = 200) -> List[dict]:
        with sqlite3.connect(self.path) as db:
            rows = db.execute(
                "SELECT payload FROM receipts WHERE created_at>=? ORDER BY created_at ASC, id ASC LIMIT ?",
                (start_time, limit),
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    # Quality observations (validator/gateway replication checks)
    def record_quality(self, receipt_id: str, node_pubkey: str, score: float) -> None:
        import time
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR REPLACE INTO quality(receipt_id,node_pubkey,score,created_at) VALUES(?,?,?,?)",
                (receipt_id, node_pubkey, float(score), time.time()),
            )
            db.commit()

    def get_quality(self, receipt_id: str) -> Optional[float]:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT score FROM quality WHERE receipt_id=?", (receipt_id,)).fetchone()
        return float(row[0]) if row else None

    def aggregate_weighted_contributions(self, start_time: Optional[float], end_time: Optional[float]) -> Dict[str, float]:
        with sqlite3.connect(self.path) as db:
            q = "SELECT payload FROM receipts"
            params: Tuple = ()
            if start_time is not None and end_time is not None:
                q = (
                    "SELECT payload FROM receipts WHERE created_at>=? AND created_at<? ORDER BY id ASC"
                )
                params = (start_time, end_time)
            rows = db.execute(q, params).fetchall()
        totals: Dict[str, float] = {}
        for (p,) in rows:
            rec = json.loads(p)
            node = rec["node_pubkey"]
            out = int(rec.get("output_tokens", 0))
            rid = hashlib.sha256(json.dumps({k: v for k, v in rec.items() if k not in ("gateway_sig","node_sig")}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            qscore = self.get_quality(rid)
            weight = qscore if qscore is not None else 0.8  # default partial credit if not validated
            totals[node] = totals.get(node, 0.0) + out * weight
        return totals

    # Accounts and payments
    def ensure_account(self, user_pubkey: str) -> None:
        import time
        now = time.time()
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR IGNORE INTO accounts(user_pubkey,balance,created_at,updated_at) VALUES(?,?,?,?)",
                (user_pubkey, 0, now, now),
            )
            db.commit()

    def get_balance(self, user_pubkey: str) -> int:
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT balance FROM accounts WHERE user_pubkey=?", (user_pubkey,)).fetchone()
        return int(row[0]) if row else 0

    def credit_account(self, user_pubkey: str, amount: int, *, memo: str = "", ref_id: str | None = None, txid: str | None = None) -> None:
        assert amount >= 0
        import time
        self.ensure_account(user_pubkey)
        now = time.time()
        with sqlite3.connect(self.path) as db:
            bal = self.get_balance(user_pubkey)
            new_bal = bal + amount
            db.execute("UPDATE accounts SET balance=?, updated_at=? WHERE user_pubkey=?", (new_bal, now, user_pubkey))
            db.execute(
                "INSERT INTO account_txns(user_pubkey,delta_amount,kind,memo,ref_id,created_at) VALUES(?,?,?,?,?,?)",
                (user_pubkey, amount, "credit", memo, ref_id, now),
            )
            if txid:
                db.execute(
                    "INSERT INTO payments(user_pubkey,amount,txid,status,created_at) VALUES(?,?,?,?,?)",
                    (user_pubkey, amount, txid, "credited", now),
                )
            db.commit()

    def debit_account(self, user_pubkey: str, amount: int, *, memo: str = "", ref_id: str | None = None) -> None:
        assert amount >= 0
        import time
        self.ensure_account(user_pubkey)
        now = time.time()
        with sqlite3.connect(self.path) as db:
            bal = self.get_balance(user_pubkey)
            if bal < amount:
                raise ValueError("insufficient balance")
            new_bal = bal - amount
            db.execute("UPDATE accounts SET balance=?, updated_at=? WHERE user_pubkey=?", (new_bal, now, user_pubkey))
            db.execute(
                "INSERT INTO account_txns(user_pubkey,delta_amount,kind,memo,ref_id,created_at) VALUES(?,?,?,?,?,?)",
                (user_pubkey, -amount, "debit", memo, ref_id, now),
            )
            db.commit()


