// services/pipelineRouter.js
// Decides which Azure service to use based on file type and content

// NOTE: pdf-parse is lazy-loaded inside hasTextLayer() to avoid a known issue
// where it tries to require test files from disk on module load, crashing the
// process in Railway/Docker environments before the server can start.
const { extractTextFromPDF } = require('./documentIntelligence');
const { extractTextFromImage } = require('./visionOCR');

const MIN_TEXT_LENGTH = 100; // PDFs with fewer chars are likely scanned

/**
 * Route a file to the correct Azure pipeline and return raw extracted text.
 *
 * Decision logic:
 * 1. If file is an image (JPG/PNG) → Vision OCR
 * 2. If file is a PDF:
 *    a. Try to extract text layer locally with pdf-parse
 *    b. If text layer is substantial (>100 chars) → Document Intelligence
 *    c. If text layer is thin (scanned PDF) → Vision OCR
 * 3. If pipeline is explicitly forced ('vision' or 'docint') → use that
 */
async function routeFile(fileBuffer, mimeType, forcePipeline = null) {
  // Force override — frontend can specify based on user selection
  if (forcePipeline === 'vision') {
    return {
      text: await extractTextFromImage(fileBuffer, mimeType),
      pipeline: 'vision',
    };
  }

  if (forcePipeline === 'docint') {
    return {
      text: await extractTextFromPDF(fileBuffer),
      pipeline: 'docint',
    };
  }

  // Auto-detect
  if (isImage(mimeType)) {
    return {
      text: await extractTextFromImage(fileBuffer, mimeType),
      pipeline: 'vision',
    };
  }

  if (isPDF(mimeType)) {
    const isDigital = await hasTextLayer(fileBuffer);
    if (isDigital) {
      return {
        text: await extractTextFromPDF(fileBuffer),
        pipeline: 'docint',
      };
    } else {
      // Scanned PDF — treat as image
      return {
        text: await extractTextFromImage(fileBuffer, 'application/pdf'),
        pipeline: 'vision',
      };
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Quick local check — does this PDF have a real text layer?
 * Uses pdf-parse which runs locally (no Azure cost).
 * Lazy-loaded to avoid Railway/Docker startup crash (pdf-parse test file issue).
 */
async function hasTextLayer(pdfBuffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(pdfBuffer, { max: 3 }); // only check first 3 pages
    return data.text && data.text.trim().length > MIN_TEXT_LENGTH;
  } catch (e) {
    // If pdf-parse fails, assume it might be scanned and let Azure handle it
    return false;
  }
}

function isImage(mimeType) {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimeType);
}

function isPDF(mimeType) {
  return mimeType === 'application/pdf';
}

module.exports = { routeFile };
