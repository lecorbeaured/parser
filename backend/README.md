# PARSEUR 10X — Backend API

Node.js + Express server that powers the credit report parsing pipeline.

---

## How It Works

```
User uploads PDF/image
        ↓
POST /api/parse
        ↓
pipelineRouter.js — detects digital vs scanned
        ↓
┌──────────────────┬──────────────────────┐
│ Digital PDF      │ Scanned / Image       │
│ Document Intel.  │ Azure AI Vision OCR   │
└──────────────────┴──────────────────────┘
        ↓ (raw text)
gptInterpreter.js — GPT-4o structures the data
        ↓
JSON response → frontend renders results
```

---

## Azure Services Required

### 1. Azure Document Intelligence
- Create a **Document Intelligence** resource in Azure Portal
- Tier: Free (F0) handles up to 500 pages/month — enough to start
- Grab the **Endpoint** and **Key 1** from Keys and Endpoint tab

### 2. Azure AI Vision
- Create a **Computer Vision** resource in Azure Portal
- Same region as Document Intelligence (reduces latency)
- Grab the **Endpoint** and **Key 1**

### 3. Azure OpenAI
- Request access at: https://aka.ms/oai/access
- Once approved, create an **Azure OpenAI** resource
- In Azure OpenAI Studio, deploy **gpt-4o** (note your deployment name)
- Grab the **Endpoint** and **Key 1**

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd parseur10x-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your Azure credentials:

```env
AZURE_DOC_INTEL_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOC_INTEL_KEY=abc123...

AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_VISION_KEY=abc123...

AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=abc123...
AZURE_OPENAI_DEPLOYMENT=gpt-4o

ALLOWED_ORIGIN=https://yourdomain.com
PORT=3000
```

### 3. Run

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

### 4. Test the health endpoint

```
GET http://localhost:3000/health
```

Should return:
```json
{
  "status": "ok",
  "services": {
    "documentIntelligence": true,
    "visionOCR": true,
    "openAI": true
  }
}
```

---

## Connecting the Frontend

In `parseur10x.html`, find this line near the top of the script:

```javascript
const API_BASE = null; // development — uses mock data
```

Change it to your deployed backend URL:

```javascript
const API_BASE = 'https://your-backend-url.railway.app';
```

The frontend will automatically switch from mock data to real API calls.

---

## API Reference

### `POST /api/parse`

Parses a credit report file.

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | PDF, JPG, or PNG (max 20MB) |
| `bureau` | string | Yes | `equifax` \| `transunion` \| `experian` |
| `pipeline` | string | No | `docint` \| `vision` (force override) |

**Response** — `application/json`

```json
{
  "success": true,
  "pipeline": "docint",
  "elapsed": 4823,
  "data": {
    "score": 612,
    "bureau": "EQUIFAX",
    "utilization": 74,
    "totalAccounts": 9,
    "negativeCount": 3,
    "hardInquiries": 3,
    "negatives": [
      {
        "name": "MIDLAND CREDIT MGMT",
        "type": "Collection",
        "balance": "$1,240",
        "opened": "Mar 2021"
      }
    ],
    "utilAccounts": [
      {
        "name": "Chase Freedom",
        "balance": 1840,
        "limit": 2000,
        "utilPct": 92
      }
    ],
    "goodAccounts": [
      {
        "name": "AMERICAN EXPRESS",
        "type": "Credit Card",
        "since": "2016"
      }
    ],
    "summary": "Your Equifax report shows 3 negative items pulling down your score. Reducing utilization and disputing the collection account are your highest-impact next steps."
  }
}
```

**Error responses**

| Code | HTTP | Meaning |
|------|------|---------|
| `NO_FILE` | 400 | No file in request |
| `INVALID_BUREAU` | 400 | Bureau not recognized |
| `UNSUPPORTED_FILE` | 400 | File type not PDF/JPG/PNG |
| `FILE_TOO_LARGE` | 413 | File exceeds 20MB |
| `EXTRACTION_FAILED` | 422 | Could not extract text from file |
| `RATE_LIMITED` | 429 | Too many requests (10/hour per IP) |
| `TIMEOUT` | 504 | Azure services took too long |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Deployment — Railway (recommended)

Railway is the fastest path to deploy. Free tier covers initial traffic.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set environment variables in the Railway dashboard under Variables.

Set `ALLOWED_ORIGIN` to your frontend domain to prevent unauthorized use.

---

## Cost Estimates (Azure)

| Service | Free Tier | Paid |
|---------|-----------|------|
| Document Intelligence | 500 pages/month free | ~$1.50 per 1,000 pages |
| AI Vision OCR | 5,000 transactions/month free | ~$1.00 per 1,000 |
| Azure OpenAI GPT-4o | No free tier | ~$0.005 per 1K input tokens, ~$0.015 per 1K output |

**Per parse estimate**: a typical credit report parse costs ~$0.15–0.35 in Azure API calls depending on report length and whether OCR is needed. At $9/month subscription your break-even is roughly 25–60 parses per paying user per month. Most users parse 2–4 times.

---

## Rate Limiting

Two layers of protection:

1. **Frontend** — localStorage gate, 3 free parses per device
2. **Backend** — express-rate-limit, 10 requests per IP per hour

Both are intentionally soft. The audience isn't technical enough to bypass consistently.

---

## File Structure

```
parseur10x-backend/
├── server.js                    # Express app, routes, error handling
├── services/
│   ├── pipelineRouter.js        # Detects digital vs scanned, routes to correct Azure service
│   ├── documentIntelligence.js  # Azure Document Intelligence integration
│   ├── visionOCR.js             # Azure AI Vision Read API integration
│   └── gptInterpreter.js        # GPT-4o prompt + JSON parsing + sanitization
├── package.json
├── .env.example
├── .gitignore
└── README.md
```
