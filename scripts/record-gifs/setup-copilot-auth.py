#!/usr/bin/env python3
"""
Prepares VS Code's state.vscdb with a GitHub auth session for Copilot Chat.

VS Code stores secrets in state.vscdb encrypted via Electron's safeStorage.
When launched with --password-store=basic, VS Code calls
safeStorage.setUsePlainTextEncryption(true), which makes:
  - encryptString(text) → Buffer.from(text, 'utf8')  (no encryption)
  - decryptString(buf)  → buf.toString('utf8')

VS Code then wraps the Buffer as JSON: JSON.stringify(buffer) produces
{"type":"Buffer","data":[...utf8 bytes...]}. That is the exact format we
must write to state.vscdb so decrypt() can reconstruct the session string.

Requires:
  - GH_COPILOT_CHAT env var: GitHub PAT with Copilot access
  - VSCODE_USER_DATA_DIR env var (defaults to /tmp/barge-gif-recording/user-data)
"""

import json
import os
import sqlite3
import urllib.request

PAT = os.environ["GH_COPILOT_CHAT"]
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

# Build the session JSON that VS Code's github-authentication extension expects.
# Include "copilot" scope so Copilot Chat's getSession(['read:user', 'copilot'])
# finds this session instead of triggering a browser OAuth flow.
session = [
    {
        "id": "barge-copilot-session",
        "account": {"label": account_label, "id": account_id},
        "accessToken": PAT,
        "scopes": ["read:user", "user:email", "repo", "workflow", "copilot"],
    }
]

session_json = json.dumps(session)

# VS Code with --password-store=basic uses setUsePlainTextEncryption(true).
# encrypt(text) returns JSON.stringify(Buffer.from(text, 'utf8')), which Node.js
# serialises as {"type":"Buffer","data":[...utf8 byte values...]}.
# decrypt() does: JSON.parse → Buffer.from(data) → safeStorage.decryptString()
# which, in plain-text mode, just returns buffer.toString('utf8').
utf8_bytes = list(session_json.encode("utf-8"))
stored_value = json.dumps({"type": "Buffer", "data": utf8_bytes})

# Write to state.vscdb
db_dir = os.path.join(USER_DATA_DIR, "User", "globalStorage")
os.makedirs(db_dir, exist_ok=True)
db_path = os.path.join(db_dir, "state.vscdb")

db = sqlite3.connect(db_path)
db.execute(
    "CREATE TABLE IF NOT EXISTS ItemTable "
    "(key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)"
)
db.execute(
    "INSERT OR REPLACE INTO ItemTable VALUES (?, ?)",
    (
        'secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}',
        stored_value,
    ),
)
db.commit()
db.close()
print("VS Code auth session written to state.vscdb")

# Quick sanity check: confirm the value round-trips correctly
db = sqlite3.connect(db_path)
row = db.execute(
    "SELECT value FROM ItemTable WHERE key = ?",
    ('secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}',),
).fetchone()
db.close()
if row:
    raw = row[0]
    parsed = json.loads(raw)
    reconstructed = bytes(parsed["data"]).decode("utf-8")
    sessions = json.loads(reconstructed)
    scopes = sessions[0]["scopes"]
    token_preview = sessions[0]["accessToken"][:8] + "..."
    print(f"Session read-back OK: user={sessions[0]['account']['label']}, scopes={scopes}, token={token_preview}")
else:
    print("ERROR: session key not found in state.vscdb after write!")


