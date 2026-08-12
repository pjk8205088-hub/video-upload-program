const path = require('node:path');

function cleanBaseName(fileName = '') {
  const base = path.basename(String(fileName)).replace(/\.[^.]+$/, '');
  return base.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || '새 영상';
}

const NAVER_CLIP_CATEGORY_RULES = [
  { primary: '쇼핑', secondary: '상품 정보', keywords: ['쇼핑', '상품', '구매', '가격', '할인', '리뷰', '언박싱', '추천', '쿠팡', '제품', '사용기', '정보'] },
  { primary: '라이프 이벤트', secondary: '라이프 이벤트', keywords: ['일상', '브이로그', '하루', '생활', '기록'] },
  { primary: '여행', secondary: '여행지', keywords: ['여행', '관광', '호텔', '바다', '제주', '캠핑'] },
  { primary: '푸드', secondary: '레시피', keywords: ['맛집', '먹방', '요리', '레시피', '카페', '음식'] },
  { primary: '뷰티', secondary: '뷰티 팁', keywords: ['뷰티', '메이크업', '화장', '스킨케어', '헤어'] },
  { primary: '패션', secondary: '스타일링', keywords: ['패션', '코디', '옷', '스타일', '룩북'] },
  { primary: '스포츠', secondary: '스포츠', keywords: ['스포츠', '축구', '야구', '농구', '운동', '헬스'] },
  { primary: '엔터테인먼트', secondary: '댄스', keywords: ['댄스', '춤', '아이돌', '음악', '공연', '콘서트'] },
  { primary: '반려동물', secondary: '반려동물', keywords: ['강아지', '고양이', '반려동물', '펫'] },
  { primary: '교육', secondary: '노하우', keywords: ['공부', '교육', '강의', '팁', '방법', '노하우'] }
];

function inferNaverClipCategory(value = '') {
  const normalized = String(value).toLowerCase();
  const fallback = NAVER_CLIP_CATEGORY_RULES.find((rule) => rule.primary === '라이프 이벤트');
  return NAVER_CLIP_CATEGORY_RULES.filter((rule) => rule !== fallback).find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword))) || fallback;
}

function createNaverClipMetadata({ subject = '새 영상', slotNumber = 1, title = '', description = '', hashtags = [], primaryCategory = '', secondaryCategory = '' } = {}) {
  const fallback = inferNaverClipCategory(`${subject} ${title} ${description}`);
  const category = NAVER_CLIP_CATEGORY_RULES.find((rule) => rule.primary === primaryCategory && rule.secondary === secondaryCategory) || fallback;
  const normalizedHashtags = [...new Set((hashtags || []).map((tag) => String(tag).startsWith('#') ? String(tag) : `#${tag}`).filter((tag) => tag.length > 1))].slice(0, 8);
  const clipDescription = String(description || `${subject}의 핵심 장면을 짧게 담은 네이버 클립입니다. ${slotNumber}번 영상의 포인트를 지금 확인해 보세요.`).trim().slice(0, 300);
  return { title: String(title || `${subject} ${slotNumber}번 클립`).trim().slice(0, 80), description: clipDescription, hashtags: normalizedHashtags, primaryCategory: category.primary, secondaryCategory: category.secondary };
}

function createInstagramMetadata({ title = '', description = '', hashtags = [], shareToFeed = true, allowComments = true } = {}) {
  return { caption: String(description || title || '새 릴스').trim().slice(0, 2200), hashtags: [...new Set((hashtags || []).map((tag) => String(tag).startsWith('#') ? String(tag) : `#${tag}`).filter((tag) => tag.length > 1))].slice(0, 30), shareToFeed: shareToFeed !== false, allowComments: allowComments !== false };
}

function localMetadata({ fileName = '', slotNumber = 1, titleHint = '' } = {}) {
  const subject = String(titleHint || cleanBaseName(fileName)).slice(0, 80);
  const words = subject.split(/\s+/).filter(Boolean).slice(0, 4);
  const hashtags = [...new Set(['#영상', '#콘텐츠', ...words.map((word) => `#${word.replace(/[^\p{L}\p{N}]/gu, '')}`).filter((tag) => tag.length > 1)])].slice(0, 8);
  const title = `${subject} | ${slotNumber}번 콘텐츠`.slice(0, 120);
  const description = `${subject}를 소개하는 짧은 영상입니다.\n업로드 슬롯 ${slotNumber}번에서 만든 로컬 규칙 기반 초안입니다.\n\n${hashtags.join(' ')}`.slice(0, 1000);
  return {
    title,
    description,
    hashtags,
    naverClip: createNaverClipMetadata({ subject, slotNumber, title, description, hashtags }),
    instagram: createInstagramMetadata({ title, description, hashtags }),
    source: 'local-fallback'
  };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  const parts = payload?.output?.flatMap((item) => item.content || []) || [];
  return parts.map((part) => part.text || '').join('').trim();
}

function parseModelJson(text, input = {}) {
  const fenced = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response was not JSON');
  const result = JSON.parse(fenced.slice(start, end + 1));
  const title = String(result.title || '').trim().slice(0, 120);
  const description = String(result.description || '').trim().slice(0, 1000);
  const hashtags = Array.isArray(result.hashtags) ? result.hashtags.map((tag) => String(tag).startsWith('#') ? String(tag) : `#${tag}`).slice(0, 12) : [];
  return {
    title,
    description,
    hashtags,
    naverClip: createNaverClipMetadata({ subject: cleanBaseName(input.fileName), slotNumber: input.slotNumber, title, description: result.naverClip?.description || description, hashtags, primaryCategory: result.naverClip?.primaryCategory, secondaryCategory: result.naverClip?.secondaryCategory }),
    instagram: createInstagramMetadata({ title: result.instagram?.caption || title, description: result.instagram?.caption || description, hashtags: result.instagram?.hashtags || hashtags, shareToFeed: result.instagram?.shareToFeed, allowComments: result.instagram?.allowComments }),
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
        input: `영상 파일명: ${input.fileName || '새 영상'}\n슬롯: ${input.slotNumber || 1}\n서비스: ${input.provider || '공통'}\n제목, 설명, 해시태그를 한국어로 JSON으로 작성하세요. 키는 title, description, hashtags를 사용하세요. Instagram이면 instagram 객체에 caption(2200자 이내), hashtags, shareToFeed, allowComments도 작성하세요. 네이버 클립이면 naverClip 객체에 description(300자 이내), primaryCategory, secondaryCategory도 작성하고 상품·구매·가격·할인·리뷰·정보성 내용은 쇼핑·상품 정보로 선택하세요. 그 외 카테고리는 라이프 이벤트·여행·푸드·뷰티·패션·스포츠·엔터테인먼트·반려동물·교육 중에서 선택하세요.`,
        text: { format: { type: 'json_object' } }
      }),
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const parsed = parseModelJson(extractResponseText(await response.json()), input);
    return parsed.title && parsed.description ? parsed : fallback;
  } catch {
    return fallback;
  }
}

module.exports = { generateMetadata, localMetadata, cleanBaseName, createNaverClipMetadata, createInstagramMetadata, inferNaverClipCategory, NAVER_CLIP_CATEGORY_RULES };
