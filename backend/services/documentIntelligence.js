// services/documentIntelligence.js
// Handles digital PDFs via Azure Document Intelligence (prebuilt-read model)

const axios = require('axios');

const ENDPOINT = process.env.AZURE_DOC_INTEL_ENDPOINT;
const KEY = process.env.AZURE_DOC_INTEL_KEY;
const API_VERSION = '2023-07-31';

/**
 * Extract raw text from a PDF buffer using Azure Document Intelligence.
 * Uses the prebuilt-read model — no custom training needed.
 * Returns the full concatenated text from all pages.
 */
async function extractTextFromPDF(fileBuffer) {
  if (!ENDPOINT || !KEY) {
    throw new Error('Azure Document Intelligence credentials not configured');
  }

  const analyzeUrl = `${ENDPOINT}formrecognizer/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`;

  // Step 1: Submit the document for analysis
  const submitResponse = await axios.post(analyzeUrl, fileBuffer, {
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/pdf',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  // The operation URL is returned in the header
  const operationUrl = submitResponse.headers['operation-location'];
  if (!operationUrl) {
    throw new Error('No operation URL returned from Document Intelligence');
  }

  // Step 2: Poll until the analysis is complete
  const text = await pollForResult(operationUrl);
  return text;
}

async function pollForResult(operationUrl, maxAttempts = 30, delayMs = 1000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(delayMs);

    const result = await axios.get(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': KEY },
    });

    const status = result.data.status;

    if (status === 'succeeded') {
      return extractTextFromResult(result.data);
    }

    if (status === 'failed') {
      throw new Error('Document Intelligence analysis failed: ' + JSON.stringify(result.data.error));
    }

    // status === 'running' | 'notStarted' — keep polling
  }

  throw new Error('Document Intelligence timed out after ' + maxAttempts + ' attempts');
}

function extractTextFromResult(resultData) {
  const pages = resultData?.analyzeResult?.pages || [];
  const lines = [];

  for (const page of pages) {
    for (const line of (page.lines || [])) {
      lines.push(line.content);
    }
    lines.push(''); // blank line between pages
  }

  return lines.join('\n').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { extractTextFromPDF };
