// services/gptInterpreter.js
// Sends raw OCR/extracted text to OpenAI GPT-4o for structured interpretation

const axios = require('axios');

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/**
 * Parse raw credit report text into structured JSON via GPT-4o.
 * Returns a clean object matching the frontend's expected data shape.
 */
async function interpretCreditReport(rawText, bureau) {
  if (!API_KEY) {
    throw new Error('OpenAI API key not configured (OPENAI_API_KEY)');
  }

  const url = 'https://api.openai.com/v1/chat/completions';

  const systemPrompt = `You are an expert credit analyst. Your job is to parse raw credit report text and extract structured data. You must respond ONLY with valid JSON — no markdown, no explanation, no code fences. The JSON must exactly match the schema provided.`;

  const userPrompt = `Parse this ${bureau.toUpperCase()} credit report and return structured JSON.

SCHEMA (return exactly this structure):
{
  "score": <integer 300-850, or null if not found>,
  "bureau": "${bureau}",
  "utilization": <overall utilization percentage as integer 0-100, estimate from accounts if not stated>,
  "totalAccounts": <total number of accounts found>,
  "negativeCount": <number of negative items>,
  "hardInquiries": <number of hard inquiries in last 2 years, 0 if none found>,
  "negatives": [
    {
      "name": "<creditor/account name>",
      "type": "<Collection | Late Payment | Charge-Off | Bankruptcy | Repossession | Judgment>",
      "balance": "<balance as string e.g. '$1,240' or 'N/A'>",
      "opened": "<date opened as string e.g. 'Mar 2021' or 'Unknown'>"
    }
  ],
  "utilAccounts": [
    {
      "name": "<account name>",
      "balance": <current balance as integer, no $ sign>,
      "limit": <credit limit as integer, no $ sign>,
      "utilPct": <utilization percentage as integer 0-100>
    }
  ],
  "goodAccounts": [
    {
      "name": "<account name>",
      "type": "<Credit Card | Auto Loan | Mortgage | Student Loan | Personal Loan | Other>",
      "since": "<year or date string e.g. '2019' or 'Jan 2019'>"
    }
  ],
  "summary": "<2-3 sentence plain English summary of the report's overall health and most urgent action>"
}

RULES:
- Include in negatives: collections, charge-offs, late payments (30/60/90 days), bankruptcies, repossessions, judgments
- Include in utilAccounts: all revolving credit accounts (credit cards, lines of credit) with a limit
- Include in goodAccounts: accounts with no negative marks and positive payment history
- If score is not explicitly stated in the report, estimate based on account health and return null
- utilization: calculate as (total balances / total limits * 100), round to nearest integer
- For missing values, use sensible defaults or "Unknown" strings — never omit required fields
- Respond ONLY with JSON. No markdown. No explanation.

CREDIT REPORT TEXT:
\${rawText.slice(0, 12000)}`;

  const response = await axios.post(url, {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 2000,
    temperature: 0.1,
  }, {
    headers: {
      'Authorization': `Bearer \${API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const rawContent = response.data.choices?.[0]?.message?.content || '';

  const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('GPT-4o returned invalid JSON:', cleaned);
    throw new Error('GPT-4o returned malformed JSON — see server logs');
  }

  return sanitizeResult(parsed, bureau);
}

function sanitizeResult(data, bureau) {
  return {
    score: typeof data.score === 'number' ? Math.min(850, Math.max(300, data.score)) : null,
    bureau: bureau,
    utilization: typeof data.utilization === 'number' ? Math.min(100, Math.max(0, data.utilization)) : 0,
    totalAccounts: typeof data.totalAccounts === 'number' ? data.totalAccounts : 0,
    negativeCount: Array.isArray(data.negatives) ? data.negatives.length : 0,
    hardInquiries: typeof data.hardInquiries === 'number' ? data.hardInquiries : 0,
    negatives: Array.isArray(data.negatives) ? data.negatives.map(n => ({
      name: n.name || 'Unknown Account',
      type: n.type || 'Collection',
      balance: n.balance || 'N/A',
      opened: n.opened || 'Unknown',
    })) : [],
    utilAccounts: Array.isArray(data.utilAccounts) ? data.utilAccounts.map(a => ({
      name: a.name || 'Unknown',
      balance: typeof a.balance === 'number' ? a.balance : 0,
      limit: typeof a.limit === 'number' ? a.limit : 0,
      utilPct: typeof a.utilPct === 'number' ? Math.min(100, Math.max(0, a.utilPct)) : 0,
    })) : [],
    goodAccounts: Array.isArray(data.goodAccounts) ? data.goodAccounts.map(a => ({
      name: a.name || 'Unknown',
      type: a.type || 'Other',
      since: a.since || 'Unknown',
    })) : [],
    summary: data.summary || '',
  };
}

module.exports = { interpretCreditReport };
