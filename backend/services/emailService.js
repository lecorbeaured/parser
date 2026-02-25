// services/emailService.js
// Sends the credit report PDF summary via Resend
// Sign up at resend.com — free tier is 3,000 emails/month

const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'reports@yourdomain.com';
const FROM_NAME = process.env.FROM_NAME || 'PARSEUR 10X';

/**
 * Send the credit report summary email via Resend.
 * @param {string} toEmail - recipient email address
 * @param {object} reportData - parsed report data from GPT-4o
 */
async function sendReportEmail(toEmail, reportData) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const html = buildEmailHTML(reportData);
  const subject = `Your ${reportData.bureau} Credit Report Analysis — PARSEUR 10X`;

  const payload = JSON.stringify({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [toEmail],
    subject,
    html,
  });

  return await resendRequest('/emails', payload);
}

/**
 * Send a plain confirmation when someone hits the email gate
 * (no report data available yet — they submitted email before parsing)
 */
async function sendWelcomeEmail(toEmail) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const html = buildWelcomeHTML();

  const payload = JSON.stringify({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [toEmail],
    subject: 'Welcome to PARSEUR 10X — Your Credit Report Decoder',
    html,
  });

  return await resendRequest('/emails', payload);
}

// ── RESEND API CALL ───────────────────────────────────
function resendRequest(path, payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Resend error ${res.statusCode}: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Invalid response from Resend API'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── EMAIL TEMPLATES ───────────────────────────────────
function buildEmailHTML(data) {
  const scoreColor = data.score >= 740 ? '#1a7a40' : data.score >= 670 ? '#0070a0' : data.score >= 580 ? '#a06000' : '#cc2244';
  const scoreLabel = data.score >= 740 ? 'Very Good' : data.score >= 670 ? 'Good' : data.score >= 580 ? 'Fair' : 'Poor';

  const negativeRows = data.negatives.length > 0
    ? data.negatives.map(n => `
        <tr>
          <td style="padding:10px 14px; border-bottom:1px solid #f0f0f0; font-size:13px;">${n.name}</td>
          <td style="padding:10px 14px; border-bottom:1px solid #f0f0f0; font-size:13px;">${n.type}</td>
          <td style="padding:10px 14px; border-bottom:1px solid #f0f0f0; font-size:13px;">${n.balance}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" style="padding:16px; text-align:center; color:#888; font-size:13px;">No negative items found</td></tr>`;

  const actionItems = buildActionItems(data);

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family: Georgia, serif;">

  <div style="max-width:600px; margin:32px auto; background:#ffffff; border:1px solid #e0e0e0;">

    <!-- Header -->
    <div style="background:#080C10; padding:28px 36px; display:flex; align-items:center;">
      <div style="font-family:Arial,sans-serif; font-size:22px; font-weight:900; color:#ffffff; letter-spacing:-0.5px;">
        PARSEUR <span style="color:#00E5FF;">10X</span>
      </div>
      <div style="margin-left:auto; font-family:monospace; font-size:10px; color:#5A7080; letter-spacing:1px; text-transform:uppercase;">
        Credit Report Analysis
      </div>
    </div>

    <!-- Score Banner -->
    <div style="background:#f8f9fa; border-bottom:1px solid #e0e0e0; padding:28px 36px; text-align:center;">
      <div style="font-family:monospace; font-size:11px; letter-spacing:2px; color:#888; text-transform:uppercase; margin-bottom:8px;">
        ${data.bureau} · FICO Score
      </div>
      <div style="font-family:Arial,sans-serif; font-size:56px; font-weight:900; color:${scoreColor}; line-height:1; margin-bottom:6px;">
        ${data.score || 'N/A'}
      </div>
      <div style="font-size:14px; color:${scoreColor}; font-weight:600; margin-bottom:16px;">${scoreLabel}</div>
      <div style="display:inline-flex; gap:0;">
        <div style="background:#ffffff; border:1px solid #e0e0e0; padding:10px 20px; text-align:center; min-width:100px;">
          <div style="font-size:11px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px;">Utilization</div>
          <div style="font-family:Arial,sans-serif; font-size:20px; font-weight:800; color:${data.utilization > 70 ? '#cc2244' : data.utilization > 30 ? '#a06000' : '#1a7a40'};">${data.utilization}%</div>
        </div>
        <div style="background:#ffffff; border:1px solid #e0e0e0; border-left:none; padding:10px 20px; text-align:center; min-width:100px;">
          <div style="font-size:11px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px;">Negatives</div>
          <div style="font-family:Arial,sans-serif; font-size:20px; font-weight:800; color:${data.negatives.length > 0 ? '#cc2244' : '#1a7a40'};">${data.negatives.length}</div>
        </div>
        <div style="background:#ffffff; border:1px solid #e0e0e0; border-left:none; padding:10px 20px; text-align:center; min-width:100px;">
          <div style="font-size:11px; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px;">Accounts</div>
          <div style="font-family:Arial,sans-serif; font-size:20px; font-weight:800; color:#080C10;">${data.totalAccounts}</div>
        </div>
      </div>
    </div>

    <div style="padding:28px 36px;">

      ${data.summary ? `
      <!-- Summary -->
      <div style="background:#f0fbff; border-left:4px solid #00C8E0; padding:16px 20px; margin-bottom:28px;">
        <div style="font-family:Arial,sans-serif; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#0070a0; margin-bottom:6px;">Report Summary</div>
        <div style="font-size:14px; color:#333; line-height:1.7;">${data.summary}</div>
      </div>` : ''}

      <!-- Negative Items -->
      <div style="font-family:Arial,sans-serif; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#080C10; border-bottom:2px solid #080C10; padding-bottom:6px; margin-bottom:14px;">
        Negative Items
      </div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:28px; font-family:monospace;">
        <thead>
          <tr style="background:#080C10;">
            <th style="padding:9px 14px; text-align:left; color:#fff; font-size:10px; letter-spacing:1px; text-transform:uppercase;">Account</th>
            <th style="padding:9px 14px; text-align:left; color:#fff; font-size:10px; letter-spacing:1px; text-transform:uppercase;">Type</th>
            <th style="padding:9px 14px; text-align:left; color:#fff; font-size:10px; letter-spacing:1px; text-transform:uppercase;">Balance</th>
          </tr>
        </thead>
        <tbody>${negativeRows}</tbody>
      </table>

      <!-- Action Plan -->
      <div style="font-family:Arial,sans-serif; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#080C10; border-bottom:2px solid #080C10; padding-bottom:6px; margin-bottom:14px;">
        Your Action Plan
      </div>
      ${actionItems}

      <!-- CTA -->
      <div style="background:#080C10; padding:24px; text-align:center; margin-top:28px;">
        <div style="font-family:Arial,sans-serif; font-size:14px; font-weight:800; color:#ffffff; margin-bottom:6px;">Ready to take action?</div>
        <div style="font-size:12px; color:#5A7080; margin-bottom:16px;">Parse another bureau or start your dispute process today.</div>
        <a href="https://yourdomain.com" style="display:inline-block; background:#00E5FF; color:#080C10; font-family:Arial,sans-serif; font-size:13px; font-weight:800; padding:13px 28px; text-decoration:none; text-transform:uppercase; letter-spacing:1px;">
          Go to PARSEUR 10X →
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="padding:16px 36px; border-top:1px solid #e0e0e0; font-family:monospace; font-size:10px; color:#aaa; text-align:center; line-height:1.8;">
      PARSEUR 10X · creditfasttrack10x.live<br>
      This report is for informational purposes only and does not constitute legal or financial advice.<br>
      <a href="https://yourdomain.com/unsubscribe" style="color:#aaa;">Unsubscribe</a>
    </div>

  </div>
</body>
</html>`;
}

function buildActionItems(data) {
  const items = [];

  if (data.negatives.length > 0) {
    items.push({
      n: 1,
      title: 'Dispute Your Negative Items',
      desc: `You have ${data.negatives.length} negative item${data.negatives.length > 1 ? 's' : ''} that may be disputable under FCRA § 611. The bureau has 30 days to verify or remove each one.`,
      link: 'https://creditfasttrack10x.live/credit-repair',
      linkLabel: 'Credit Repair Accelerator — Full Dispute System ($127)',
    });
  }

  if (data.utilization > 30) {
    items.push({
      n: items.length + 1,
      title: 'Reduce Your Credit Utilization',
      desc: `Your utilization is at ${data.utilization}%. Getting below 30% can add 20–40 points to your score. Pay down your highest-utilization cards first.`,
      link: null,
    });
  }

  if (data.score < 700 || data.totalAccounts < 4) {
    items.push({
      n: items.length + 1,
      title: 'Build Positive Payment History',
      desc: 'Adding accounts that report to all 3 bureaus accelerates score growth. A credit builder loan or secured card adds positive history with minimal risk.',
      link: 'https://creditfasttrack10x.live/',
      linkLabel: 'Credit Fast Track 10X — 90-Day Score Building System ($67)',
    });
  }

  items.push({
    n: items.length + 1,
    title: 'Build Business Credit in Parallel',
    desc: 'Business credit is tracked separately from your personal FICO. You can start building a fundable business profile right now regardless of your personal score.',
    link: 'https://creditfasttrack10x.live/business-credit',
    linkLabel: 'Business Credit Unleashed — No-PG Vendor System ($197)',
  });

  return items.map(item => `
    <div style="background:#f8f9fa; border-left:4px solid #00C8E0; padding:16px 20px; margin-bottom:10px;">
      <div style="font-family:Arial,sans-serif; font-size:13px; font-weight:700; color:#080C10; margin-bottom:4px;">${item.n}. ${item.title}</div>
      <div style="font-size:13px; color:#555; line-height:1.6; margin-bottom:${item.link ? '8px' : '0'};">${item.desc}</div>
      ${item.link ? `<a href="${item.link}" style="font-size:11px; color:#007a99; font-family:monospace;">→ ${item.linkLabel}</a>` : ''}
    </div>`).join('');
}

function buildWelcomeHTML() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#f4f4f4; font-family:Georgia,serif;">
  <div style="max-width:560px; margin:32px auto; background:#fff; border:1px solid #e0e0e0;">
    <div style="background:#080C10; padding:28px 36px;">
      <div style="font-family:Arial,sans-serif; font-size:22px; font-weight:900; color:#fff; letter-spacing:-0.5px;">PARSEUR <span style="color:#00E5FF;">10X</span></div>
    </div>
    <div style="padding:36px;">
      <div style="font-family:Arial,sans-serif; font-size:20px; font-weight:800; margin-bottom:12px;">You're on the list.</div>
      <div style="font-size:14px; color:#555; line-height:1.8; margin-bottom:24px;">
        Next time you parse a report, enter this email address and we'll send you a full breakdown — negative items, utilization analysis, and a personalized action plan — straight to your inbox.
      </div>
      <a href="https://yourdomain.com" style="display:inline-block; background:#00E5FF; color:#080C10; font-family:Arial,sans-serif; font-size:13px; font-weight:800; padding:13px 28px; text-decoration:none; text-transform:uppercase; letter-spacing:1px;">Parse Your Report Now →</a>
    </div>
    <div style="padding:16px 36px; border-top:1px solid #e0e0e0; font-size:10px; color:#aaa; font-family:monospace; text-align:center;">
      PARSEUR 10X · <a href="https://yourdomain.com/unsubscribe" style="color:#aaa;">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Forward a contact form submission to the site owner inbox
 */
async function sendContactEmail({ name, email, subject, message }) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  const CONTACT_INBOX = process.env.CONTACT_EMAIL || FROM_EMAIL;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Georgia,serif; color:#111; padding:32px; max-width:560px;">
  <div style="font-family:Arial,sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#888; margin-bottom:20px;">PARSEUR 10X · Contact Form</div>
  <table style="width:100%; border-collapse:collapse; font-size:13px; margin-bottom:20px;">
    <tr><td style="padding:8px 0; border-bottom:1px solid #eee; color:#888; width:80px;">From</td><td style="padding:8px 0; border-bottom:1px solid #eee;">${name} &lt;${email}&gt;</td></tr>
    <tr><td style="padding:8px 0; border-bottom:1px solid #eee; color:#888;">Topic</td><td style="padding:8px 0; border-bottom:1px solid #eee;">${subject || 'Not specified'}</td></tr>
  </table>
  <div style="background:#f8f9fa; border-left:4px solid #00C8E0; padding:16px 20px; font-size:14px; line-height:1.8; color:#333;">${message.replace(/\n/g, '<br>')}</div>
  <div style="margin-top:20px; font-size:11px; color:#aaa;">Reply directly to this email to respond to ${name}.</div>
</body></html>`;

  const payload = JSON.stringify({
    from: `${FROM_NAME} Contact <${FROM_EMAIL}>`,
    to: [CONTACT_INBOX],
    reply_to: email,
    subject: `[Contact] ${subject || 'New message'} — ${name}`,
    html,
  });

  return await resendRequest('/emails', payload);
}

module.exports = { sendReportEmail, sendWelcomeEmail, sendContactEmail };
