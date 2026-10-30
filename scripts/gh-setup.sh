#!/bin/bash
# Test GitHub PAT (from DB) + create private full-backup repo
set -u
TOKEN=$(cat /home/z/my-project/.gh-token)
API="https://api.github.com"
H=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "=== WHOAMI ==="
ME=$(curl -sS "${H[@]}" "$API/user")
LOGIN=$(echo "$ME" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('login',''))" 2>/dev/null)
if [ -z "$LOGIN" ]; then
  echo "TOKEN INVALID: $(echo "$ME" | head -c 300)"
  exit 1
fi
echo "login=$LOGIN  name=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))")"

echo "=== REPO PERMISSIONS (fine-grained PATs: test repo list) ==="
REPOS=$(curl -sS "${H[@]}" "$API/user/repos?per_page=100&sort=updated")
echo "$REPOS" | python3 -c "
import sys, json
try:
    rs = json.load(sys.stdin)
    if isinstance(rs, dict): print('ERR:', rs.get('message')); rs=[]
    for r in rs: print('repo:', r['full_name'], 'private=' + str(r['private']), 'perms=' + str(r.get('permissions',{}).get('push')))
except Exception as e: print('parse err', e)
"

REPO_NAME="ai-studio-full-backup"
echo "=== CREATE REPO $LOGIN/$REPO_NAME (private) ==="
CREATE=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" "${H[@]}" -X POST "$API/user/repos" \
  -d "{\"name\":\"$REPO_NAME\",\"private\":true,\"description\":\"Full backup: code + keys (.env plaintext) + models + data\",\"has_wiki\":false,\"has_issues\":false}")
STATUS=$(echo "$CREATE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$CREATE" | sed 's/HTTP_STATUS:[0-9]*//')
if [ "$STATUS" = "201" ]; then
  echo "CREATED: $LOGIN/$REPO_NAME (private)"
else
  echo "CREATE FAILED status=$STATUS: $(echo "$BODY" | head -c 400)"
  # maybe it already exists
  EXIST=$(curl -sS -o /dev/null -w "%{http_code}" "${H[@]}" "$API/repos/$LOGIN/$REPO_NAME")
  echo "existing-repo-check=$EXIST"
fi
