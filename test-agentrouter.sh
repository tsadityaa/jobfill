#!/bin/bash
# Full end-to-end test: simulates what the MemoraFill extension does
# Tests Agent Router /v1/responses with the model set in extension/.env.
# The API key stays in the backend's ignored local secrets file, never in VITE env.

# Key and model are read from local env files so no secret is stored in this script.
ROOT_DIR="$(dirname "$0")"
BACKEND_ENV_FILE="$ROOT_DIR/backend/.dev.vars"
EXTENSION_ENV_FILE="$ROOT_DIR/extension/.env"
env_value() { sed -n "s/^$1=//p" "$2" | tr -d '\r"' | head -n 1; }

API_KEY=$(env_value AGENTROUTER_API_KEY "$BACKEND_ENV_FILE")
MODEL=$(env_value VITE_AI_MODEL "$EXTENSION_ENV_FILE")
BASE_URL="https://agentrouter.org/v1/responses"
MODEL=${MODEL:-gpt-5.6-sol}

if [ -z "$API_KEY" ]; then
  echo "AGENTROUTER_API_KEY is empty in backend/.dev.vars. Add the key and run again."
  exit 1
fi

echo "============================================="
echo "  MemoraFill ↔ Agent Router End-to-End Test"
echo "============================================="
echo ""
FAILED=0
echo "Endpoint: $BASE_URL"
echo "Model:    $MODEL"
echo ""

if [ "${RESUME_ONLY:-0}" != "1" ]; then
# Test 1: Simple chat (AgentChat simulation)
echo "--- Test 1: Simple chat (AgentChat simulation) ---"
RESPONSE=$(curl -s --max-time 30 -w "\n---HTTP_STATUS:%{http_code}---" \
  "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "User-Agent: codex_cli_rs/0.101.0 (Mac OS; arm64)" \
  -H "Originator: codex_cli_rs" \
  -H "Version: 0.101.0" \
  -d "{
    \"model\": \"$MODEL\",
    \"instructions\": \"You are a helpful assistant.\",
    \"input\": [{\"role\": \"user\", \"content\": \"Say hello in one word.\"}],
    \"max_output_tokens\": 1024,
    \"stream\": false
  }")

STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/---HTTP_STATUS/d')

if [ "$STATUS" = "200" ]; then
  TEXT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); msgs=[o for o in d.get('output',[]) if o.get('type')=='message']; print(msgs[0]['content'][0]['text'] if msgs else 'N/A')" 2>/dev/null)
  echo "✅ HTTP 200 — Response: \"$TEXT\""
else
  echo "❌ HTTP $STATUS"
  echo "$BODY" | head -5
  FAILED=1
fi
echo ""

# Test 2: JSON output (aiMapper simulation)
echo "--- Test 2: JSON output (AI Mapper simulation) ---"
RESPONSE=$(curl -s --max-time 30 -w "\n---HTTP_STATUS:%{http_code}---" \
  "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "User-Agent: codex_cli_rs/0.101.0 (Mac OS; arm64)" \
  -H "Originator: codex_cli_rs" \
  -H "Version: 0.101.0" \
  -d "{
    \"model\": \"$MODEL\",
    \"instructions\": \"You are a JSON mapper. Return ONLY valid JSON, no markdown.\",
    \"input\": [{\"role\": \"user\", \"content\": \"Map this: first_name -> firstName, email -> userEmail. Return JSON object.\"}],
    \"max_output_tokens\": 600,
    \"stream\": false
  }")

STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/---HTTP_STATUS/d')

if [ "$STATUS" = "200" ]; then
  TEXT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); msgs=[o for o in d.get('output',[]) if o.get('type')=='message']; print(msgs[0]['content'][0]['text'] if msgs else 'N/A')" 2>/dev/null)
  echo "✅ HTTP 200 — JSON Output: $TEXT"
else
  echo "❌ HTTP $STATUS"
  echo "$BODY" | head -5
  FAILED=1
fi
echo ""
fi

# Test 3: Exercise the resume parser's Responses route with reasoning disabled.
# Use synthetic resume data so this test never sends a real resume.
echo "--- Test 3: Resume extraction (Responses, reasoning none) ---"
PAYLOAD=$(python3 - "$ROOT_DIR" "$MODEL" <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
model = sys.argv[2]
parser_source = (root / "extension/utils/resumeParser.ts").read_text()
prompt_match = re.search(r"const RESUME_PARSE_PROMPT = `([\s\S]*?)`;", parser_source)
if not prompt_match:
    raise SystemExit("Could not find RESUME_PARSE_PROMPT in resumeParser.ts")

resume = """Ravi Kumar
Email: ravi.kumar@example.invalid
Phone: +1 555 010 2040
Education: B.S. Computer Science, North State University, 2022-2026
Experience: Software Engineer Intern at Example Labs, June 2024-August 2024
Responsibilities: Built internal dashboard features with JavaScript and SQL.
Skills: JavaScript, SQL, React, communication, problem solving.
"""
resume += "Additional responsibilities included collaborating with cross-functional teams, documenting software quality workflows, updating internal reports, and supporting release coordination across product groups.\n" * 24
payload = {
    "model": model,
    "instructions": prompt_match.group(1),
    "input": [{"role": "user", "content": f"Parse this resume and return the profile as valid JSON:\n\n{resume[:8000]}"}],
    "reasoning": {"effort": "none"},
    "max_output_tokens": 16384,
    "stream": False,
}
print(json.dumps(payload))
PY
)
RESPONSE=$(curl -s --max-time 60 -w "\n---HTTP_STATUS:%{http_code}---" \
  "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "User-Agent: codex_cli_rs/0.101.0 (Mac OS; arm64)" \
  -H "Originator: codex_cli_rs" \
  -H "Version: 0.101.0" \
  -d "$PAYLOAD")

STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/---HTTP_STATUS/d')
if [ "$STATUS" = "200" ]; then
  python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("output_text", ""); c=c or "".join(part.get("text", "") for item in d.get("output", []) if item.get("type")=="message" for part in item.get("content", []) if isinstance(part.get("text"),str)); p=json.loads(c) if c else {}; name=p.get("personal",{}).get("firstName"); exp=p.get("experience",[]); ok=name=="Ravi" and bool(exp); print("✅ HTTP 200 — parsed sample profile; reasoning tokens:", d.get("usage",{}).get("output_tokens_details",{}).get("reasoning_tokens", "not reported")); sys.exit(0 if ok else 1)' <<< "$BODY" || FAILED=1
else
  echo "❌ HTTP ${STATUS:-000} — resume extraction request failed"
  echo "$BODY" | head -c 500
  echo ""
  FAILED=1
fi
echo ""

echo "============================================="
echo "  All Tests Complete"
echo "============================================="
exit "$FAILED"
