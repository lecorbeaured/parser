// server.js — PARSEUR 10X Backend
// Express API server that handles credit report parsing

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const { routeFile } = require('./services/pipelineRouter');
const { interpretCreditReport } = require('./services/gptInterpreter');
const { sendReportEmail, sendWelcomeEmail } = require('./services/emailService');

// Stripe payment link — create at dashboard.stripe.com → Payment Links
// Set your $9/month product, copy the link, paste below
const STRIPE_PAYMENT_LINK = process.env.STRIPE_PAYMENT_LINK || null;

const app = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY ──────────────────────────────────────────
app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type'],
}));

// ── RATE LIMITING ─────────────────────────────────────
// 10 parse requests per IP per hour — backend-level abuse protection
// Works alongside the frontend localStorage gate (3 free)
const parseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many parse requests from this IP. Please try again in an hour.',
    code: 'RATE_LIMITED',
  },
});

// ── FILE UPLOAD ───────────────────────────────────────
// Store in memory (no disk writes) — files are processed and discarded
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload a PDF, JPG, or PNG.'));
    }
  },
});

// ── HEALTH CHECK ──────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    services: {
      documentIntelligence: !!process.env.AZURE_DOC_INTEL_KEY,
      visionOCR: !!process.env.AZURE_VISION_KEY,
      openAI: !!process.env.AZURE_OPENAI_KEY,
    },
  });
});

// ── MAIN PARSE ENDPOINT ───────────────────────────────
// POST /api/parse
// Body: multipart/form-data
//   file    — the credit report file (PDF/JPG/PNG)
//   bureau  — 'equifax' | 'transunion' | 'experian'
//   pipeline — optional: 'docint' | 'vision' (force override)

app.post('/api/parse', parseLimiter, upload.single('file'), async (req, res) => {
  const startTime = Date.now();

  try {
    // ── Validate inputs ──────────────────────────────
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
    }

    const bureau = (req.body.bureau || 'equifax').toLowerCase();
    const validBureaus = ['equifax', 'transunion', 'experian'];
    if (!validBureaus.includes(bureau)) {
      return res.status(400).json({ error: 'Invalid bureau. Must be equifax, transunion, or experian.', code: 'INVALID_BUREAU' });
    }

    const forcePipeline = req.body.pipeline || null; // 'docint' | 'vision' | null

    console.log(`[PARSE] bureau=${bureau} file=${req.file.originalname} size=${req.file.size} mime=${req.file.mimetype} pipeline=${forcePipeline || 'auto'}`);

    // ── Step 1: Extract text ─────────────────────────
    console.log('[PARSE] Step 1: Routing to Azure pipeline...');
    const { text, pipeline } = await routeFile(
      req.file.buffer,
      req.file.mimetype,
      forcePipeline
    );

    if (!text || text.trim().length < 50) {
      return res.status(422).json({
        error: 'Could not extract readable text from this file. If this is a scanned document, try selecting the "Mailed + Scanned" option.',
        code: 'EXTRACTION_FAILED',
      });
    }

    console.log(`[PARSE] Step 1 done: pipeline=${pipeline} chars=${text.length}`);

    // ── Step 2: GPT-4o interpretation ────────────────
    console.log('[PARSE] Step 2: Sending to GPT-4o...');
    const result = await interpretCreditReport(text, bureau);
    console.log(`[PARSE] Step 2 done: score=${result.score} negatives=${result.negativeCount}`);

    // ── Step 3: Return structured result ─────────────
    const elapsed = Date.now() - startTime;
    console.log(`[PARSE] Complete in ${elapsed}ms`);

    return res.json({
      success: true,
      pipeline,
      elapsed,
      data: result,
    });

  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[PARSE ERROR] ${elapsed}ms`, err.message);

    // Return user-friendly error messages
    if (err.message.includes('credentials not configured')) {
      return res.status(503).json({
        error: 'Azure services not configured. Contact support.',
        code: 'SERVICE_UNAVAILABLE',
      });
    }

    if (err.message.includes('timed out')) {
      return res.status(504).json({
        error: 'Processing took too long. Please try again.',
        code: 'TIMEOUT',
      });
    }

    if (err.message.includes('malformed JSON')) {
      return res.status(500).json({
        error: 'Failed to interpret report. Please try again.',
        code: 'INTERPRETATION_ERROR',
      });
    }

    return res.status(500).json({
      error: 'An unexpected error occurred. Please try again.',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ── EMAIL ROUTE ───────────────────────────────────────
// POST /api/email
// Sends the parsed report to the user's inbox via Resend
// Body: { email: string, reportData: object }

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 email sends per IP per hour
  message: { error: 'Too many email requests. Please try again later.', code: 'RATE_LIMITED' },
});

app.post('/api/email', emailLimiter, express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const { email, reportData } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address required.', code: 'INVALID_EMAIL' });
    }

    if (!reportData) {
      // No report data — just capture the email and send a welcome
      await sendWelcomeEmail(email);
      console.log(`[EMAIL] Welcome sent to ${email}`);
      return res.json({ success: true, type: 'welcome' });
    }

    await sendReportEmail(email, reportData);
    console.log(`[EMAIL] Report sent to ${email} bureau=${reportData.bureau}`);
    return res.json({ success: true, type: 'report' });

  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);

    if (err.message.includes('not configured')) {
      return res.status(503).json({ error: 'Email service not configured.', code: 'SERVICE_UNAVAILABLE' });
    }

    return res.status(500).json({ error: 'Failed to send email. Please try again.', code: 'EMAIL_FAILED' });
  }
});

// ── STRIPE LINK ROUTE ─────────────────────────────────
// GET /api/stripe-link
// Returns the Stripe payment link so the frontend can redirect

app.get('/api/stripe-link', (req, res) => {
  if (!STRIPE_PAYMENT_LINK) {
    return res.status(503).json({ error: 'Payment not yet configured.', code: 'NOT_CONFIGURED' });
  }
  res.json({ url: STRIPE_PAYMENT_LINK });
});

// ── CONTACT ROUTE ─────────────────────────────────────
// POST /api/contact
// Forwards contact form submissions to your inbox via Resend

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3, // 3 contact submissions per IP per hour
  message: { error: 'Too many messages. Please try again later.', code: 'RATE_LIMITED' },
});

app.post('/api/contact', contactLimiter, express.json({ limit: '50kb' }), async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.', code: 'MISSING_FIELDS' });
    }

    const { sendContactEmail } = require('./services/emailService');
    await sendContactEmail({ name, email, subject, message });

    console.log(`[CONTACT] From: ${name} <${email}> Subject: ${subject}`);
    return res.json({ success: true });

  } catch (err) {
    console.error('[CONTACT ERROR]', err.message);
    return res.status(500).json({ error: 'Failed to send message. Please try again.', code: 'SEND_FAILED' });
  }
});

// ── FILE UPLOAD ERROR HANDLER ─────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 20MB.', code: 'FILE_TOO_LARGE' });
    }
    return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
  }
  if (err.message && err.message.includes('Unsupported file type')) {
    return res.status(400).json({ error: err.message, code: 'UNSUPPORTED_FILE' });
  }
  next(err);
});

// ── START ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`PARSEUR 10X Backend running on port ${PORT}`);
  console.log(`  Doc Intelligence: ${process.env.AZURE_DOC_INTEL_KEY ? '✓' : '✗ NOT SET'}`);
  console.log(`  Vision OCR:       ${process.env.AZURE_VISION_KEY ? '✓' : '✗ NOT SET'}`);
  console.log(`  Azure OpenAI:     ${process.env.AZURE_OPENAI_KEY ? '✓' : '✗ NOT SET'}`);
});
