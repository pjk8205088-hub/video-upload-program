const path = require('node:path');

function cleanBaseName(fileName = '') {
  const base = path.basename(String(fileName)).replace(/\.[^.]+$/, '');
  return base.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || '새 영상';
}

function localMetadata({ fileName = '', slotNumber = 1, titleHint = '' } = {}) {
  const subject = String(titleHint || cleanBaseName(fileName)).slice(0, 80);
  const words = subject.split(/\s+/).filter(Boolean).slice(0, 4);
  const hashtags = [...new Set(['#영상', '#콘텐츠', ...words.map((word) => `#${word.replace(/[^\p{L}\p{N}]/gu, '')}`).filter((tag) => tag.length > 1)])].slice(0, 8);
  return {
    title: `${subject} | ${slotNumber}번 콘텐츠`.slice(0, 120),
    description: `${subject}를 소개하는 짧은 영상입니다.\n업로드 슬롯 ${slotNumber}번에서 만든 로컬 규칙 기반 초안입니다.\n\n${hashtags.join(' ')}`.slice(0, 1000),
    hashtags,
    source: 'local-fallback'
  };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = payload?.output?.flatMap((item) => item.content || []) || [];
  return parts.map((part) => part.text || '').join('').trim();
}

function parseModelJson(text) {
  const fenced = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response was not JSON');
  const result = JSON.parse(fenced.slice(start, end + 1));
  return {
    title: String(result.title || '').trim().slice(0, 120),
    description: String(result.description || '').trim().slice(0, 1000),
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.map((tag) => String(tag).startsWith('#') ? String(tag) : `#${tag}`).slice(0, 12) : [],
    source: 'openai'
  };
}

async function generateMetadata(input = {}, options = {}) {
  const fallback = localMetadata(input);
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return fallback;
  try {
    const response = await fetch(options.endpoint || 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: options.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        input: `영상 파일명: ${input.fileName || '새 영상'}\n슬롯: ${input.slotNumber || 1}\n제목, 설명, 해시태그를 한국어로 JSON으로 작성하세요. 키는 title, description, hashtags만 사용하세요.`,
        text: { format: { type: 'json_object' } }
      }),
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const parsed = parseModelJson(extractResponseText(await response.json()));
    return parsed.title && parsed.description ? parsed : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { generateMetadata, localMetadata, cleanBaseName };
