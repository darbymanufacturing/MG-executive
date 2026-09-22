/**
 * api/_lib/transcribe.js — turn a WhatsApp voice note into text
 * (docs/AUTOMATION_PLAN.md §4.4).
 *
 * The team talks while working — a voice note is the fastest way to log
 * "41735 άλλαξα ντίζα φρένου, 25 λεπτά" with oily hands. WhatsApp sends OGG/Opus.
 *
 * Providers, in order of preference:
 *   1. Google Cloud Speech-to-Text — 60 free minutes per month, standing (not a
 *      trial), Greek supported. Covers this team's volume at €0.
 *   2. OpenAI Whisper — $0.006/min, used only if a key is present and Google
 *      isn't configured (or fails).
 *
 * Returns null rather than throwing when nothing is configured: the caller then
 * asks the sender to type it, which is a better outcome than an error.
 *
 * NOTE: Greek accuracy is not benchmarked in either vendor's docs. The webhook
 * always echoes the transcript back so a mis-hear is caught immediately.
 */

const GOOGLE_STT = 'https://speech.googleapis.com/v1/speech:recognize';
const OPENAI_STT = 'https://api.openai.com/v1/audio/transcriptions';
const LANG = process.env.TRANSCRIBE_LANGUAGE || 'el-GR';

/** WhatsApp voice notes are OGG/Opus; map to each API's encoding vocabulary. */
function googleEncoding(mimeType) {
  if (!mimeType) return 'OGG_OPUS';
  if (mimeType.includes('ogg')) return 'OGG_OPUS';
  if (mimeType.includes('amr')) return 'AMR';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'MP3';
  if (mimeType.includes('wav')) return 'LINEAR16';
  return 'ENCODING_UNSPECIFIED';
}

async function viaGoogle({ base64, mimeType }) {
  const key = process.env.GOOGLE_STT_API_KEY;
  if (!key) return null;

  const res = await fetch(`${GOOGLE_STT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        encoding: googleEncoding(mimeType),
        languageCode: LANG,
        alternativeLanguageCodes: ['en-US'], // the team mixes Greek and English
        enableAutomaticPunctuation: true,
        model: 'default',
      },
      audio: { content: base64 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    console.warn('[transcribe] google', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const json = await res.json();
  const text = (json.results || [])
    .map((r) => r.alternatives?.[0]?.transcript || '')
    .join(' ')
    .trim();
  return text || null;
}

async function viaOpenAI({ base64, mimeType }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const form = new FormData();
  form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: mimeType || 'audio/ogg' }), 'voice.ogg');
  form.append('model', process.env.TRANSCRIBE_MODEL || 'whisper-1');
  form.append('language', LANG.split('-')[0]);

  const res = await fetch(OPENAI_STT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    console.warn('[transcribe] openai', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return null;
  }
  const json = await res.json();
  return (json.text || '').trim() || null;
}

/**
 * @param {{base64:string, mimeType:string}} media
 * @returns {Promise<string|null>} transcript, or null when unavailable
 */
export async function transcribeAudio(media) {
  if (!media?.base64) return null;
  try {
    const google = await viaGoogle(media);
    if (google) return google;
  } catch (err) {
    console.warn('[transcribe] google failed:', err?.message || err);
  }
  try {
    return await viaOpenAI(media);
  } catch (err) {
    console.warn('[transcribe] openai failed:', err?.message || err);
    return null;
  }
}
