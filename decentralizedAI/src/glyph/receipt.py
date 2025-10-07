from __future__ import annotations

import json
import hashlib
import time
from dataclasses import dataclass, asdict
from typing import Optional

from .crypto import sign, verify


@dataclass
class UsageReceipt:
    gateway_pubkey: str
    node_pubkey: str
    session_id: str
    route: str
    input_tokens: int
    output_tokens: int
    wall_time_ms: int
    created_at: float
    gateway_sig: Optional[str] = None
    node_sig: Optional[str] = None

    def to_payload(self) -> bytes:
        d = asdict(self).copy()
        d.pop("gateway_sig", None)
        d.pop("node_sig", None)
        return json.dumps(d, sort_keys=True, separators=(",", ":")).encode()

    def receipt_id(self) -> str:
        return hashlib.sha256(self.to_payload()).hexdigest()

    def sign_gateway(self, gateway_sk: str) -> None:
        self.gateway_sig = sign(gateway_sk, self.to_payload())

    def sign_node(self, node_sk: str) -> None:
        self.node_sig = sign(node_sk, self.to_payload())

    def verify(self) -> bool:
        if not self.gateway_sig or not self.node_sig:
            return False
        ok1 = verify(self.gateway_pubkey, self.to_payload(), self.gateway_sig)
        ok2 = verify(self.node_pubkey, self.to_payload(), self.node_sig)
        return ok1 and ok2

    @classmethod
    def create(
        cls,
        *,
        gateway_pubkey: str,
        node_pubkey: str,
        session_id: str,
        route: str,
        input_tokens: int,
        output_tokens: int,
        wall_time_ms: int,
    ) -> "UsageReceipt":
        return cls(
            gateway_pubkey=gateway_pubkey,
            node_pubkey=node_pubkey,
            session_id=session_id,
            route=route,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            wall_time_ms=wall_time_ms,
            created_at=time.time(),
        )


