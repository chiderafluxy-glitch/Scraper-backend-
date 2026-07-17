# Final Expense Agent Lead Pipeline

Database of independent final expense/life insurance agents with direct-dial phone numbers, sourced from carrier "Find an Agent" locators.

## Stage 0 Verification Results

| Source | Status | Data Format | Notes |
|--------|--------|-------------|-------|
| **Mutual of Omaha** | ✅ WORKS | Named agents + phone | Primary source, confirmed working |
| **American Amicable** | ❌ Blocked | — | Security check prevents access |
| **Transamerica** | ❌ Blocked | — | hCaptcha protection |
| **Royal Neighbors** | ❌ No locator | — | Agent login only, no public finder |
| **Foresters Financial** | ❌ Lead form | — | Contact form, not agent directory |

## Tech Stack

- **Database**: Supabase (Postgres)
- **NL Parsing**: Groq (llama-3.1-8b-instant)
- **Frontend**: Next.js 14
- **Scraper**: Playwright + Node.js
- **Deployment**: Vercel (frontend) + Render (scraper jobs)

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Go to your Supabase project at https://supabase.com
2. Navigate to SQL Editor
3. Run the schema from `supabase/schema.sql`

### 3. Configure Environment

```bash
cp .env.example .env.local
# Edit .env.local with your credentials
```

Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`

### 4. Run the App

```bash
npm run dev
```

Open http://localhost:3000

### 5. Run the Scraper

```bash
npm run scrape:mutual-of-omaha
```

### 6. Run Normalization

```bash
npm run normalize
```

## Deployment

### Frontend (Vercel)

1. Push to GitHub
2. Connect to Vercel
3. Deploy automatically

Set environment variables in Vercel dashboard.

### Scraper (Render)

1. Create a new Web Service on Render
2. Connect to GitHub repo
3. Configure:
   - Build Command: `npm install && npx playwright install chromium`
   - Start Command: `npm run scraper`
4. Set environment variables
5. Add a cron job for recurring scrapes

## API

### Query Agents

```bash
POST /api/query
Content-Type: application/json

{
  "query": "give me 5,000 Texas agents I haven't gotten yet"
}
```

Response:
```json
{
  "agents": [...],
  "batch_id": "uuid",
  "count": 5000,
  "csv": "full_name,phone,..."
}
```

### Get Stats

```bash
GET /api/stats
```

Response:
```json
{
  "total_agents": 15000,
  "total_delivered": 3000,
  "remaining": 12000,
  "global_cap": { "limit": 20000, "enabled": true, "usage_percent": 75 },
  "by_state": { "TX": { "total": 8000, "delivered": 2000, "remaining": 6000 }, ... }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Vercel)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Query Box (NL) → /api/query → Supabase → CSV Export    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Supabase (Postgres)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ scrape_queue│  │raw_agent_   │  │   agents    │             │
│  │             │  │records      │  │             │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Scraper (Render)                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Mutual of Omaha → Raw Records → Normalize → Agents    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Query Examples

- "give me 5,000 Texas agents I haven't gotten yet"
- "another 20k across TX, FL, GA, no dupes"
- "just Houston, skip the rest of Texas"
- "500 agents with email available"

## License

Private - All rights reserved
