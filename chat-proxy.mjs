/**
 * Local proxy so the dashboard can use Gemini / OpenAI without exposing keys in the browser.
 *
 * Setup:
 *   1. Copy env.example to .env
 *   2. Add GEMINI_API_KEY from https://aistudio.google.com/apikey (free tier)
 *   3. npm install && npm run chat-proxy
 *
 * Default model: gemini-2.0-flash (override with GEMINI_MODEL in .env)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const PORT = Number(process.env.CHAT_PROXY_PORT) || 8787;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '512kb' }));

function openAiMessagesToGeminiContents(messages) {
  let systemText = '';
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemText += (systemText ? '\n' : '') + m.content;
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (role === 'user' || role === 'model') {
      contents.push({ role, parts: [{ text: String(m.content || '') }] });
    }
  }
  return { systemText, contents };
}

app.get('/api/health', (_req, res) => {
  const hasGemini = Boolean(GEMINI_KEY);
  const hasOpenAI = Boolean(OPENAI_KEY);
  res.json({
    ok: true,
    gemini: hasGemini,
    openai: hasOpenAI,
    model: hasGemini ? GEMINI_MODEL : hasOpenAI ? OPENAI_MODEL : null
  });
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must include messages: [{role, content}, ...]' });
  }

  try {
    if (GEMINI_KEY) {
      const { systemText, contents } = openAiMessagesToGeminiContents(messages);
      if (contents.length === 0) {
        return res.status(400).json({ error: 'No user/model messages after system' });
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
      const body = {
        contents,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.45
        }
      };
      if (systemText) {
        body.systemInstruction = { parts: [{ text: systemText }] };
      }

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data.error?.message || JSON.stringify(data).slice(0, 300);
        return res.status(r.status >= 400 ? r.status : 502).json({ error: msg });
      }
      const text =
        data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ||
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        '';
      if (!text && data.promptFeedback?.blockReason) {
        return res.status(400).json({ error: 'Blocked: ' + data.promptFeedback.blockReason });
      }
      return res.json({ reply: text.trim() || '(empty model response)', model: GEMINI_MODEL, provider: 'gemini' });
    }

    if (OPENAI_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages,
          max_tokens: 900,
          temperature: 0.45
        })
      });
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status >= 400 ? r.status : 502).json({
          error: data.error?.message || JSON.stringify(data).slice(0, 300)
        });
      }
      const reply = data.choices?.[0]?.message?.content?.trim() || '';
      return res.json({ reply: reply || '(empty)', model: OPENAI_MODEL, provider: 'openai' });
    }

    return res.status(503).json({
      error:
        'No API key configured. Set GEMINI_API_KEY (recommended) or OPENAI_API_KEY in .env — see env.example'
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Hospital chat proxy → http://127.0.0.1:${PORT}/api/chat`);
  console.log(`Health check → http://127.0.0.1:${PORT}/api/health`);
  if (GEMINI_KEY) console.log(`Using Gemini model: ${GEMINI_MODEL}`);
  else if (OPENAI_KEY) console.log(`Using OpenAI model: ${OPENAI_MODEL}`);
  else console.log('WARNING: No GEMINI_API_KEY or OPENAI_API_KEY in .env');
});
