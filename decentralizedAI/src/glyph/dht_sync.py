from __future__ import annotations

import asyncio
import json
from typing import List, Optional

try:
    from hivemind import DHT, get_dht_time
    from hivemind.utils import MSGPackSerializer
    HAVE_HIVEMIND = True
except Exception:
    DHT = None  # type: ignore
    HAVE_HIVEMIND = False


RECEIPTS_KEY = "glyph.receipts"
EPOCHS_KEY = "glyph.epochs"
PRICES_KEY = "glyph.prices"


class DHTSync:
    """Best-effort replication of Glyph metadata over a Hivemind DHT.

    Stores compact snapshots under two dictionary keys: receipts and epochs.
    Values expire and are periodically refreshed. Not a consensus mechanism.
    """

    def __init__(
        self,
        *,
        initial_peers: Optional[list[str]] = None,
        start: bool = True,
        expiration: float = 300.0,
        host_maddrs: Optional[list[str]] = None,
        announce_maddrs: Optional[list[str]] = None,
    ) -> None:
        if not HAVE_HIVEMIND:
            raise RuntimeError("hivemind is not installed; install to enable DHT sync")
        self.expiration = expiration
        self.dht = DHT(
            initial_peers=initial_peers,
            start=start,
            host_maddrs=host_maddrs,
            announce_maddrs=announce_maddrs,
        )

    def shutdown(self) -> None:
        if hasattr(self, "dht") and self.dht is not None:
            self.dht.shutdown()

    def publish_receipts(self, receipt_dicts: List[dict]) -> None:
        if not receipt_dicts:
            return
        payload = json.dumps(receipt_dicts).encode()
        expiration = get_dht_time() + self.expiration
        # Store under a subkey that monotonically increases (chain head)
        self.dht.store(
            key=RECEIPTS_KEY,
            subkey="head",
            value=payload,
            expiration_time=expiration,
        )

    def fetch_latest_receipts(self) -> Optional[List[dict]]:
        item = self.dht.get(RECEIPTS_KEY, latest=True)
        result = item.result() if hasattr(item, "result") else item
        if result and result.value:
            try:
                return json.loads(result.value)
            except Exception:
                return None
        return None

    def publish_epoch(self, epoch_id: str, snapshot: dict) -> None:
        payload = json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
        expiration = get_dht_time() + self.expiration
        self.dht.store(key=EPOCHS_KEY, subkey=epoch_id, value=payload, expiration_time=expiration)

    def fetch_epoch(self, epoch_id: str) -> Optional[dict]:
        item = self.dht.get(EPOCHS_KEY, latest=True)
        result = item.result() if hasattr(item, "result") else item
        if result and result.value:
            try:
                data = json.loads(result.value)
                return data if isinstance(data, dict) and data.get("epoch_id") == epoch_id else None
            except Exception:
                return None
        return None

    # Price asks (decentralized market signal)
    def publish_price_ask(self, pubkey: str, ask: dict) -> None:
        payload = json.dumps(ask).encode()
        expiration = get_dht_time() + self.expiration
        self.dht.store(key=PRICES_KEY, subkey=pubkey, value=payload, expiration_time=expiration)

    def fetch_price_asks(self) -> dict:
        item = self.dht.get(PRICES_KEY, latest=True)
        result = item.result() if hasattr(item, "result") else item
        if not result or not result.value:
            return {}
        try:
            # For dictionary value, hivemind returns dict of subkeys to ValueWithExpiration
            # We expect result.value to be a dict mapping subkey->ValueWithExpiration
            values = result.value
            if isinstance(values, dict):
                out = {}
                for subkey, v in values.items():
                    try:
                        out[subkey] = json.loads(v.value if hasattr(v, "value") else v)
                    except Exception:
                        continue
                return out
        except Exception:
            return {}
        return {}


