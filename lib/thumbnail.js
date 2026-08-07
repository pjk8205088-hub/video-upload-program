function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function thumbnailSvg({ title = '새 영상', slotNumber = 1, hashtags = [] } = {}) {
  const palette = ['#e9f65b', '#ff7b66', '#7c6cff', '#55d6be', '#ffc857'];
  const accent = palette[(Number(slotNumber) - 1) % palette.length];
  const safeTitle = escapeXml(String(title).slice(0, 48));
  const safeTags = escapeXml((hashtags || []).slice(0, 3).join(' '));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${safeTitle}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#2d385f"/></linearGradient><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity=".08"/></pattern></defs>
  <rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#grid)"/>
  <circle cx="1060" cy="120" r="220" fill="${accent}" fill-opacity=".9"/><circle cx="1060" cy="120" r="160" fill="#111827" fill-opacity=".25"/>
  <rect x="78" y="78" width="1124" height="564" rx="28" fill="none" stroke="#ffffff" stroke-opacity=".2"/>
  <text x="104" y="174" fill="${accent}" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="5">UPLOAD DESK · SLOT ${escapeXml(slotNumber)}</text>
  <text x="104" y="375" fill="#ffffff" font-family="Arial, sans-serif" font-size="70" font-weight="700">${safeTitle}</text>
  <text x="104" y="532" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="25">${safeTags}</text>
  <path d="M1100 534l52 30-52 30z" fill="#ffffff"/><text x="104" y="600" fill="#94a3b8" font-family="monospace" font-size="18">AUTO THUMBNAIL · SANDBOX READY</text>
</svg>`;
}

module.exports = { thumbnailSvg };
