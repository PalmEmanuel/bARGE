#!/usr/bin/env python3
"""
Prepares VS Code's state.vscdb with a GitHub auth session for Copilot Chat.

VS Code's EncryptionMainService.decrypt() explicitly handles values prefixed
with "encryption-not-available-" by stripping the prefix and returning the
plain text. This lets us inject a session without matching VS Code's safeStorage
encryption (which requires the exact keyring key and safeStorage availability).

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

# VS Code's EncryptionMainService prefixes secrets with this string when
# encryption is not available and stores them as plain text. decrypt() checks
# for this prefix before attempting safeStorage decryption, so injecting it
# directly bypasses any keyring/safeStorage dependency entirely.
ENCRYPTION_NOT_AVAILABLE_PREFIX = "encryption-not-available-"

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

stored_value = ENCRYPTION_NOT_AVAILABLE_PREFIX + json.dumps(session)

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
    assert raw.startswith(ENCRYPTION_NOT_AVAILABLE_PREFIX), f"unexpected prefix: {raw[:40]}"
    parsed = json.loads(raw[len(ENCRYPTION_NOT_AVAILABLE_PREFIX):])
    scopes = parsed[0]["scopes"]
    token_preview = parsed[0]["accessToken"][:8] + "..."
    print(f"Session read-back OK: user={parsed[0]['account']['label']}, scopes={scopes}, token={token_preview}")
else:
    print("ERROR: session key not found in state.vscdb after write!")

