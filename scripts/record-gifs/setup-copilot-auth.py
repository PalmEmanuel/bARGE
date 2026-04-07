#!/usr/bin/env python3
"""
Prepares VS Code's state.vscdb with:
  - A GitHub auth session encrypted using Electron's safeStorage (v10 AES-128-CBC)

Requires:
  - GH_COPILOT_CHAT env var: GitHub PAT with Copilot access
  - KEYRING_PASSWORD env var: password stored in gnome-keyring under "Code Safe Storage"
  - VSCODE_USER_DATA_DIR env var (defaults to /tmp/barge-gif-recording/user-data)

The KEYRING_PASSWORD must match what was stored via:
  printf "$KEYRING_PASSWORD" | secret-tool store \
    --label="Code Safe Storage" service "Code Safe Storage" account "Code"
"""

import json
import os
import sqlite3
import subprocess
import urllib.request

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

PAT = os.environ["GH_COPILOT_CHAT"]
KEYRING_PASSWORD = os.environ.get("KEYRING_PASSWORD", "barge-gif-key")
USER_DATA_DIR = os.environ.get("VSCODE_USER_DATA_DIR", "/tmp/barge-gif-recording/user-data")

# Verify the keyring key is accessible (the same password VS Code will use to decrypt)
try:
    result = subprocess.run(
        ["secret-tool", "lookup", "service", "Code Safe Storage", "account", "Code"],
        capture_output=True,
        text=True,
        timeout=5,
    )
    retrieved = result.stdout.strip()
    if retrieved == KEYRING_PASSWORD:
        print("Keyring key verified: matches KEYRING_PASSWORD")
    elif retrieved:
        print(f"WARNING: keyring returned a different value than KEYRING_PASSWORD (len={len(retrieved)} vs {len(KEYRING_PASSWORD)})")
    else:
        print(f"WARNING: keyring lookup returned nothing (rc={result.returncode}). VS Code may use a different key and fail to decrypt the session.")
except Exception as e:
    print(f"WARNING: could not verify keyring key: {e}")

# Fetch the GitHub user identity for this PAT
req = urllib.request.Request(
    "https://api.github.com/user",
    headers={
        "Authorization": f"token {PAT}",
        "Accept": "application/vnd.github.v3+json",
    },
)
with urllib.request.urlopen(req) as resp:
    user = json.loads(resp.read())

account_label = user["login"]
account_id = str(user["id"])
print(f"Configuring VS Code session for GitHub user: {account_label}")

# Build the session JSON that VS Code's github-authentication extension expects.
# The scopes array must contain "copilot" so that Copilot Chat's
# getSession(['read:user', 'copilot']) call finds a matching session and
# does NOT trigger a browser OAuth flow.
session = [
    {
        "id": "barge-copilot-session",
        "account": {"label": account_label, "id": account_id},
        "accessToken": PAT,
        "scopes": ["read:user", "user:email", "repo", "workflow", "copilot"],
    }
]
session_bytes = json.dumps(session).encode()

# Derive the AES-128 key using Electron's safeStorage v10 scheme (mirrors Chrome)
kdf = PBKDF2HMAC(
    algorithm=hashes.SHA1(),
    length=16,
    salt=b"saltysalt",
    iterations=1003,
    backend=default_backend(),
)
key = kdf.derive(KEYRING_PASSWORD.encode())

# PKCS7-pad to AES block size (16 bytes)
pad_len = 16 - (len(session_bytes) % 16)
padded = session_bytes + bytes([pad_len] * pad_len)

# Encrypt AES-128-CBC; IV is 16 space characters (Electron/Chrome convention)
iv = b" " * 16
cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
ciphertext = b"v10" + cipher.encryptor().update(padded)

# VS Code stores encrypted blobs as JSON Buffer objects in SQLite
buffer_json = json.dumps({"type": "Buffer", "data": list(ciphertext)})

# Write to state.vscdb
db_dir = os.path.join(USER_DATA_DIR, "User", "globalStorage")
os.makedirs(db_dir, exist_ok=True)
db_path = os.path.join(db_dir, "state.vscdb")

db = sqlite3.connect(db_path)
db.execute(
    "CREATE TABLE IF NOT EXISTS ItemTable "
    "(key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
)

# GitHub auth session
db.execute(
    "INSERT OR REPLACE INTO ItemTable VALUES (?, ?)",
    (
        'secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}',
        buffer_json,
    ),
)

db.commit()
db.close()
print("VS Code auth session written to state.vscdb")

# Read back and decrypt to confirm the round-trip works
db = sqlite3.connect(db_path)
row = db.execute(
    "SELECT value FROM ItemTable WHERE key = ?",
    ('secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}',),
).fetchone()
db.close()
if row:
    stored = json.loads(row[0])
    raw = bytes(stored["data"])
    assert raw[:3] == b"v10", f"unexpected prefix: {raw[:3]}"
    kdf2 = PBKDF2HMAC(
        algorithm=hashes.SHA1(),
        length=16,
        salt=b"saltysalt",
        iterations=1003,
        backend=default_backend(),
    )
    key2 = kdf2.derive(KEYRING_PASSWORD.encode())
    cipher2 = Cipher(algorithms.AES(key2), modes.CBC(iv), backend=default_backend())
    decrypted = cipher2.decryptor().update(raw[3:])
    # strip PKCS7 padding
    pad = decrypted[-1]
    decrypted = decrypted[:-pad]
    parsed = json.loads(decrypted)
    token_preview = parsed[0]["accessToken"][:8] + "..."
    scopes = parsed[0]["scopes"]
    print(f"Session read-back OK: user={parsed[0]['account']['label']}, scopes={scopes}, token={token_preview}")
else:
    print("ERROR: session key not found in state.vscdb after write!")
