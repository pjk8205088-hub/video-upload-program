const LIFE_PREFIX = '\uB77C\uC774\uD504';
const LIFE_STYLE = '\uB77C\uC774\uD504\uC2A4\uD0C0\uC77C';

function normalizeNaverCategory(value) {
  const text = String(value || '').trim();
  return text.startsWith(LIFE_PREFIX) ? LIFE_STYLE : text;
}

module.exports = { normalizeNaverCategory, LIFE_STYLE };
