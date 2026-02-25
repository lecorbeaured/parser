// services/visionOCR.js
// Handles scanned images and image-based PDFs via Azure AI Vision Read API

const axios = require('axios');
const FormData = require('form-data');

const ENDPOINT = process.env.AZURE_VISION_ENDPOINT;
const KEY = process.env.AZURE_VISION_KEY;

/**
 * Extract text from an image (JPG/PNG) or scanned PDF using Azure AI Vision Read API.
 * This is an async operation — submit, then poll for results.
 */
async function extractTextFromImage(fileBuffer, mimeType) {
  if (!ENDPOINT || !KEY) {
    throw new Error('Azure AI Vision credentials not configured');
  }

  const readUrl = `${ENDPOINT}vision/v3.2/read/analyze`;

  // Step 1: Submit image for OCR
  const submitResponse = await axios.post(readUrl, fileBuffer, {
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': mimeType, // 'image/jpeg' | 'image/png' | 'application/pdf'
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const operationUrl = submitResponse.headers['operation-location'];
  if (!operationUrl) {
    throw new Error('No operation URL returned from Azure AI Vision');
  }

  // Step 2: Poll for completion
  const text = await pollForOCRResult(operationUrl);
  return text;
}

async function pollForOCRResult(operationUrl, maxAttempts = 40, delayMs = 1500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(delayMs);

    const result = await axios.get(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': KEY },
    });

    const status = result.data.status;

    if (status === 'succeeded') {
      return extractTextFromOCRResult(result.data);
    }

    if (status === 'failed') {
      throw new Error('Azure AI Vision OCR failed: ' + JSON.stringify(result.data));
    }

    // status === 'running' | 'notStarted' — keep polling
  }

  throw new Error('Azure AI Vision OCR timed out after ' + maxAttempts + ' attempts');
}

function extractTextFromOCRResult(resultData) {
  const readResults = resultData?.analyzeResult?.readResults || [];
  const lines = [];

  for (const page of readResults) {
    for (const line of (page.lines || [])) {
      lines.push(line.text);
    }
    lines.push(''); // blank line between pages
  }

  return lines.join('\n').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { extractTextFromImage };
