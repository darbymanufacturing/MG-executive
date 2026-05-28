/**
 * api/invoice-parse.js — Extract structured data from an invoice image.
 *
 * POST /api/invoice-parse
 * Body (JSON):
 *   { imageBase64: string,  mediaType: "image/jpeg"|"image/png"|"image/webp"|"image/gif" }
 *   OR
 *   { imageUrl: string }  ← publicly accessible URL
 *
 * Returns:
 *   { vendor, amount, currency, date, vatAmount, vatPercent, invoiceNumber,
 *     suggestedCategory, confidence, rawText, error? }
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

const SYSTEM_PROMPT = `You are an invoice data extraction assistant for a Greek micromobility company.
Extract the following fields from the invoice image and return ONLY valid JSON — no markdown, no explanation:

{
  "vendor": "company or person name",
  "amount": number (total amount, no currency symbol),
  "currency": "EUR"|"USD"|"GBP"|"other",
  "date": "YYYY-MM-DD or null",
  "vatAmount": number or null,
  "vatPercent": number or null (e.g. 24 for 24% Greek VAT),
  "invoiceNumber": "string or null",
  "lineItems": [ { "description": "string", "quantity": number or null, "unitPrice": number or null, "total": number } ],
  "suggestedCategory": "fixed"|"variable"|"loan"|"credit-card",
  "confidence": "high"|"medium"|"low",
  "rawText": "key visible text from the invoice (first 300 chars)"
}

Rules:
- Greek VAT (ΦΠΑ) is typically 24%. Extract the pre-VAT and VAT amounts if visible.
- If the amount is ambiguous, use the final total (after VAT).
- suggestedCategory: use "fixed" for rent/utilities/insurance, "variable" for fuel/parts/services, "credit-card" if appears to be a card statement.
- confidence: "high" if all key fields clearly visible, "medium" if some inference was needed, "low" if major fields are unclear.
- Return null for any field not clearly determinable from the image.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
  }

  const { imageBase64, mediaType = 'image/jpeg', imageUrl } = req.body || {};

  if (!imageBase64 && !imageUrl) {
    return res.status(400).json({ error: 'imageBase64 or imageUrl is required' });
  }

  try {
    let imageSource;

    if (imageBase64) {
      /* Validate media type */
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowed.includes(mediaType)) {
        return res.status(400).json({ error: `Unsupported mediaType. Use one of: ${allowed.join(', ')}` });
      }
      imageSource = {
        type: 'base64',
        media_type: mediaType,
        data: imageBase64.replace(/^data:[^;]+;base64,/, ''), /* strip data URI prefix if present */
      };
    } else {
      imageSource = {
        type: 'url',
        url: imageUrl,
      };
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: imageSource,
            },
            {
              type: 'text',
              text: 'Extract all invoice data from this image. Return JSON only.',
            },
          ],
        },
      ],
    });

    const raw = message.content[0]?.text || '{}';
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(200).json({
        vendor: null,
        amount: null,
        currency: 'EUR',
        date: null,
        vatAmount: null,
        vatPercent: null,
        invoiceNumber: null,
        lineItems: [],
        suggestedCategory: 'variable',
        confidence: 'low',
        rawText: cleaned.slice(0, 300),
        error: 'Could not parse extraction result',
      });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('invoice-parse error:', err);
    return res.status(500).json({ error: err.message || 'Invoice parsing failed' });
  }
}
