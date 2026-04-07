#!/usr/bin/env python3
"""
Prepares VS Code's state.vscdb with:
  - A GitHub auth session encrypted using Electron's safeStorage (v10 AES-128-CBC)
  - Copilot Chat visible in the auxiliary (right) sidebar

Requires:
  - GH_COPILOT_CHAT env var: GitHub PAT with read:user scope
  - KEYRING_PASSWORD env var: password stored in gnome-keyring under "Code Safe Storage"
  - VSCODE_USER_DATA_DIR env var (defaults to /tmp/barge-gif-recording/user-data)

The KEYRING_PASSWORD must match what was stored via:
  printf "$KEYRING_PASSWORD" | secret-tool store \
    --label="Code Safe Storage" service "Code Safe Storage" account "Code"
"""

import json
import os
import sqlite3
import urllib.request

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

PAT = os.environ["GH_COPILOT_CHAT"]
KEYRING_PASSWORD = os.environ.get("KEYRING_PASSWORD", "barge-gif-key")
USER_DATA_DIR = os.environ.get("VSCODE_USER_DATA_DIR", "/tmp/barge-gif-recording/user-data")

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

# Build the session JSON that VS Code's github-authentication extension expects
session = [
    {
        "id": "barge-copilot-session",
        "account": {"label": account_label, "id": account_id},
        "accessToken": PAT,
        "scopes": ["read:user", "user:email", "repo", "workflow"],
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
