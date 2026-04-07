#!/usr/bin/env python3
"""
Prepares VS Code's state.vscdb with a GitHub auth session for Copilot Chat.

VS Code stores secrets in state.vscdb as JSON.stringify(Buffer) where Buffer
contains the encrypted bytes from Electron's safeStorage.encryptString().

With --password-store=basic, Electron uses v10 AES-128-CBC encryption:
  - key  = PBKDF2(password='peanuts', salt=b'saltysalt', iterations=1, keylen=16, hash=sha1)
  - iv   = 16 bytes of 0x20 (space)
  - data = b'v10' + AES-128-CBC(key, iv, PKCS7-padded plaintext)

The JSON-serialised format that VS Code stores:
  {"type":"Buffer","data":[118,49,48,...encrypted bytes...]}

This is computed below via a Node.js subprocess (crypto module, built-in, no
extra packages needed).

Requires:
  - GH_COPILOT_CHAT env var: GitHub PAT with Copilot access
  - VSCODE_USER_DATA_DIR env var (defaults to /tmp/barge-gif-recording/user-data)
  - node in PATH (present via the workflow's Node.js setup step)
"""

import json
import os
import sqlite3
import subprocess
import sys
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

# VS Code with --password-store=basic uses Electron's v10 AES-128-CBC encryption:
#   key  = PBKDF2(password='peanuts', salt=b'saltysalt', iterations=1, keylen=16, sha1)
#   iv   = 16 bytes of 0x20 (ASCII space)
#   blob = b'v10' + AES-128-CBC(key, iv, PKCS7-padded plaintext)
#
# JSON.stringify(Buffer) produces {"type":"Buffer","data":[...byte values...]},
# which is the exact format VS Code stores via EncryptionMainService.encrypt().
NODE_ENCRYPT = r"""
const crypto = require('crypto');
const plaintext = process.argv[1];
const key = crypto.pbkdf2Sync('peanuts', Buffer.from('saltysalt'), 1, 16, 'sha1');
const iv = Buffer.alloc(16, 0x20);
const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
const result = Buffer.concat([Buffer.from('v10'), enc]);
process.stdout.write(JSON.stringify({type: 'Buffer', data: Array.from(result)}));
"""

proc = subprocess.run(
    ["node", "-e", NODE_ENCRYPT, "--", session_json],
    capture_output=True, text=True, check=True
)
stored_value = proc.stdout.strip()

if not stored_value:
    print("ERROR: Node.js encryption produced no output", file=sys.stderr)
    sys.exit(1)

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

# Quick sanity check: round-trip verify
db = sqlite3.connect(db_path)
row = db.execute(
    "SELECT value FROM ItemTable WHERE key = ?",
    ('secret://{"extensionId":"vscode.github-authentication","key":"github.auth"}',),
).fetchone()
db.close()
if row:
    parsed = json.loads(row[0])
    data_bytes = bytes(parsed["data"])
    # v10 prefix (3 bytes) + encrypted payload
    print(f"Session stored OK: format={data_bytes[:3]!r}, total_bytes={len(data_bytes)}")
else:
    print("ERROR: session key not found in state.vscdb after write!")
    sys.exit(1)



