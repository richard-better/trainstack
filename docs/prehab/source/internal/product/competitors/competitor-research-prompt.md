# Competitor App Research Prompt

Use this prompt in a new Claude Code session to run competitive research on an iOS app.
Replace the placeholders before using.

---

## Prompt

I want to do competitive research on an iOS app. The goal is to understand their tech stack, API structure, data models, pricing, and product gaps — not to copy them, but to inform our own product decisions.

**Target app:** [APP_NAME]
**App Store URL:** [APP_STORE_URL]

Please do the following in order:

### 1. Download the IPA

Use `ipatool` to download the app (I'm already authenticated). Search for the app first to get the bundle ID:

```
ipatool search "[APP_NAME]"
ipatool download --bundle-identifier "[BUNDLE_ID]" --purchase -o ~/Downloads/
```

Then extract it:

```
mkdir -p ~/Downloads/[app_slug]_extracted
cp ~/Downloads/[BUNDLE_ID]*.ipa ~/Downloads/[app_slug]_extracted/
cd ~/Downloads/[app_slug]_extracted && unzip -q *.ipa
```

### 2. Static Analysis

From the extracted app at `Payload/[AppName].app/`:

**Info.plist** — extract all keys:

```
plutil -convert json -o - - < Info.plist
```

Look for: API base URLs, third-party SDK keys (PostHog, Sentry, RevenueCat, Firebase, etc.), OAuth client IDs, any environment config.

**GoogleService-Info.plist** — if present, reveals Firebase project name, storage bucket, GCM sender ID.

**Frameworks/** — list bundled frameworks to understand the dependency tree.

**Assets.car** — list asset names:

```
xcrun assetutil --info Assets.car | python3 -c "import json,sys; [print(i.get('Name','')) for i in json.load(sys.stdin) if i.get('Name')]"
```

**Binary strings** — extract readable strings (note: many apps encrypt string literals):

```
strings -n 8 Payload/[AppName].app/[AppName] | grep -E "^[a-z_/][a-z0-9_/\-]{4,50}$" | sort -u
```

**Swift type metadata** — even stripped binaries expose type names. Extract from the binary directly:

```python
python3 -c "
with open('Payload/[AppName].app/[AppName]', 'rb') as f:
    data = f.read()
import re
strings = []
i, current = 0, b''
while i < len(data):
    b = data[i:i+1]
    if b == b'\x00':
        if len(current) > 3 and current.isascii():
            s = current.decode('ascii', errors='ignore')
            if re.match(r'^[A-Za-z][A-Za-z0-9_]{2,}$', s):
                strings.append(s)
        current = b''
    elif 32 <= b[0] < 127:
        current += b
    else:
        current = b''
    i += 1
seen = set()
for s in strings:
    if s not in seen:
        seen.add(s)
        print(s)
" | grep -iE "Request|Response|Model|View|State|Manager|Service|Session|Program|Exercise|User|Auth|Plan|Job|Chat|Message|Config|Sub|Channel|Realtime"
```

**RevenueCat key** — search for `appl_` prefixed strings.

**Supabase** — search for `supabase` in type names (reveals if they use Supabase and whether it's for auth, realtime, storage, or direct DB queries via PostgREST).

### 3. Check for Public API Docs

Try these URLs — many apps leave these open:

```
curl -s https://api.[domain].com/openapi.json
curl -s https://api.[domain].com/docs
curl -s https://api.[domain].com/redoc
curl -s https://[domain].com/api/openapi.json
```

If found, fetch the full spec and analyze:

- All endpoints, methods, and paths
- Request/response schemas
- Authentication method
- Data models (look for the core domain objects)
- Async patterns (jobs, webhooks, streaming)

### 4. Probe Live API Endpoints

Based on what you find, probe unauthenticated endpoints. Common ones to try:

```
/health
/v1/exercises
/v1/config
/v1/plans
/api/exercises
```

For each response, look at the full JSON structure — field names reveal the data model even if values are minimal.

### 5. PostHog Feature Flags

If you found a PostHog project key (starts with `phc_`), query their feature flags:

```
curl -s "https://us.i.posthog.com/decide?v=3" \
  -H "Content-Type: application/json" \
  -d '{"api_key": "[PHC_KEY]", "distinct_id": "anonymous"}'
```

This reveals: active feature flags (A/B tests, rollouts), session recording config, whether they're running experiments.

### 6. App Store Intelligence

```
curl -s "https://itunes.apple.com/lookup?id=[APP_ID]&country=us"
curl -s "https://itunes.apple.com/us/rss/customerreviews/id=[APP_ID]/sortBy=mostRecent/json"
```

Extract: pricing, company name, release date, version history, rating count, minimum OS version, full description (contains pricing tiers), release notes (reveals what was broken).

### 7. Infrastructure

Check API response headers for infrastructure clues:

```
curl -sI https://api.[domain].com/health
```

Look for: `server`, `cf-ray` (Cloudflare), `x-amz-*` (AWS), `x-goog-*` (GCP), `via`.

DNS enumeration for subdomains:

```
dig +short api.[domain].com
dig +short cdn.[domain].com
dig +short assets.[domain].com
dig +short storage.[domain].com
```

### 8. Output

Save findings to `docs/internal/[app-slug]-competitive-analysis.md` and `docs/internal/[app-slug]-openapi.json` (if spec found), then commit.

The analysis doc should cover:

- Tech stack (confirmed vs inferred)
- API structure and data models
- Pricing
- Company / launch date / traction signals
- Feature list (including hidden features from App Store description not in API)
- Gaps and weaknesses
- What's worth replicating
- User review themes (competitors mentioned, missing features requested)
