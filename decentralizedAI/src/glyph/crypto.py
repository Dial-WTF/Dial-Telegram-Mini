from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Tuple
from pathlib import Path
import os

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives import serialization


def generate_identity() -> Tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    sk = base64.b64encode(
        private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
    ).decode()
    pk = base64.b64encode(public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    return pk, sk


def sign(sk_b64: str, message: bytes) -> str:
    sk = Ed25519PrivateKey.from_private_bytes(base64.b64decode(sk_b64))
    sig = sk.sign(message)
    return base64.b64encode(sig).decode()


def verify(pk_b64: str, message: bytes, signature_b64: str) -> bool:
    pk = Ed25519PublicKey.from_public_bytes(base64.b64decode(pk_b64))
    try:
        pk.verify(base64.b64decode(signature_b64), message)
        return True
    except Exception:
        return False



def public_from_secret(sk_b64: str) -> str:
    """Derive base64 public key from a base64-encoded Ed25519 secret key."""
    sk = Ed25519PrivateKey.from_private_bytes(base64.b64decode(sk_b64))
    pk = sk.public_key()
    return base64.b64encode(
        pk.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    ).decode()


def load_or_create_identity(identity_path: str) -> Tuple[str, str]:
    """Load an Ed25519 identity from file or create and persist a new one.

    The file stores the secret key in base64, one line. Public key is derived.
    The file permissions are restricted to the current user (0600) when created.
    """
    path = Path(os.path.expanduser(identity_path))
    if path.exists():
        sk_b64 = path.read_text(encoding="utf-8").strip()
        pk_b64 = public_from_secret(sk_b64)
        return pk_b64, sk_b64
    # Create parent directory and a new identity
    if path.parent:
        path.parent.mkdir(parents=True, exist_ok=True)
    pk_b64, sk_b64 = generate_identity()
    # Write secret key to file with restrictive permissions
    with open(path, "w", encoding="utf-8") as f:
        f.write(sk_b64 + "\n")
    try:
        os.chmod(path, 0o600)
    except Exception:
        # Best effort; continue if chmod is not supported
        pass
    return pk_b64, sk_b64

