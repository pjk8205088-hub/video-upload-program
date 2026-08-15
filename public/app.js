const state = {
  videos: [], accounts: [], campaigns: [], analytics: { jobs: [], totals: {} }, comments: [], logs: [], settings: {},
  selectedSlot: 1, queue: new Map(), calendarMonth: new Date(), pendingUploadSlot: null, pendingQuickProvider: '', quickProviders: new Set(), campaignsLoaded: false, naverClipAutoSlots: new Set(), instagramAutoSlots: new Set(), loginStates: {}, uploadPageStates: {}, uploadPageTasks: new Map(), directUploads: new Set(), accountUploadStates: new Map(), naverUploadStatus: { state: 'idle', message: '' }
};
window.__uploadDeskState = state;

const providers = {
  naver: { label: '네이버 클립', code: 'NV' }, tiktok: { label: 'TikTok', code: 'TT' }, facebook: { label: 'Facebook', code: 'FB' }, instagram: { label: 'Instagram', code: 'IG' }
};
const supportedProviderKeys = new Set(Object.keys(providers));
const loginProviders = [
  { key: 'instagram', label: 'Instagram', code: 'IG', service: 'Meta OAuth', accent: 'coral', title: 'Instagram Business 계정', description: '릴스와 피드 게시 권한을 연결합니다.', scopes: 'instagram_content_publish · instagram_basic', loginUrl: 'https://www.instagram.com/accounts/login/' },
  { key: 'tiktok', label: 'TikTok', code: 'TT', service: 'TikTok OAuth', accent: 'violet', title: 'TikTok 계정', description: 'TikTok 화면의 Facebook 로그인 버튼으로 연결합니다.', scopes: 'video.publish · user.info.basic', requiresProvider: 'facebook', loginUrl: 'https://www.tiktok.com/login?lang=ko-KR' },
  { key: 'naver', label: '네이버 클립', code: 'NV', service: 'NAVER OAuth', accent: 'green', title: '네이버 클립 채널', description: '클립 콘텐츠 게시 권한을 연결합니다.', scopes: 'clip.publish · profile.read', loginUrl: 'https://nid.naver.com/nidlogin.login' },
  { key: 'facebook', label: 'Facebook', code: 'FB', service: 'Meta OAuth', accent: 'blue', title: 'Facebook 페이지', description: '페이지 동영상 게시와 댓글 관리 권한을 연결합니다.', scopes: 'pages_manage_posts · pages_read_engagement', loginUrl: 'https://www.facebook.com/?locale=ko_KR' }
];
const allowedExtensions = new Set(['mp4', 'mov', 'webm', 'mkv']);
const VIDEO_PROFILE = Object.freeze({ width: 1080, height: 1920, ratio: 9 / 16, durationSeconds: 60, videoBitrate: 8_000_000, audioBitrate: 128_000 });
const estimatedProfileBytes = Math.ceil(((VIDEO_PROFILE.videoBitrate + VIDEO_PROFILE.audioBitrate) / 8) * VIDEO_PROFILE.durationSeconds);
const maxFileSize = Math.ceil(estimatedProfileBytes * 1.1);
const NAVER_CLIP_CATEGORIES = [
  { primary: '쇼핑', secondary: '상품 정보' }, { primary: '라이프 이벤트', secondary: '라이프 이벤트' }, { primary: '여행', secondary: '여행지' }, { primary: '푸드', secondary: '레시피' },
  { primary: '뷰티', secondary: '뷰티 팁' }, { primary: '패션', secondary: '스타일링' }, { primary: '스포츠', secondary: '스포츠' },
  { primary: '엔터테인먼트', secondary: '댄스' }, { primary: '반려동물', secondary: '반려동물' }, { primary: '교육', secondary: '노하우' }
];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]); }
function formatNumber(value) { return new Intl.NumberFormat('ko-KR').format(Number(value || 0)); }
function formatDate(value, options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ko-KR', options).format(date); }
function localInputValue(date) { const pad = (value) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function providerFor(key) { return providers[key] || { label: key, code: '??' }; }
function applyProviderCatalog(catalog = []) {
  for (const item of catalog) {
    if (!supportedProviderKeys.has(item.key)) continue;
    providers[item.key] = { ...providers[item.key], label: item.label || providers[item.key].label, code: item.code || providers[item.key].code };
    const loginProvider = loginProviderFor(item.key);
    if (loginProvider) Object.assign(loginProvider, { loginUrl: item.loginUrl || loginProvider.loginUrl, requiresProvider: item.requiresProvider || undefined });
  }
}
function videoForSlot(slot) { return state.videos.find((video) => video.slotNumber === Number(slot)); }
function showToast(message, isError = false) { const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('is-error', isError); toast.classList.add('is-visible'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3400); }
async function api(url, options = {}) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(payload.error?.message || '요청을 처리하지 못했습니다.'), { payload, status: response.status }); return payload; }
function loginProviderFor(key) { return loginProviders.find((item) => item.key === key); }
function isAuthenticatedAccount(account) { return account?.status === 'connected' && account.authVerified === true; }
function isUploadPageReady(providerKey) { return state.uploadPageStates[providerKey] === 'ready'; }
function renderProviderReadiness() { renderAccounts(); renderSidebarStatus(); renderQuickPublish(); }
function connectedAccountsFor(providerKey) { const account = state.accounts.find((item) => item.provider === providerKey && isAuthenticatedAccount(item)); return account ? [account] : []; }
function hasLoginPrerequisite(providerKey) { const provider = loginProviderFor(providerKey); return !provider?.requiresProvider || state.accounts.some((account) => account.provider === provider.requiresProvider && isAuthenticatedAccount(account)); }
function requireLoginPrerequisite(providerKey) { const provider = loginProviderFor(providerKey); if (!provider?.requiresProvider || hasLoginPrerequisite(providerKey)) return true; const prerequisite = providerFor(provider.requiresProvider); showToast(`${provider.label}은(는) ${prerequisite.label} 로그인 후 진행할 수 있습니다.`, true); document.querySelector(`#login-${provider.requiresProvider}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; }
function isUploadPreparationReady(providerKey) {
  // TikTok's login handoff is initiated from Facebook. Once Facebook is
  // verified, show the TikTok preparation step as ready; the TikTok login
  // chip remains separate until TikTok itself is authenticated.
  if (providerKey === 'tiktok') return hasLoginPrerequisite('tiktok') && Boolean(videoForSlot(state.selectedSlot));
  return false;
}

function selectedRoutes() { return state.accounts.filter((account) => isAuthenticatedAccount(account) && state.quickProviders.has(account.provider)).flatMap((account) => { const uploaded = uploadedSlotsForAccount(account.id); return (account.slotNumbers || []).filter((slot) => videoForSlot(slot) && !uploaded.has(Number(slot))).map((slotNumber) => ({ accountId: account.id, slotNumber })); }); }
function syncQuickProviders() { state.quickProviders = new Set(state.accounts.filter((account) => isAuthenticatedAccount(account) && videoForSlot(state.selectedSlot) && (account.slotNumbers || []).includes(state.selectedSlot)).map((account) => account.provider)); }

function renderQuickPublish() {
  const target = $('#quickProviderBar');
  if (!target) return;
  const selectedVideo = videoForSlot(state.selectedSlot);
  target.innerHTML = loginProviders.map((item) => {
    const linked = connectedAccountsFor(item.key);
    const pending = state.accounts.filter((account) => account.provider === item.key && !(account.status === 'connected' && account.authVerified === true));
    const loginState = state.loginStates[item.key] || 'idle';
    const active = linked.some((account) => (account.slotNumbers || []).includes(state.selectedSlot));
    const label = linked.length ? `${linked.length}개 계정 연결됨` : '로그인 필요';
    return `<button class="quick-provider${active ? ' is-active' : ''}${linked.length ? '' : ' needs-login'}" data-quick-provider="${item.key}" type="button" aria-pressed="${active}"><span class="quick-provider-brand quick-brand-${item.accent}">${item.code}</span><span class="quick-provider-copy"><strong>${item.label}</strong><small>${selectedVideo ? label : '먼저 영상 선택'}</small></span><span class="quick-provider-state">${active ? 'ACTIVE' : linked.length ? 'OFF' : 'LOGIN'}</span><span class="quick-provider-check">${active ? '✓' : '+'}</span></button>`;
  }).join('');
  $('#quickPublishSummary').textContent = `활성 SNS ${state.quickProviders.size}개`;
}

async function activateQuickProvider(providerKey) {
  if (!requireLoginPrerequisite(providerKey)) return;
  const provider = providerFor(providerKey);
  const video = videoForSlot(state.selectedSlot);
  const accounts = state.accounts.filter((item) => item.provider === providerKey && isAuthenticatedAccount(item));
  if (!video) return showToast('먼저 업로드할 슬롯 영상을 선택해 주세요.', true);
  if (!accounts.length) { state.pendingQuickProvider = providerKey; return openAccountModal(providerKey); }
  const previousSlots = new Map(accounts.map((account) => [account.id, [...(account.slotNumbers || [])]]));
  const slotAlreadyRouted = accounts.every((account) => (previousSlots.get(account.id) || []).includes(state.selectedSlot));
  const shouldAddSlot = !slotAlreadyRouted;
  accounts.forEach((account) => {
    const slots = previousSlots.get(account.id) || [];
    account.slotNumbers = shouldAddSlot ? [...new Set([...slots, state.selectedSlot])].sort((a, b) => a - b) : slots.filter((slot) => slot !== state.selectedSlot);
  });
  renderAll();
  try {
    await Promise.all(accounts.map(async (account) => {
      const result = await api(`/api/accounts/${encodeURIComponent(account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: account.slotNumbers }) });
      Object.assign(account, result.account);
    }));
    showToast(`${provider.label} ${shouldAddSlot ? '활성화' : '비활성화'} · ${state.selectedSlot}번 영상`);
  } catch (error) {
    accounts.forEach((account) => { account.slotNumbers = previousSlots.get(account.id) || []; });
    renderAll();
    showToast(error.message, true);
  }
}

async function uploadAccountVideos(accountId, clipOverride = null, actionLabel = '업로드', options = {}) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return { ok: false, error: '계정을 찾을 수 없습니다.' };
  const uploadedSlots = uploadedSlotsForAccount(account.id);
  const routedVideos = (account.slotNumbers || []).map((slotNumber) => ({ slotNumber, video: videoForSlot(slotNumber) })).filter(({ slotNumber, video }) => video && !uploadedSlots.has(Number(slotNumber)));
  if (!isAuthenticatedAccount(account)) { const error = '먼저 공식 로그인에 성공해 주세요.'; showToast(error, true); return { ok: false, error }; }
  if (!routedVideos.length) { const error = '이 계정에 업로드할 영상을 먼저 선택해 주세요.'; showToast(error, true); return { ok: false, error }; }
  const provider = providerFor(account.provider);
  const firstVideo = routedVideos[0].video;
  let metadata = firstVideo.aiMetadata || {};
  const routes = routedVideos.map(({ slotNumber }) => ({ accountId: account.id, slotNumber }));
  try {
    setAccountUploadPhase(account.id, 'uploading');
    if (account.provider === 'naver') setNaverUploadStatus('uploading', `${routedVideos.map(({ slotNumber }) => `${slotNumber}번`).join(', ')} 영상을 네이버 클립에 전송하고 있습니다.`);
    if (account.provider === 'naver' && !metadata.naverClip) {
      const generated = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: firstVideo.id, provider: 'naver' }) });
      Object.assign(firstVideo, generated.video); metadata = generated.metadata;
    }
    if (account.provider === 'instagram' && !metadata.instagram) {
      const generated = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: firstVideo.id, provider: 'instagram' }) });
      Object.assign(firstVideo, generated.video); metadata = generated.metadata;
    }
    const naverClip = account.provider === 'naver' ? { ...(metadata.naverClip || {}), ...(clipOverride || {}) } : null;
    const instagram = account.provider === 'instagram' ? { ...(metadata.instagram || {}), ...(clipOverride || {}) } : null;
    const facebook = account.provider === 'facebook' ? { ...(metadata.facebook || {}), ...(clipOverride || {}) } : null;
    const postCopy = instagram?.caption || facebook?.caption || naverClip?.description || metadata.description || `${provider.label}에 바로 업로드합니다.`;
    const postTags = instagram?.hashtags || facebook?.hashtags || naverClip?.hashtags || metadata.hashtags || ['#동영상', '#콘텐츠'];
    const created = await api('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: metadata.title || `${provider.label} ${routedVideos[0].slotNumber}번 동영상`, description: postCopy, hashtags: postTags, naverClip, instagram, facebook, directUpload: options.directUpload === true, scheduledAt: new Date().toISOString(), privacy: options.privacy || 'public', routes }) });
    state.campaigns.unshift(created.campaign);
    renderAll();
    const result = await api(`/api/campaigns/${encodeURIComponent(created.campaign.id)}/run`, { method: 'POST' });
    const index = state.campaigns.findIndex((campaign) => campaign.id === result.campaign.id);
    if (index >= 0) state.campaigns[index] = result.campaign;
    await loadInsights();
    renderAll();
    const incompleteJobs = (result.campaign.jobs || []).filter((job) => job.status !== 'published');
    if (incompleteJobs.length) {
      const reason = incompleteJobs.map((job) => job.lastError).filter(Boolean)[0] || 'SNS 게시 완료 상태를 확인하지 못했습니다.';
      setAccountUploadPhase(account.id, 'failed');
      if (account.provider === 'naver') setNaverUploadStatus('failed', `최종 등록을 확인하지 못했습니다. ${reason}`);
      showToast(`${provider.label} 실제 업로드 실패: ${reason}`, true);
      return { ok: false, campaign: result.campaign, error: reason };
    }
    showToast(`${provider.label} ${routedVideos.length}개 동영상 ${actionLabel}를 완료했습니다.`);
    setAccountUploadPhase(account.id, 'waiting');
    if (account.provider === 'naver') setNaverUploadStatus('published', `${routedVideos.length}개 영상이 콘텐츠 목록에서 최종 등록 확인되었습니다.`);
    return { ok: true, campaign: result.campaign };
  } catch (error) {
    setAccountUploadPhase(account.id, 'failed');
    if (account.provider === 'naver') setNaverUploadStatus('failed', error.message);
    showToast(error.message, true);
    return { ok: false, error: error.message };
  }
}

async function uploadAccountNow(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return;
  if (state.directUploads.has(accountId)) return;
  if (!isAuthenticatedAccount(account)) return showToast('녹색 연결 상태가 된 계정만 바로 업로드할 수 있습니다.', true);
  // The hidden browser page is only a readiness hint. The shared provider
  // adapters perform the real upload with the verified Electron session, so
  // a provider UI change must not block the direct-upload engine.
  if (!isUploadPageReady(account.provider)) prepareUploadProvider(account.provider).catch(() => {});
  const routedVideos = (account.slotNumbers || []).map((slotNumber) => ({ slotNumber, video: videoForSlot(slotNumber) })).filter(({ video }) => video);
  if (!routedVideos.length) return showToast('먼저 이 계정 카드에서 업로드할 번호를 선택해 주세요.', true);

  state.directUploads.add(accountId);
  renderAll();
  try {
    await uploadAccountVideos(accountId, null, '실제 업로드', { directUpload: true });
  } finally {
    state.directUploads.delete(accountId);
    renderAll();
  }
}

function renderSidebarStatus() {
  const target = document.querySelector('.status-inline-row');
  if (!target) return;
  target.innerHTML = loginProviders.map((item) => {
    const linkedAccounts = connectedAccountsFor(item.key);
    const loggedIn = linkedAccounts.length > 0;
    const uploadReady = item.key === 'tiktok'
      ? isUploadPreparationReady(item.key)
      : loggedIn && isUploadPageReady(item.key) && Boolean(videoForSlot(state.selectedSlot)) && linkedAccounts.some((account) => (account.slotNumbers || []).includes(state.selectedSlot));
    const chip = (label, ready) => `<span class="status-state-chip${ready ? ' is-ready' : ' is-waiting'}"><i class="status-check-light${ready ? ' is-ready' : ' is-waiting'}"></i>${label}<b>${ready ? 'GREEN' : 'RED'}</b></span>`;
    return `<a class="status-inline-item status-all-item status-sns-single-row" href="#login-${item.key}" aria-label="${item.label} 로그인 및 업로드 준비 상태"><span class="status-light${loggedIn ? ' is-ready' : ' is-waiting'}"></span><span class="status-sns-name"><strong>${item.label}</strong></span>${chip('로그인', loggedIn)}${chip('업로드 준비', uploadReady)}</a>`;
  }).join('');
}

function renderQuickPublish() {
  const target = $('#quickProviderBar');
  if (!target) return;
  target.innerHTML = loginProviders.map((item) => {
    const linked = connectedAccountsFor(item.key);
    const loggedIn = linked.length > 0;
    const active = linked.some((account) => (account.slotNumbers || []).includes(state.selectedSlot));
    const slots = Array.from({ length: 10 }, (_, index) => {
      const slot = index + 1;
      const ready = Boolean(videoForSlot(slot));
      const selected = linked.some((account) => (account.slotNumbers || []).includes(slot));
      const enabled = loggedIn && ready;
      return `<button class="quick-slot-button${selected ? ' is-selected' : ''}${enabled ? '' : ' is-disabled'}" data-quick-slot-provider="${item.key}" data-slot-number="${slot}" type="button" aria-pressed="${selected}" ${enabled ? '' : 'disabled'} title="${enabled ? `${slot}번 영상을 ${item.label}에 ${selected ? '연결 해제' : '연결'}` : `${slot}번 영상 업로드 완료 후 선택 가능`}">${slot}${selected ? ' ✓' : ''}</button>`;
    }).join('');
    return `<article class="quick-provider-card provider-${item.key}"><button class="quick-provider${active ? ' is-active' : ''}${loggedIn ? '' : ' needs-login'}" data-quick-provider="${item.key}" type="button" aria-pressed="${active}"><span class="quick-provider-brand quick-brand-${item.accent}">${item.code}</span><span class="quick-provider-copy"><strong>${item.label}</strong><small>${loggedIn ? `${linked.length}개 계정 · 1~10번 선택` : '로그인 후 1~10번 활성화'}</small></span><span class="quick-provider-state"><i class="quick-login-light${loggedIn ? ' is-ready' : ' is-waiting'}"></i>${loggedIn ? '로그인 완료' : 'LOGIN'}</span><span class="quick-provider-check">${active ? '✓' : '+'}</span></button><div class="quick-slot-grid" aria-label="${item.label} 동영상 슬롯 선택">${slots}</div></article>`;
  }).join('');
  $('#quickPublishSummary').textContent = `활성 SNS ${state.quickProviders.size}개`;
}

async function toggleQuickProviderSlot(providerKey, slotNumber) {
  if (!requireLoginPrerequisite(providerKey)) return;
  const slot = Number(slotNumber);
  const provider = providerFor(providerKey);
  const video = videoForSlot(slot);
  const accounts = state.accounts.filter((account) => account.provider === providerKey && isAuthenticatedAccount(account));
  if (!video) return showToast(`${slot}번 영상이 아직 업로드되지 않았습니다.`, true);
  if (!accounts.length) { state.selectedSlot = slot; state.pendingQuickProvider = providerKey; return openAccountModal(providerKey); }
  const previousSlots = new Map(accounts.map((account) => [account.id, [...(account.slotNumbers || [])]]));
  const selected = accounts.every((account) => (previousSlots.get(account.id) || []).includes(slot));
  accounts.forEach((account) => {
    const slots = previousSlots.get(account.id) || [];
    account.slotNumbers = selected ? slots.filter((item) => item !== slot) : [...new Set([...slots, slot])].sort((a, b) => a - b);
  });
  state.selectedSlot = slot;
  renderAll();
  try {
    await Promise.all(accounts.map(async (account) => {
      const result = await api(`/api/accounts/${encodeURIComponent(account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: account.slotNumbers }) });
      Object.assign(account, result.account);
    }));
    showToast(`${provider.label} ${slot}번 영상 ${selected ? '연결 해제' : '업로드 준비'} 완료`);
  } catch (error) {
    accounts.forEach((account) => { account.slotNumbers = previousSlots.get(account.id) || []; });
    renderAll();
    showToast(error.message, true);
  }
}

function renderStats() {
  const filled = state.videos.length;
  const views = state.analytics.totals?.views || 0;
  $('#statVideoCount').textContent = filled; $('#statAccountCount').textContent = state.accounts.length; $('#statCampaignCount').textContent = state.campaigns.length; $('#statViewCount').textContent = formatNumber(views);
  $('#navVideoCount').textContent = `${filled}/10`; $('#navAccountCount').textContent = state.accounts.length; $('#navCampaignCount').textContent = state.campaigns.length;
  $('#slotCount').textContent = filled;
}

function renderSlots() {
  $('#slotGrid').innerHTML = Array.from({ length: 10 }, (_, index) => {
    const slot = index + 1; const video = videoForSlot(slot); const selected = state.selectedSlot === slot;
    if (!video) return `<article class="slot-card is-empty${selected ? ' is-selected' : ''}" data-slot-card="${slot}"><div class="slot-top"><span class="slot-number">${String(slot).padStart(2, '0')}</span><span class="slot-status">EMPTY</span></div><div class="empty-slot"><b>슬롯 ${slot}</b><span>원본을 고정하세요</span><button class="button button-soft" data-upload-slot="${slot}" type="button">영상 추가</button></div></article>`;
    const meta = video.aiMetadata || {};
    return `<article class="slot-card is-filled${selected ? ' is-selected' : ''}" data-slot-card="${slot}"><div class="slot-top"><span class="slot-number">${String(slot).padStart(2, '0')}</span><span class="slot-status ready">READY</span></div><button class="slot-preview" data-select-slot="${slot}" type="button"><img src="${escapeHtml(video.thumbnailUrl)}" alt="${escapeHtml(video.originalName)} 썸네일"><span class="play-mark">▶</span></button><div class="slot-info"><strong title="${escapeHtml(video.originalName)}">${escapeHtml(video.originalName)}</strong><small>${escapeHtml(meta.title || 'AI 제목 미생성')}</small><span>${escapeHtml(video.sizeLabel || '')} · ${formatDate(video.createdAt, { month: 'short', day: 'numeric' })}</span></div><div class="slot-actions"><button class="button button-ghost" data-upload-slot="${slot}" type="button">교체</button><button class="icon-danger" data-delete-video="${escapeHtml(video.id)}" type="button" aria-label="${slot}번 영상 삭제">삭제</button></div></article>`;
  }).join('');
  const usedBytes = state.videos.reduce((sum, video) => sum + Number(video.size || 0), 0); const percent = Math.min((usedBytes / (10 * 1024 ** 3)) * 100, 100);
  $('#storagePercent').textContent = `${Math.round(percent)}%`; $('#storageBar').style.width = `${percent}%`; $('#storageLabel').textContent = `${formatBytes(usedBytes)} / 10 GB 사용 중`;
  const source = videoForSlot(state.selectedSlot); $('#selectedSourceSlot').textContent = String(state.selectedSlot).padStart(2, '0'); $('#selectedSourceName').textContent = source?.originalName || '슬롯을 선택하세요'; $('#selectedSourceMeta').textContent = source ? `${source.sizeLabel || ''} · ${source.mimeType?.replace('video/', '').toUpperCase() || 'VIDEO'}` : '영상 소스 없음';
}

function formatBytes(bytes) { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`; }

function renderAccounts() {
  if (!state.accounts.length) { $('#accountGrid').innerHTML = `<div class="empty-inline account-empty">연결된 계정이 없습니다. <button class="text-button" data-open-account="true">첫 계정 연결</button></div>`; renderRouteSummary(); return; }
  const accountCards = state.accounts.map((account) => {
    const provider = providerFor(account.provider); const uploadedSlots = uploadedSlotsForAccount(account.id); const checkedCount = (account.slotNumbers || []).filter((slot) => videoForSlot(slot) && !uploadedSlots.has(Number(slot))).length;
    const routedVideos = (account.slotNumbers || []).map((slot) => ({ slot, video: videoForSlot(slot) })).filter(({ video }) => video).sort((a, b) => a.slot - b.slot);
    const videoPreviews = routedVideos.length ? `<div class="account-video-preview-list" aria-label="${provider.label} 연결 영상 미리보기">${routedVideos.map(({ slot, video }) => `<button class="account-video-preview" data-select-slot="${slot}" type="button" title="${slot}번 영상 ${escapeHtml(video.originalName)}"><img src="${escapeHtml(video.thumbnailUrl)}" alt="${slot}번 ${escapeHtml(video.originalName)} 썸네일"><span>${String(slot).padStart(2, '0')}</span></button>`).join('')}</div>` : '<div class="account-video-empty">선택된 영상 없음</div>';
    const switches = Array.from({ length: 10 }, (_, index) => { const slot = index + 1; const hasVideo = Boolean(videoForSlot(slot)); const uploaded = uploadedSlots.has(slot); const checked = (account.slotNumbers || []).includes(slot); const disabled = !hasVideo || uploaded; const title = uploaded ? `${slot}번 영상은 이미 업로드되어 비활성화되었습니다` : hasVideo ? `${slot}번 영상을 ${provider.label}에 연결` : `${slot}번 슬롯이 비어 있습니다`; return `<label class="slot-switch${hasVideo ? '' : ' is-disabled'}${uploaded ? ' is-disabled is-uploaded' : ''}" title="${title}"><input type="checkbox" data-account-slot="${escapeHtml(account.id)}" data-slot-number="${slot}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${slot}</span></label>`; }).join('');
    const verified = account.status === 'connected' && account.authVerified === true;
    const uploadPageState = state.uploadPageStates[account.provider] || 'idle';
    const uploadReady = verified && uploadPageState === 'ready';
    const uploadChecking = uploadPageState === 'checking';
    const uploading = state.directUploads.has(account.id);
    const uploadPhase = accountUploadPhase(account);
    const waiting = verified && uploadReady && routedVideos.length > 0 && uploadPhase === 'waiting';
    const uploadInProgress = uploading || uploadPhase === 'uploading';
    const uploadCompleted = uploadPhase === 'completed';
    const uploadFailed = uploadPhase === 'failed';
    const canUpload = verified && routedVideos.length > 0 && !uploadInProgress && !uploadChecking && !uploadCompleted;
    const uploadTitle = !verified ? '공식 로그인 확인이 필요합니다' : uploadCompleted ? '선택한 영상의 업로드가 완료되었습니다' : routedVideos.length ? (uploadReady ? `${routedVideos.length}개 선택 영상을 즉시 업로드` : '업로드 페이지를 자동으로 준비한 뒤 선택 영상을 업로드') : '계정에 업로드할 영상을 먼저 선택해 주세요';
    const accountActionLabel = uploading ? '업로드 중…' : uploadCompleted ? '업로드 완료' : '바로 업로드';
    const accountStatus = !verified ? (account.status === 'login_failed' ? 'LOGIN FAILED' : 'LOGIN REQUIRED') : uploadInProgress ? 'UPLOAD IN PROGRESS' : uploadCompleted ? 'UPLOAD COMPLETE' : uploadFailed ? 'UPLOAD FAILED' : uploadReady ? 'UPLOAD WAITING' : 'UPLOAD PAGE WAIT';
    const stageChip = (label, active, extra = '') => `<span class="account-state-chip account-phase-chip${active ? ' is-ready' : ' is-waiting'}${extra}" aria-label="${label} ${active ? '활성' : '비활성'}"><i></i>${label}</span>`;
    const waitChip = `<button class="account-state-chip account-phase-chip${waiting ? ' is-ready' : uploadChecking ? ' is-checking' : ' is-waiting'}" data-prepare-upload-provider="${escapeHtml(account.provider)}" type="button" ${verified && !uploadChecking ? '' : 'disabled'} title="업로드 페이지 준비 상태를 다시 확인합니다"><i></i>업로드 대기</button>`;
    const statusRail = `<span class="account-state-cluster" aria-label="현재 업로드 단계"><span class="account-state-chip${verified ? ' is-ready' : ' is-waiting'}" aria-label="로그인 ${verified ? '완료' : '필요'}"><i></i>로그인</span>${waitChip}${stageChip('업로드 중', uploadInProgress, uploadInProgress ? ' is-uploading' : '')}${stageChip('업로드 완료', uploadCompleted)}</span>`;
    return `<article class="account-card provider-${account.provider}${verified ? '' : ' is-auth-pending'}"><div class="account-head"><span class="provider-code">${provider.code}</span><div class="account-identity"><strong>${escapeHtml(account.displayName)}</strong><div class="account-handle-row"><small>${provider.label} · ${escapeHtml(account.handle)}</small><button class="account-connect-button" data-connect-account-provider="${escapeHtml(account.provider)}" type="button" title="${provider.label} 연결">연결</button></div></div><span class="account-head-status"><button class="account-upload-button" data-upload-account="${escapeHtml(account.id)}" type="button" ${canUpload ? '' : 'disabled'} title="${uploadInProgress ? '업로드 진행 중입니다' : uploadTitle}">${uploadInProgress ? '업로드 중…' : accountActionLabel}</button></span></div><div class="account-stage-row">${statusRail}</div><div class="account-route-label"><span>게시할 번호</span><b>${checkedCount}개</b><em class="account-status-label${verified && !uploadFailed ? ' is-connected' : ''}">${accountStatus}</em></div>${videoPreviews}<div class="slot-switches">${switches}</div><div class="account-footer"><span>${verified ? (uploadCompleted ? 'SELECTED VIDEOS PUBLISHED' : uploadReady ? 'UPLOAD PAGE READY' : 'UPLOAD PAGE PREPARATION REQUIRED') : 'LOGIN VERIFICATION REQUIRED'}</span><button class="text-button" data-remove-account="${escapeHtml(account.id)}" type="button">해제</button></div></article>`;
  }).join('');
  const missingCards = loginProviders.filter((item) => !state.accounts.some((account) => account.provider === item.key)).map((item) => `<article class="account-card account-placeholder provider-${item.key}"><div class="account-head"><span class="provider-code">${item.code}</span><div class="account-identity"><strong>${item.label}</strong><div class="account-handle-row"><small>${item.label} 계정이 연결되지 않았습니다.</small></div></div><span class="account-head-status"><span class="account-state-chip"><i></i>로그인 필요</span></span></div><div class="account-placeholder-copy">로그인 후 이 화면에서 계정과 영상 슬롯을 설정할 수 있습니다.</div><button class="button button-outline account-placeholder-button" data-connect-missing-provider="${item.key}" type="button">${item.label} 로그인</button></article>`).join('');
  $('#accountGrid').innerHTML = accountCards + missingCards;
  document.querySelectorAll('#accountGrid .account-footer').forEach((footer) => {
    const removeButton = footer.querySelector('[data-remove-account]');
    if (!removeButton || footer.querySelector('[data-reset-account]')) return;
    footer.classList.add('account-reset-footer');
    footer.insertAdjacentHTML('afterbegin', `<button class="button button-outline account-reset-button" data-reset-account="${escapeHtml(removeButton.dataset.removeAccount)}" type="button">영상 리셋</button>`);
  });
  const tiktokPlaceholder = document.querySelector('#accountGrid .account-placeholder.provider-tiktok');
  if (tiktokPlaceholder && isUploadPreparationReady('tiktok')) {
    const stateChip = tiktokPlaceholder.querySelector('.account-head-status .account-state-chip');
    if (stateChip) { stateChip.classList.add('is-ready'); stateChip.innerHTML = '<i></i>업로드 준비 완료'; }
    const copy = tiktokPlaceholder.querySelector('.account-placeholder-copy');
    if (copy) copy.textContent = 'Facebook 로그인 완료 · TikTok 로그인 후 영상 슬롯을 설정할 수 있습니다.';
  }
  renderRouteSummary();
}

function renderLoginPages() {
  const target = $('#loginPageGrid');
  if (!target) return;
  target.innerHTML = loginProviders.map((item, index) => {
    const linked = connectedAccountsFor(item.key);
    const loginState = state.loginStates[item.key] || (linked.length ? 'connected' : 'idle');
    const prerequisite = item.requiresProvider ? providerFor(item.requiresProvider) : null;
    const prerequisiteReady = hasLoginPrerequisite(item.key);
    const prerequisiteNotice = prerequisite ? `<div class="login-prerequisite${prerequisiteReady ? ' is-ready' : ' is-blocked'}"><span class="login-prerequisite-light"></span><span>${prerequisite.label} 로그인 ${prerequisiteReady ? '완료' : '필요'}</span>${prerequisiteReady ? '' : `<a href="#login-${item.requiresProvider}" data-scroll-target="#login-${item.requiresProvider}">${prerequisite.label} 로그인으로 이동</a>`}</div>` : '';
    const accounts = linked.length ? linked.map((account) => `<div class="login-account"><span class="login-account-dot"></span><div><strong>${escapeHtml(account.displayName)}</strong><small>${escapeHtml(account.handle)}</small></div><span class="login-account-state">CONNECTED</span></div>`).join('') : '<div class="login-empty">공식 로그인 확인이 필요합니다.</div>';
    const forceLogoutButton = `<button class="button force-logout-button" data-force-logout-provider="${item.key}" type="button">강제 로그아웃</button>`;
    const uploadPageButton = linked.length ? `<button class="button upload-page-button" data-open-upload-provider="${item.key}" type="button">동영상 업로드 페이지 열기 ↗</button>` : '';
    const authMessage = loginState === 'failed' ? '<div class="login-auth-error"><span class="status-light is-waiting"></span><strong>로그인 실패</strong><small>아이디·비밀번호 또는 공식 로그인 상태를 확인해 주세요.</small></div>' : loginState === 'pending' ? '<div class="login-auth-pending"><span class="status-light is-waiting"></span><strong>로그인 확인 중</strong><small>공식 로그인 창에서 인증을 완료해 주세요.</small></div>' : '';
    const externalLogin = item.loginUrl ? `<a class="button login-external-button${loginState === 'connected' ? ' is-verified' : ''}" data-external-login-provider="${item.key}" href="${escapeHtml(item.loginUrl)}" target="_blank" rel="noreferrer">${loginState === 'connected' ? '로그인됨 · 다시 할 필요 없음' : '공식 로그인 창 열기 ↗'}</a>` : '';
    return `<article class="login-page login-${item.key}" id="login-${item.key}"><div class="login-page-head"><span class="login-brand login-brand-${item.accent}">${item.code}</span><div><span class="eyebrow">${item.service}</span><h3>${item.label} 로그인</h3></div><span class="login-page-index">${String(index + 1).padStart(2, '0')}</span></div><div class="login-copy"><strong>${item.title}</strong><p>${item.description}</p><span class="login-scopes">${item.scopes}</span></div>${prerequisiteNotice}${authMessage}<div class="login-connected"><div class="login-connected-label"><span>연결 상태</span><b>${linked.length ? `${linked.length}개 연결됨` : '연결 대기'}</b></div>${accounts}${forceLogoutButton}</div><div class="login-actions">${uploadPageButton}<button class="button login-button login-button-${item.accent}${prerequisite && !prerequisiteReady ? ' is-blocked' : ''}" data-login-provider="${item.key}" type="button">${prerequisite && !prerequisiteReady ? `${prerequisite.label} 로그인 필요` : linked.length ? '다른 계정 연결' : `${item.label} 로그인 확인`} <span>→</span></button>${externalLogin}</div><div class="login-page-footer"><span>OAuth callback seam</span><span>${linked.length ? 'OAUTH CONNECTED' : prerequisite && !prerequisiteReady ? 'FACEBOOK AUTH REQUIRED' : loginState === 'failed' ? 'LOGIN FAILED' : 'LOGIN VERIFICATION REQUIRED'}</span></div></article>`;
  }).join('');
}

function renderRouteSummary() {
  const routes = selectedRoutes(); $('#routeSummary').textContent = `${routes.length}개 경로 · 활성 SNS ${state.quickProviders.size}개`;
  $('#routeChips').innerHTML = routes.length ? routes.map((route) => { const account = state.accounts.find((item) => item.id === route.accountId); const provider = providerFor(account?.provider); return `<span class="route-chip"><b>${String(route.slotNumber).padStart(2, '0')}</b>${provider.code} ${escapeHtml(account?.handle || '')}</span>`; }).join('') : '<span class="muted">계정별 번호 체크가 아직 없습니다.</span>';
  const grouped = state.accounts.flatMap((account) => (account.slotNumbers || []).filter((slot) => videoForSlot(slot)).map((slot) => ({ account, slot })));
  $('#selectedRouteList').innerHTML = grouped.length ? grouped.map(({ account, slot }) => `<div class="selected-route"><span>${String(slot).padStart(2, '0')}</span><strong>${providerFor(account.provider).code}</strong><small>${escapeHtml(account.handle)}</small></div>`).join('') : '<span class="muted">계정에서 번호를 체크하면 경로가 보입니다.</span>';
}

function statusLabel(status) { return ({ scheduled: '예약 대기', running: '처리 중', completed: '전체 성공', failed: '실패 있음', cancelled: '취소됨', queued: '대기', uploading: '전송 중', retrying: '재시도 대기', published: '게시 완료', failed: '실패' })[status] || status; }
function renderCampaigns() {
  $('#campaignEmpty').hidden = state.campaigns.length > 0;
  $('#campaignList').innerHTML = state.campaigns.map((campaign) => { const jobs = campaign.jobs || []; const done = jobs.filter((job) => job.status === 'published').length; const progress = jobs.length ? Math.round((done / jobs.length) * 100) : 0; const jobRows = jobs.map((job) => `<div class="job-row"><span class="job-slot">${String(job.slotNumber).padStart(2, '0')}</span><span class="provider-code mini">${providerFor(job.provider).code}</span><span class="job-handle">${escapeHtml(job.handle)}</span><span class="job-progress"><i style="width:${job.progress || 0}%"></i></span><span class="job-status status-${job.status}">${statusLabel(job.status)}${job.attempt ? ` · ${job.attempt}/${job.maxAttempts}` : ''}</span>${job.status === 'failed' ? `<button class="text-button" data-retry-job="${escapeHtml(job.id)}">재시도</button>` : ''}</div>`).join(''); return `<article class="campaign-card"><div class="campaign-head"><div><span class="eyebrow">${escapeHtml(campaign.id.slice(-8).toUpperCase())} · ${formatDate(campaign.scheduledAt)}</span><h3>${escapeHtml(campaign.title)}</h3><p>${escapeHtml(campaign.description || '설명 없음')}</p></div><div class="campaign-actions"><span class="status-pill status-${campaign.status}">${statusLabel(campaign.status)}</span><button class="button button-ghost" data-run-campaign="${escapeHtml(campaign.id)}">지금 실행</button><button class="icon-danger" data-cancel-campaign="${escapeHtml(campaign.id)}">취소</button></div></div><div class="campaign-progress"><span>완료 ${done}/${jobs.length}</span><div><i style="width:${progress}%"></i></div><b>${progress}%</b></div><div class="job-list">${jobRows}</div></article>`; }).join('');
}

function renderCalendar() {
  const month = state.calendarMonth; const year = month.getFullYear(); const monthIndex = month.getMonth(); $('#calendarMonth').textContent = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' }).format(month);
  const firstDay = new Date(year, monthIndex, 1); const mondayOffset = (firstDay.getDay() + 6) % 7; const cells = [];
  for (let index = 0; index < 42; index += 1) { const date = new Date(year, monthIndex, index - mondayOffset + 1); const dayCampaigns = state.campaigns.filter((campaign) => { const scheduled = new Date(campaign.scheduledAt); return scheduled.getFullYear() === date.getFullYear() && scheduled.getMonth() === date.getMonth() && scheduled.getDate() === date.getDate(); }); const outside = date.getMonth() !== monthIndex; cells.push(`<div class="calendar-cell${outside ? ' is-outside' : ''}${date.toDateString() === new Date().toDateString() ? ' is-today' : ''}"><span>${date.getDate()}</span>${dayCampaigns.slice(0, 3).map((campaign) => `<button class="calendar-event status-${campaign.status}" data-run-campaign="${escapeHtml(campaign.id)}"><i></i>${escapeHtml(campaign.title).slice(0, 18)}</button>`).join('')}${dayCampaigns.length > 3 ? `<small>+ ${dayCampaigns.length - 3}개</small>` : ''}</div>`); }
  $('#calendarGrid').innerHTML = cells.join('');
}

function renderAnalytics() {
  const totals = state.analytics.totals || {}; $('#analyticsViews').textContent = formatNumber(totals.views); $('#analyticsLikes').textContent = formatNumber(totals.likes); $('#analyticsComments').textContent = formatNumber(totals.comments);
  const published = (state.analytics.jobs || []).filter((job) => job.status === 'published'); $('#analyticsList').innerHTML = published.length ? published.slice(0, 8).map((job) => `<div class="insight-row"><span class="provider-code mini">${providerFor(job.provider).code}</span><div><strong>${escapeHtml(job.handle)}</strong><small>${escapeHtml(job.campaignTitle || '')}</small></div><b>${formatNumber(job.analytics?.views)} <small>views</small></b><b>${formatNumber(job.analytics?.likes)} <small>likes</small></b></div>`).join('') : '<div class="empty-inline">아직 게시된 sandbox 작업이 없습니다.</div>';
}

function renderComments() {
  $('#commentsEmpty').hidden = state.comments.length > 0; $('#commentsList').innerHTML = state.comments.map((comment) => `<article class="comment-card${comment.status === 'hidden' ? ' is-hidden' : ''}"><div class="comment-top"><span class="provider-code mini">${providerFor(comment.provider).code}</span><strong>${escapeHtml(comment.authorName)}</strong><small>${escapeHtml(comment.handle)} · ${formatDate(comment.createdAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small><span class="comment-status">${comment.status === 'hidden' ? '숨김' : '공개'}</span></div><p>${escapeHtml(comment.text)}</p>${(comment.replies || []).map((reply) => `<div class="reply"><b>↳ ${escapeHtml(reply.authorName || '관리자')}</b> ${escapeHtml(reply.text)}</div>`).join('')}<div class="comment-actions"><button class="text-button" data-reply-comment="${escapeHtml(comment.id)}">답글</button><button class="text-button" data-toggle-comment="${escapeHtml(comment.id)}" data-comment-action="${comment.status === 'hidden' ? 'unhide' : 'hide'}">${comment.status === 'hidden' ? '숨김 해제' : '숨김'}</button></div></article>`).join('');
}

function renderLogs() { $('#logsList').innerHTML = state.logs.length ? state.logs.slice(0, 40).map((log) => `<div class="log-row"><time>${formatDate(log.createdAt, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><b>${escapeHtml(log.event)}</b><span>${escapeHtml(log.message)}</span></div>`).join('') : '<div class="empty-inline">아직 기록된 작업이 없습니다.</div>'; }
function renderSettings() { for (const key of ['launchAtStartup', 'startMinimized', 'autoUpdate']) $(`#${key}`).checked = Boolean(state.settings[key]); }
function naverClipRoutedVideos() { const slots = [...new Set(state.accounts.filter((account) => account.provider === 'naver' && isAuthenticatedAccount(account)).flatMap((account) => account.slotNumbers || []))].sort((a, b) => a - b); return slots.map((slot) => videoForSlot(slot)).filter(Boolean); }
function hasNaverClipRoute() { return naverClipRoutedVideos().length > 0; }
function instagramRoutedVideos() { const slots = [...new Set(state.accounts.filter((account) => account.provider === 'instagram' && isAuthenticatedAccount(account)).flatMap((account) => account.slotNumbers || []))].sort((a, b) => a - b); return slots.map((slot) => videoForSlot(slot)).filter(Boolean); }
function hasInstagramRoute() { return instagramRoutedVideos().length > 0; }
function facebookRoutedVideos() { const slots = [...new Set(state.accounts.filter((account) => account.provider === 'facebook' && isAuthenticatedAccount(account)).flatMap((account) => account.slotNumbers || []))].sort((a, b) => a - b); return slots.map((slot) => videoForSlot(slot)).filter(Boolean); }
function hasFacebookRoute() { return facebookRoutedVideos().length > 0; }
function applyNaverClipMetadata(clip, force = false) {
  if (!clip) return;
  const description = $('#naverClipDescription'); const primary = $('#naverClipCategoryPrimary'); const secondary = $('#naverClipCategorySecondary'); const productSelect = $('#naverProductSelect'); const productName = $('#naverProductName'); const productUrl = $('#naverProductUrl');
  if (description && (force || !description.value.trim())) description.value = clip.description || '';
  if (primary && (force || !primary.value)) primary.value = clip.primaryCategory || '';
  if (secondary && (force || !secondary.value)) secondary.value = clip.secondaryCategory || '';
  if (productSelect && (force || !productSelect.value)) productSelect.value = clip.productInfo?.type || '';
  if (productName && (force || !productName.value.trim())) productName.value = clip.productInfo?.name || '';
  if (productUrl && (force || !productUrl.value.trim())) productUrl.value = clip.productInfo?.url || '';
  const publicToggle = $('#naverClipPublic'); const scheduleToggle = $('#naverClipSchedule'); const privateScheduleToggle = $('#naverClipPrivateSchedule');
  if (publicToggle && (force || clip.publicEnabled !== undefined)) publicToggle.checked = clip.publicEnabled !== false;
  if (scheduleToggle && (force || clip.scheduleRegistration !== undefined)) scheduleToggle.checked = Boolean(clip.scheduleRegistration);
  if (privateScheduleToggle && (force || clip.schedulePrivate !== undefined)) privateScheduleToggle.checked = Boolean(clip.schedulePrivate);
  if (clip.country) document.querySelector(`input[name="naverClipCountry"][value="${clip.country}"]`)?.click();
  document.querySelector('input[name="naverClipComments"][value="deny"]')?.click();
  const hint = $('#naverClipCategoryHint'); if (hint && primary?.value && secondary?.value) hint.textContent = `${primary.value} · ${secondary.value} 카테고리를 자동 추천했습니다.`;
}
function renderNaverClipOptions() {
  const panel = $('#naverClipOptions'); if (!panel) return;
  // Keep the Naver Clip preparation card directly above the Instagram card,
  // matching the order used by the real Naver upload flow. The card is still
  // hidden unless a verified Naver route exists, so this only controls layout.
  const instagramPanel = $('#instagramOptions');
  if (instagramPanel && panel.parentElement === instagramPanel.parentElement && panel.nextElementSibling !== instagramPanel) {
    panel.parentElement.insertBefore(panel, instagramPanel);
  }
  // Keep both preparation cards present as the default workspace. They remain
  // display-only until a verified account and a routed video are available.
  const visible = true; panel.hidden = false;
  const video = videoForSlot(state.selectedSlot) || naverClipRoutedVideos()[0];
  const clip = video?.aiMetadata?.naverClip || {
    description: '영상 소개를 입력하면 클립 설명으로 사용됩니다.',
    primaryCategory: '라이프 이벤트',
    secondaryCategory: '라이프 이벤트',
    publicEnabled: true,
    commentsAllowed: 'deny'
  };
  if (visible) applyNaverClipMetadata(clip);
  const generating = visible && video && !clip && state.naverClipAutoSlots.has(video.id);
  const generateButton = $('#generateNaverClipButton'); if (generateButton) { generateButton.disabled = Boolean(generating); generateButton.textContent = generating ? '클립 설정 자동 준비 중…' : '✦ 클립 문구·카테고리 자동 생성'; }
  if (visible && video && !clip && !state.naverClipAutoSlots.has(video.id)) {
    state.naverClipAutoSlots.add(video.id);
    const hint = $('#naverClipCategoryHint'); if (hint) hint.textContent = '클립 문구와 카테고리를 자동으로 준비하고 있습니다.';
    generateNaverClipForVideo(video).then(() => renderAll()).catch(() => { state.naverClipAutoSlots.delete(video.id); const retryHint = $('#naverClipCategoryHint'); if (retryHint) retryHint.textContent = '자동 준비에 실패했습니다. 생성 버튼으로 다시 시도해 주세요.'; renderNaverClipOptions(); });
  }
  const ready = visible && hasNaverClipRoute() && ($('#naverClipDescription')?.value.trim().length || 0) >= 10 && Boolean($('#naverClipCategoryPrimary')?.value) && Boolean($('#naverClipCategorySecondary')?.value);
  const naverAccounts = state.accounts.filter((account) => account.provider === 'naver' && isAuthenticatedAccount(account));
  const uploading = naverAccounts.some((account) => state.directUploads.has(account.id));
  const registerButton = $('#registerNaverClipButton');
  if (registerButton) {
    registerButton.disabled = !ready || uploading;
    registerButton.innerHTML = uploading ? '최종 등록 확인 중… <span>↻</span>' : '네이버 클립 최종 등록 <span>→</span>';
  }
  const uploadStatus = $('#naverClipUploadStatus');
  if (uploadStatus) {
    const status = state.naverUploadStatus.state;
    let message = state.naverUploadStatus.message;
    if (!message && isUploadPageReady('naver')) message = '로그인과 업로드 페이지 준비가 완료되었습니다. 최종 등록 후 콘텐츠 목록까지 확인합니다.';
    if (!message && naverAccounts.length) message = '최종 등록을 누르면 업로드 페이지 준비부터 콘텐츠 목록 확인까지 자동으로 진행합니다.';
    if (!message) message = '네이버 로그인과 영상 슬롯 연결이 필요합니다.';
    uploadStatus.dataset.state = uploading ? 'uploading' : status;
    uploadStatus.querySelector('span').textContent = message;
  }
}
function applyInstagramMetadata(metadata, force = false) {
  if (!metadata) return;
  const caption = $('#instagramCaption');
  if (caption && (force || !caption.value.trim())) caption.value = metadata.caption || '';
  const shareToFeed = $('#instagramShareToFeed');
  if (shareToFeed && (force || metadata.shareToFeed !== undefined)) shareToFeed.checked = metadata.shareToFeed !== false;
  const allowComments = $('#instagramAllowComments');
  if (allowComments && (force || metadata.allowComments !== undefined)) allowComments.checked = metadata.allowComments !== false;
  const facebookPrivacy = $('#facebookPrivacy');
  if (facebookPrivacy && (force || metadata.privacy)) facebookPrivacy.value = metadata.privacy || 'public';
  const hint = $('#instagramStatusHint');
  if (hint && metadata.caption) hint.textContent = '릴스 캡션과 게시 옵션이 자동으로 준비되었습니다.';
}
function renderInstagramOptions() {
  const panel = $('#instagramOptions'); if (!panel) return;
  const facebookMode = hasFacebookRoute() || !hasInstagramRoute();
  const visible = true; panel.hidden = false;
  const eyebrow = panel.querySelector('.eyebrow'); if (eyebrow) eyebrow.textContent = facebookMode ? 'FACEBOOK VIDEO FORMAT' : 'INSTAGRAM REELS FORMAT';
  const heading = panel.querySelector('.instagram-head strong'); if (heading) heading.textContent = facebookMode ? '페이스북 동영상 자동 설정' : '인스타그램 릴스 자동 설정';
  const description = panel.querySelector('.instagram-head p'); if (description) description.textContent = facebookMode ? 'Facebook 계정에 연결된 프로그램 저장 슬롯 1~10번을 사용합니다.' : 'Instagram 계정에 연결된 프로그램 저장 슬롯 1~10번을 사용합니다.';
  const generateLabel = panel.querySelector('#generateInstagramButton'); if (generateLabel && !generateLabel.disabled) generateLabel.textContent = facebookMode ? '✦ 페이스북 글 자동 생성' : '✦ 릴스 문구 자동 생성';
  const captionLabel = panel.querySelector('label'); if (captionLabel?.firstChild) captionLabel.firstChild.textContent = facebookMode ? '페이스북 게시글' : '릴스 캡션';
  const caption = $('#instagramCaption'); if (caption) caption.placeholder = facebookMode ? '페이스북 동영상에 표시할 게시글' : '인스타그램 릴스에 표시할 캡션';
  const postButton = $('#publishInstagramButton'); if (postButton) postButton.innerHTML = `${facebookMode ? '페이스북 게시' : '게시'} <span>→</span>`;
  const video = videoForSlot(state.selectedSlot) || (facebookMode ? facebookRoutedVideos() : instagramRoutedVideos())[0]; const metadata = facebookMode ? video?.aiMetadata?.facebook : video?.aiMetadata?.instagram;
  if (visible) applyInstagramMetadata(metadata || {
    caption: '영상 소개를 입력하면 게시글 문구로 사용됩니다.',
    shareToFeed: true,
    allowComments: false,
    privacy: 'public'
  });
  const generating = visible && video && !metadata && state.instagramAutoSlots.has(video.id);
  const generateButton = $('#generateInstagramButton'); if (generateButton) { generateButton.disabled = Boolean(generating); generateButton.textContent = generating ? `${facebookMode ? '페이스북' : '릴스'} 설정 자동 준비 중…` : `✦ ${facebookMode ? '페이스북 글' : '릴스 문구'} 자동 생성`; }
  if (visible && video && !metadata && !state.instagramAutoSlots.has(video.id)) {
    state.instagramAutoSlots.add(video.id);
    const hint = $('#instagramStatusHint'); if (hint) hint.textContent = '릴스 문구와 게시 옵션을 자동으로 준비하고 있습니다.';
    (facebookMode ? generateFacebookForVideo(video) : generateInstagramForVideo(video)).then((result) => { applyInstagramMetadata(facebookMode ? { caption: result.description, hashtags: result.hashtags } : result.instagram, true); renderAll(); }).catch(() => { state.instagramAutoSlots.delete(video.id); const retryHint = $('#instagramStatusHint'); if (retryHint) retryHint.textContent = '자동 준비에 실패했습니다. 생성 버튼으로 다시 시도해 주세요.'; renderInstagramOptions(); });
  }
  const ready = visible && (hasInstagramRoute() || hasFacebookRoute()) && Boolean($('#instagramCaption')?.value.trim());
  const publishButton = $('#publishInstagramButton'); if (publishButton) publishButton.disabled = !ready;
}
function readInstagramForm() {
  const caption = $('#instagramCaption')?.value.trim() || '';
  if (!hasInstagramRoute() && !hasFacebookRoute()) return null;
  const metadata = { caption, hashtags: ($('#campaignHashtags')?.value || '').split(/\s+/).map((tag) => tag.trim()).filter(Boolean), shareToFeed: $('#instagramShareToFeed')?.checked !== false, allowComments: $('#instagramAllowComments')?.checked !== false, privacy: $('#facebookPrivacy')?.value || 'public' };
  const facebookMode = hasFacebookRoute();
  const video = videoForSlot(state.selectedSlot) || (facebookMode ? facebookRoutedVideos() : instagramRoutedVideos())[0]; if (video) video.aiMetadata = { ...(video.aiMetadata || {}), [facebookMode ? 'facebook' : 'instagram']: metadata };
  return metadata;
}
function readNaverClipForm() {
  const description = $('#naverClipDescription')?.value.trim() || ''; const primaryCategory = $('#naverClipCategoryPrimary')?.value || ''; const secondaryCategory = $('#naverClipCategorySecondary')?.value || '';
  if (!hasNaverClipRoute()) return null;
  const productType = $('#naverProductSelect')?.value || ''; const productName = $('#naverProductName')?.value.trim() || ''; const productUrl = $('#naverProductUrl')?.value.trim() || '';
  const clip = { title: $('#campaignTitle')?.value.trim() || '', description, hashtags: ($('#campaignHashtags')?.value || '').split(/\s+/).map((tag) => tag.trim()).filter(Boolean), primaryCategory, secondaryCategory, productInfo: productName || productUrl ? { type: productType, name: productName, url: productUrl } : null, publicEnabled: $('#naverClipPublic')?.checked !== false, scheduleRegistration: Boolean($('#naverClipSchedule')?.checked), schedulePrivate: Boolean($('#naverClipPrivateSchedule')?.checked), country: document.querySelector('input[name="naverClipCountry"]:checked')?.value || 'all', commentsAllowed: 'deny' };
  const video = videoForSlot(state.selectedSlot) || naverClipRoutedVideos()[0]; if (video) video.aiMetadata = { ...(video.aiMetadata || {}), naverClip: clip };
  return clip;
}
function renderAll() { syncQuickProviders(); renderStats(); renderSlots(); renderAccounts(); renderLoginPages(); renderSidebarStatus(); renderQuickPublish(); renderNaverClipOptions(); renderInstagramOptions(); renderCampaigns(); renderCalendar(); renderAnalytics(); renderComments(); renderLogs(); renderSettings(); $('#lastUpdated').textContent = `마지막 동기화 ${formatDate(new Date(), { hour: '2-digit', minute: '2-digit' })}`; }
function filterWorkspace(query) {
  const normalized = String(query || '').trim().toLowerCase();
  ['.slot-card', '.account-card', '.campaign-card', '.login-page', '.comment-card'].forEach((selector) => {
    $$(selector).forEach((item) => item.classList.toggle('is-search-hidden', Boolean(normalized && !item.textContent.toLowerCase().includes(normalized))));
  });
}

async function loadData() {
  try {
    const [videos, accounts, campaigns, analytics, comments, logs, settings] = await Promise.all([api('/api/videos'), api('/api/accounts'), api('/api/campaigns'), api('/api/analytics'), api('/api/comments'), api('/api/logs?limit=80'), api('/api/settings')]);
    applyProviderCatalog(accounts.providers || []);
    state.videos = videos.videos || [];
    state.accounts = (accounts.accounts || []).filter((account) => supportedProviderKeys.has(account.provider));
    state.campaigns = (campaigns.campaigns || []).map((campaign) => ({ ...campaign, jobs: (campaign.jobs || []).filter((job) => supportedProviderKeys.has(job.provider)) })).filter((campaign) => campaign.jobs.length > 0);
    state.analytics = { ...analytics, jobs: (analytics.jobs || []).filter((job) => supportedProviderKeys.has(job.provider)) };
    state.comments = (comments.comments || []).filter((comment) => supportedProviderKeys.has(comment.provider));
    state.logs = logs.logs || []; state.settings = settings.settings || {};
    await restoreRememberedLoginStates();
    state.quickProviders = new Set();
    if (!state.campaignsLoaded) state.campaignsLoaded = true;
    state.selectedSlot = state.videos.find((video) => video.slotNumber)?.slotNumber || 1; renderAll(); const source = videoForSlot(state.selectedSlot); if (source && !$('#campaignTitle').value) fillMetadata(source); prepareRestoredUploadPages();
  } catch (error) { showToast(error.message || '프로그램 데이터를 불러오지 못했습니다.', true); }
}

async function restoreRememberedLoginStates() {
  if (!window.desktopWindow?.restoreAuthSessions) return;
  try {
    const result = await window.desktopWindow.restoreAuthSessions();
    const restoredByProvider = new Map((result?.providers || []).map((item) => [item.provider, item]));
    for (const provider of loginProviders) {
      const restored = restoredByProvider.get(provider.key);
      if (!restored) continue;
      let accounts = state.accounts.filter((account) => account.provider === provider.key);
      if (restored.verified) {
        if (!accounts.length && window.desktopWindow?.getSavedCredentials) {
          const saved = await window.desktopWindow.getSavedCredentials(provider.key).catch(() => null);
          if (saved?.handle) {
            const created = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: provider.key, displayName: saved.displayName || `${provider.label} 계정`, handle: saved.handle, authVerified: true }) }).catch(() => null);
            if (created?.account) {
              state.accounts.unshift(created.account);
              accounts = [created.account];
              const selectedVideo = videoForSlot(state.selectedSlot);
              if (selectedVideo) {
                const routed = await api(`/api/accounts/${encodeURIComponent(created.account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: [state.selectedSlot] }) }).catch(() => null);
                if (routed?.account) Object.assign(created.account, routed.account);
              }
            }
          }
        }
        state.loginStates[provider.key] = 'connected';
        state.uploadPageStates[provider.key] = 'checking';
        accounts.forEach((account) => Object.assign(account, { status: 'connected', authVerified: true, mode: 'oauth' }));
      } else {
        state.loginStates[provider.key] = accounts.length ? 'failed' : 'idle';
        state.uploadPageStates[provider.key] = 'failed';
        accounts.forEach((account) => Object.assign(account, { status: 'login_required', authVerified: false, mode: 'oauth_pending' }));
      }
    }
  } catch {}
}

function fillMetadata(video) {
  if (!video) return;
  const meta = video.aiMetadata || {};
  const fallbackTitle = String(video.originalName || `영상 ${video.slotNumber || ''}`).replace(/\.[^.]+$/, '').trim();
  if (!$('#campaignTitle').value.trim()) $('#campaignTitle').value = meta.title || fallbackTitle || '새 동영상';
  if (!$('#campaignDescription').value.trim()) $('#campaignDescription').value = meta.description || `${$('#campaignTitle').value.trim()} 업로드 설명`;
  if (!$('#campaignHashtags').value.trim()) $('#campaignHashtags').value = (meta.hashtags || ['#동영상', '#콘텐츠']).join(' ');
  applyNaverClipMetadata(meta.naverClip);
  applyInstagramMetadata(meta.instagram);
}
async function generateAi() { const video = videoForSlot(state.selectedSlot); if (!video) return showToast('먼저 영상을 선택해 주세요.', true); try { const result = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.id }) }); Object.assign(video, result.video); fillMetadata(video); showToast(result.metadata.source === 'openai' ? 'OpenAI 초안을 적용했습니다.' : '로컬 fallback 초안을 적용했습니다.'); } catch (error) { showToast(error.message, true); } }
async function generateNaverClipForVideo(video) { const result = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.id, provider: 'naver' }) }); Object.assign(video, result.video); return result.metadata; }
async function generateInstagramForVideo(video) { const result = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.id, provider: 'instagram' }) }); Object.assign(video, result.video); return result.metadata; }
async function generateFacebookForVideo(video) { const result = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.id, provider: 'facebook' }) }); Object.assign(video, result.video); video.aiMetadata = { ...(video.aiMetadata || {}), facebook: { caption: result.metadata.description || result.metadata.title || '', hashtags: result.metadata.hashtags || [] } }; return video.aiMetadata.facebook; }
async function generateNaverClip() { const video = videoForSlot(state.selectedSlot) || naverClipRoutedVideos()[0]; if (!video) return showToast('먼저 프로그램에 영상을 저장해 주세요.', true); if (!hasNaverClipRoute()) return showToast('먼저 네이버 클립 계정에 저장 슬롯을 연결해 주세요.', true); try { const metadata = await generateNaverClipForVideo(video); state.naverClipAutoSlots.delete(video.id); fillMetadata(video); applyNaverClipMetadata(metadata.naverClip, true); renderAll(); showToast('네이버 클립 문구와 카테고리를 자동 선택했습니다.'); } catch (error) { showToast(error.message, true); } }
async function registerNaverClip() { const accounts = state.accounts.filter((item) => item.provider === 'naver' && isAuthenticatedAccount(item) && (item.slotNumbers || []).some((slot) => videoForSlot(slot))); if (!accounts.length) return showToast('프로그램에 저장된 영상과 연결된 네이버 클립 계정이 없습니다.', true); const clip = readNaverClipForm(); if (!clip || clip.description.length < 10 || !clip.primaryCategory || !clip.secondaryCategory) return showToast('클립 설명을 10자 이상 입력하고 카테고리를 선택해 주세요.', true); for (const account of accounts) await uploadNaverClipAccountVideos(account.id, clip); }
async function generateInstagram() { const video = videoForSlot(state.selectedSlot) || instagramRoutedVideos()[0]; if (!video) return showToast('먼저 프로그램에 영상을 저장해 주세요.', true); if (!hasInstagramRoute()) return showToast('먼저 Instagram 계정에 저장 슬롯을 연결해 주세요.', true); try { const metadata = await generateInstagramForVideo(video); state.instagramAutoSlots.delete(video.id); fillMetadata(video); applyInstagramMetadata(metadata.instagram, true); renderAll(); showToast('Instagram 릴스 문구와 게시 옵션을 준비했습니다.'); } catch (error) { showToast(error.message, true); } }
async function publishInstagram() { const accounts = state.accounts.filter((item) => item.provider === 'instagram' && isAuthenticatedAccount(item) && (item.slotNumbers || []).some((slot) => videoForSlot(slot))); if (!accounts.length) return showToast('프로그램에 저장된 영상과 연결된 Instagram 계정이 없습니다.', true); const metadata = readInstagramForm(); if (!metadata?.caption) return showToast('릴스 캡션을 준비해 주세요.', true); for (const account of accounts) await uploadAccountVideos(account.id, metadata, '게시'); }

async function generateSocialPostCopy() { const facebookMode = hasFacebookRoute() && !hasInstagramRoute(); const video = videoForSlot(state.selectedSlot) || (facebookMode ? facebookRoutedVideos() : instagramRoutedVideos())[0]; if (!video) return showToast('먼저 프로그램에 저장된 영상을 선택해 주세요.', true); try { const metadata = await (facebookMode ? generateFacebookForVideo(video) : generateInstagramForVideo(video)); state.instagramAutoSlots.delete(video.id); fillMetadata(video); applyInstagramMetadata(facebookMode ? metadata : metadata.instagram, true); renderAll(); showToast(`${facebookMode ? 'Facebook 게시글' : 'Instagram 릴스'} 문구를 준비했습니다.`); } catch (error) { showToast(error.message, true); } }
async function publishSocialPost() { const facebookMode = hasFacebookRoute(); const providerKey = facebookMode ? 'facebook' : 'instagram'; const accounts = state.accounts.filter((item) => item.provider === providerKey && isAuthenticatedAccount(item) && (item.slotNumbers || []).some((slot) => videoForSlot(slot))); if (!accounts.length) return showToast(`프로그램에 저장된 영상과 연결된 ${facebookMode ? 'Facebook' : 'Instagram'} 계정이 없습니다.`, true); const metadata = readInstagramForm(); if (!metadata?.caption) return showToast(`${facebookMode ? 'Facebook 게시글' : '릴스 캡션'}을 준비해 주세요.`, true); for (const account of accounts) await uploadAccountVideos(account.id, metadata, '게시', { directUpload: true, privacy: facebookMode ? metadata.privacy : 'public' }); }
function validateFile(file) { const extension = file.name.split('.').pop().toLowerCase(); if (!allowedExtensions.has(extension)) return 'MP4, MOV, WebM, MKV 파일만 올릴 수 있습니다.'; if (file.size > maxFileSize) return '파일 크기는 2 GB 이하여야 합니다.'; if (!file.size) return '빈 파일은 업로드할 수 없습니다.'; return null; }
function firstFreeSlot() { return Array.from({ length: 10 }, (_, index) => index + 1).find((slot) => !videoForSlot(slot)); }
function uploadFile(file, slotNumber) {
  const validation = validateFile(file); if (validation) return showToast(`${file.name}: ${validation}`, true); const existing = videoForSlot(slotNumber); const queueId = `${Date.now()}-${Math.random()}`; state.queue.set(queueId, { file, slotNumber, progress: 0, status: 'uploading', resetTimer: null }); renderQueue();
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/videos'); xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name)); xhr.setRequestHeader('X-File-Type', file.type || 'video/mp4'); xhr.setRequestHeader('X-File-Size', String(file.size)); xhr.setRequestHeader('X-Slot-Number', String(slotNumber)); xhr.setRequestHeader('X-Replace', String(Boolean(existing)));
  xhr.upload.addEventListener('progress', (event) => { const item = state.queue.get(queueId); if (item && event.lengthComputable) { item.progress = Math.round((event.loaded / event.total) * 100); renderQueue(); if (item.progress >= 100 && !item.resetTimer) { item.resetTimer = setTimeout(() => { const current = state.queue.get(queueId); if (current && current.progress >= 100) { current.progress = 0; current.resetTimer = null; renderQueue(); } }, 3000); } } });
  xhr.addEventListener('load', () => { const item = state.queue.get(queueId); if (xhr.status >= 200 && xhr.status < 300) { const payload = JSON.parse(xhr.responseText); state.videos = [...state.videos.filter((video) => video.slotNumber !== payload.video.slotNumber), payload.video].sort((a, b) => a.slotNumber - b.slotNumber); state.selectedSlot = payload.video.slotNumber; state.queue.delete(queueId); fillMetadata(payload.video); renderAll(); showToast(`${payload.video.slotNumber}번 슬롯에 저장했습니다.`); } else { let message = '업로드에 실패했습니다.'; try { message = JSON.parse(xhr.responseText).error.message; } catch {} if (item) { item.status = 'error'; item.error = message; renderQueue(); } showToast(message, true); setTimeout(() => { state.queue.delete(queueId); renderQueue(); }, 4000); } });
  xhr.addEventListener('error', () => { state.queue.delete(queueId); renderQueue(); showToast('서버에 연결할 수 없습니다.', true); }); xhr.send(file);
}
function renderQueue() { const items = [...state.queue.values()]; $('#queueSection').hidden = !items.length; $('#queueCount').textContent = items.length; $('#queueList').innerHTML = items.map((item) => `<div class="queue-row"><span class="slot-number">${String(item.slotNumber).padStart(2, '0')}</span><div><strong>${escapeHtml(item.file.name)}</strong><div class="progress-track"><i style="width:${item.progress}%"></i></div></div><b>${item.status === 'error' ? '실패' : `${item.progress}%`}</b></div>`).join(''); }
function readVideoMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let finished = false;
    const finish = (metadata) => { if (finished) return; finished = true; URL.revokeObjectURL(url); resolve(metadata); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
    video.onerror = () => finish(null);
    video.src = url;
    video.load();
  });
}

async function validateProfileVideo(file) {
  if (file.size > maxFileSize) return `1분 9:16 프로필 기준 예상 용량 ${formatBytes(maxFileSize)} 이하의 파일을 사용해 주세요.`;
  const basic = validateFile(file);
  if (basic) return basic;
  const metadata = await readVideoMetadata(file);
  if (!metadata || !metadata.width || !metadata.height || !Number.isFinite(metadata.duration)) return '동영상 정보를 읽을 수 없습니다.';
  const ratio = metadata.width / metadata.height;
  if (Math.abs(ratio - VIDEO_PROFILE.ratio) > 0.015) return '세로형 9:16 동영상만 업로드할 수 있습니다.';
  if (metadata.duration > VIDEO_PROFILE.durationSeconds + 0.2) return '동영상 길이는 1분 이하여야 합니다.';
  if (metadata.width !== VIDEO_PROFILE.width || metadata.height !== VIDEO_PROFILE.height) showToast(`${file.name}: 권장 해상도는 1080×1920입니다. 현재 영상은 9:16 비율로 업로드합니다.`);
  return null;
}

const uploadFileBase = uploadFile;
uploadFile = async function uploadProfileVideo(file, slotNumber) {
  const validation = await validateProfileVideo(file);
  if (validation) return showToast(`${file.name}: ${validation}`, true);
  return uploadFileBase(file, slotNumber);
};

function startFilePicker(slot) { state.pendingUploadSlot = slot === 'auto' ? (firstFreeSlot() || state.selectedSlot) : Number(slot); $('#fileInput').value = ''; $('#fileInput').click(); }
function handleSelectedFiles(files) { let slot = state.pendingUploadSlot || firstFreeSlot(); for (const file of files) { if (!slot) { showToast('10개 슬롯이 가득 찼습니다.', true); break; } uploadFile(file, slot); slot = firstFreeSlot(); } state.pendingUploadSlot = null; }

async function deleteVideo(id) { const video = state.videos.find((item) => item.id === id); if (!video || !window.confirm(`${video.slotNumber}번 슬롯 영상을 삭제할까요? 연결된 미게시 작업은 취소됩니다.`)) return; try { await api(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.videos = state.videos.filter((item) => item.id !== id); state.accounts.forEach((account) => { account.slotNumbers = (account.slotNumbers || []).filter((slot) => slot !== video.slotNumber); }); if (state.selectedSlot === video.slotNumber) state.selectedSlot = firstFreeSlot() || 1; renderAll(); showToast(`${video.slotNumber}번 슬롯을 비웠습니다.`); } catch (error) { showToast(error.message, true); } }
async function toggleRoute(input) { const account = state.accounts.find((item) => item.id === input.dataset.accountSlot); const slot = Number(input.dataset.slotNumber); if (!account) return; if (uploadedSlotsForAccount(account.id).has(slot)) { input.checked = true; showToast(`${slot}번 영상은 이미 업로드되어 다시 선택할 수 없습니다.`, true); return; } const previous = [...(account.slotNumbers || [])]; account.slotNumbers = input.checked ? [...new Set([...previous, slot])].sort((a, b) => a - b) : previous.filter((item) => item !== slot); state.accountUploadStates.delete(account.id); renderAccounts(); try { const result = await api(`/api/accounts/${encodeURIComponent(account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: account.slotNumbers }) }); Object.assign(account, result.account); renderAll(); } catch (error) { account.slotNumbers = previous; renderAll(); showToast(error.message, true); } }

async function saveAccount(event) { event.preventDefault(); try { const result = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: $('#accountProvider').value, displayName: $('#accountDisplayName').value, handle: $('#accountHandle').value }) }); state.accounts.unshift(result.account); const quickProvider = state.pendingQuickProvider; state.pendingQuickProvider = ''; if (quickProvider === result.account.provider && videoForSlot(state.selectedSlot)) { state.quickProviders.add(quickProvider); result.account.slotNumbers = [state.selectedSlot]; try { const routed = await api(`/api/accounts/${encodeURIComponent(result.account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: result.account.slotNumbers }) }); Object.assign(result.account, routed.account); } catch {} } closeAccountModal(); renderAll(); document.querySelector(`#login-${result.account.provider}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); showToast(`${providerFor(result.account.provider).label} 계정을 연결했습니다.`); } catch (error) { showToast(error.message, true); } }
async function resetAccountRoutes(id) { const account = state.accounts.find((item) => item.id === id); if (!account) return; if (!(account.slotNumbers || []).length) return showToast('이미 선택된 영상이 없습니다.'); if (!window.confirm(`${account.handle} 계정의 선택 영상과 업로드 상태를 모두 리셋할까요? 로그인 상태는 유지됩니다.`)) return; const previous = [...(account.slotNumbers || [])]; try { const result = await api(`/api/accounts/${encodeURIComponent(id)}/reset`, { method: 'POST' }); Object.assign(account, result.account, { slotNumbers: [] }); state.campaigns = result.campaigns || []; state.accountUploadStates.delete(id); renderAll(); showToast(`${previous.length}개 영상 선택과 업로드 상태를 리셋했습니다. 로그인 상태는 유지됩니다.`); } catch (error) { account.slotNumbers = previous; renderAll(); showToast(error.message, true); } }
async function removeAccount(id) { const account = state.accounts.find((item) => item.id === id); if (!account || !window.confirm(`${account.handle} 연결을 해제할까요?`)) return; try { await api(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.accounts = state.accounts.filter((item) => item.id !== id); state.accountUploadStates.delete(id); if (!state.accounts.some((item) => item.provider === account.provider)) state.uploadPageStates[account.provider] = 'idle'; renderAll(); showToast('계정 연결을 해제했습니다.'); } catch (error) { showToast(error.message, true); } }
async function forceLogoutProvider(providerKey) {
  const provider = providerFor(providerKey);
  if (!window.confirm(`${provider.label}에서 강제 로그아웃할까요? 연결 계정, 저장된 로그인 정보, 이 PC의 로그인 세션을 정리합니다.`)) return;
  try {
    const accounts = state.accounts.filter((account) => account.provider === providerKey);
    await Promise.all(accounts.map((account) => api(`/api/accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' })));
    await window.desktopWindow?.forceLogout?.(providerKey);
    await window.desktopWindow?.clearSavedCredentials?.(providerKey);
    state.accounts = state.accounts.filter((account) => account.provider !== providerKey);
    accounts.forEach((account) => state.accountUploadStates.delete(account.id));
    state.quickProviders.delete(providerKey);
    state.loginStates[providerKey] = 'idle';
    state.uploadPageStates[providerKey] = 'idle';
    renderAll();
    showToast(`${provider.label} 강제 로그아웃이 완료되었습니다.`);
  } catch (error) { showToast(error.message, true); }
}

async function prepareUploadProvider(providerKey, options = {}) {
  const provider = providerFor(providerKey);
  if (!state.accounts.some((account) => account.provider === providerKey && isAuthenticatedAccount(account))) {
    state.uploadPageStates[providerKey] = 'failed';
    renderProviderReadiness();
    if (options.notify) showToast(`${provider.label} 로그인 후 업로드 페이지를 준비할 수 있습니다.`, true);
    return false;
  }
  if (!options.force && isUploadPageReady(providerKey)) return true;
  if (state.uploadPageTasks.has(providerKey)) return state.uploadPageTasks.get(providerKey);
  if (!window.desktopWindow?.prepareUploadPage) {
    state.uploadPageStates[providerKey] = 'failed';
    renderProviderReadiness();
    if (options.notify) showToast('EXE 프로그램에서 업로드 페이지 준비 상태를 확인할 수 있습니다.', true);
    return false;
  }

  const task = (async () => {
    state.uploadPageStates[providerKey] = 'checking';
    renderProviderReadiness();
    try {
      const result = await window.desktopWindow.prepareUploadPage(providerKey);
      const ready = result?.ready === true;
      state.uploadPageStates[providerKey] = ready ? 'ready' : 'failed';
      renderProviderReadiness();
      if (options.notify) showToast(ready ? `${provider.label} 업로드 페이지 준비가 완료되었습니다.` : `${provider.label} 업로드 페이지를 준비하지 못했습니다. 로그인을 다시 확인해 주세요.`, !ready);
      return ready;
    } catch (error) {
      state.uploadPageStates[providerKey] = 'failed';
      renderProviderReadiness();
      if (options.notify) showToast(error.message, true);
      return false;
    } finally {
      state.uploadPageTasks.delete(providerKey);
    }
  })();
  state.uploadPageTasks.set(providerKey, task);
  return task;
}

function prepareRestoredUploadPages() {
  const providersToPrepare = [...new Set(state.accounts.filter(isAuthenticatedAccount).map((account) => account.provider))];
  providersToPrepare.forEach((providerKey) => { prepareUploadProvider(providerKey).catch(() => {}); });
}

async function openUploadProvider(providerKey) {
  const provider = providerFor(providerKey);
  if (!window.desktopWindow?.openUploadPage) return showToast('EXE 프로그램에서 업로드 페이지 이동을 사용할 수 있습니다.', true);
  try {
    state.uploadPageStates[providerKey] = 'checking'; renderProviderReadiness();
    const result = await window.desktopWindow.openUploadPage(providerKey);
    state.uploadPageStates[providerKey] = result?.ready ? 'ready' : 'failed'; renderProviderReadiness();
    if (!result?.opened) return showToast(`${provider.label} 업로드 페이지를 준비하지 못했습니다. 로그인을 다시 확인해 주세요.`, true);
    showToast(`${provider.label} 동영상 업로드 페이지를 열었습니다.`);
  } catch (error) { state.uploadPageStates[providerKey] = 'failed'; renderProviderReadiness(); showToast(error.message, true); }
}

async function uploadNaverClipAccountVideos(accountId, clipOverride = null) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return { ok: false, error: '네이버 계정을 찾을 수 없습니다.' };
  if (state.directUploads.has(accountId)) return { ok: false, error: '이미 네이버 클립 등록을 진행하고 있습니다.' };
  if (!isAuthenticatedAccount(account)) { const error = '먼저 네이버 공식 로그인에 성공해 주세요.'; showToast(error, true); return { ok: false, error }; }
  const routedVideos = (account.slotNumbers || []).map((slotNumber) => ({ slotNumber, video: videoForSlot(slotNumber) })).filter(({ video }) => video).sort((a, b) => a.slotNumber - b.slotNumber);
  if (!routedVideos.length) { const error = '네이버 클립에 등록할 영상을 먼저 선택해 주세요.'; showToast(error, true); return { ok: false, error }; }
  state.directUploads.add(accountId);
  setNaverUploadStatus('preparing', '로그인 세션과 네이버 클립 업로드 페이지를 확인하고 있습니다.');
  renderAll();
  try {
    if (!isUploadPageReady('naver')) prepareUploadProvider('naver').catch(() => {});
    return await uploadAccountVideos(accountId, clipOverride, '최종 등록', { directUpload: true });
  } catch (error) {
    setNaverUploadStatus('failed', error.message);
    showToast(error.message, true);
    return { ok: false, error: error.message };
  } finally {
    state.directUploads.delete(accountId);
    renderAll();
  }
}

function setNaverUploadStatus(status, message) {
  state.naverUploadStatus = { state: status, message: String(message || '') };
  renderNaverClipOptions();
}

async function publishSelectedNow(event) {
  event?.preventDefault();
  const accountIds = [...new Set(selectedRoutes().map((route) => route.accountId))];
  if (!accountIds.length) return showToast('먼저 로그인된 SNS와 업로드할 영상 번호를 선택해 주세요.', true);
  readNaverClipForm();
  readInstagramForm();
  const clip = readNaverClipForm();
  const results = [];
  for (const accountId of accountIds) {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) continue;
    if (account.provider === 'naver') results.push(await uploadNaverClipAccountVideos(accountId, clip));
    else results.push(await uploadAccountVideos(accountId, null, '바로 등록', { directUpload: true }));
  }
  if (results.some((result) => result?.ok)) showToast('선택한 SNS에 즉시 등록 작업을 실행했습니다.');
}

function openAccountModal(providerKey = 'instagram') { const provider = providerFor(providerKey); if (providerKey === 'naver' && state.accounts.some((account) => account.provider === 'naver' && isAuthenticatedAccount(account))) { showToast('네이버 계정은 이미 로그인되어 있습니다. 기존 계정 하나만 사용합니다.'); document.querySelector('#login-naver')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; } $('#accountProvider').value = providerKey; $('#accountModalEyebrow').textContent = `${provider.code} / OAUTH LOGIN`; $('#accountModalTitle').textContent = `${provider.label} 로그인 확인`; $('#accountModalDescription').textContent = '공식 로그인 창에서 인증이 성공해야 CONNECTED로 표시됩니다. 실패하거나 취소하면 빨간 상태로 남습니다.'; $('#accountModal').hidden = false; $('#accountDisplayName').value = ''; $('#accountHandle').value = ''; $('#accountPassword').value = ''; $('#accountDisplayName').focus(); return true; }
function closeAccountModal() { $('#accountModal').hidden = true; }

async function fillRememberedCredentials(providerKey) {
  if (!window.desktopWindow?.getSavedCredentials) return;
  try {
    const saved = await window.desktopWindow.getSavedCredentials(providerKey);
    if ($('#accountProvider').value !== providerKey) return;
    if (saved?.saved) {
      $('#accountDisplayName').value = saved.displayName || '';
      $('#accountHandle').value = saved.handle || '';
      $('#accountPassword').value = saved.password || '';
      $('#rememberAccount').checked = true;
    } else {
      $('#accountPassword').value = '';
      $('#rememberAccount').checked = true;
    }
  } catch {}
}

const openAccountModalBase = openAccountModal;
openAccountModal = async function openAccountModalWithMemory(providerKey = 'instagram') {
  if (openAccountModalBase(providerKey) === false) return;
  $('#accountModalDescription').textContent = `${providerFor(providerKey).label} 공식 로그인 창에서 인증을 완료해야 연결됩니다. 비밀번호는 서버에 보내지 않고 이 PC의 암호화 저장소에만 기억합니다.`;
  $('#rememberAccount').checked = true;
  await fillRememberedCredentials(providerKey);
};

async function saveAccountWithCredentials(event) {
  event.preventDefault();
  const provider = $('#accountProvider').value;
  const displayName = $('#accountDisplayName').value.trim();
  const handle = $('#accountHandle').value.trim();
  const password = $('#accountPassword').value;
  const remember = $('#rememberAccount').checked;
  state.loginStates[provider] = 'pending';
  renderLoginPages();
  try {
    if (!window.desktopWindow?.verifyLogin) throw new Error('EXE 프로그램에서 공식 로그인 확인을 실행해 주세요.');
    const auth = await window.desktopWindow.verifyLogin(provider);
    if (!auth?.verified) {
      state.loginStates[provider] = 'failed';
      state.uploadPageStates[provider] = 'failed';
      renderLoginPages();
      return showToast(`${providerFor(provider).label} 로그인에 실패했거나 취소되었습니다.`, true);
    }
    const result = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, displayName, handle, authVerified: true }) });
    if (window.desktopWindow?.saveCredentials) {
      try { await window.desktopWindow.saveCredentials({ provider, displayName, handle, password, remember }); } catch {}
    }
    state.accounts = [result.account, ...state.accounts.filter((item) => item.id !== result.account.id && item.provider !== result.account.provider)];
    state.loginStates[provider] = 'connected';
    state.uploadPageStates[provider] = 'checking';
    state.pendingQuickProvider = '';
    const selectedVideo = videoForSlot(state.selectedSlot);
    let uploadReady = false;
    if (selectedVideo) {
      fillMetadata(selectedVideo);
      state.quickProviders.add(result.account.provider);
      result.account.slotNumbers = [state.selectedSlot];
      try {
        const routed = await api(`/api/accounts/${encodeURIComponent(result.account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: result.account.slotNumbers }) });
        Object.assign(result.account, routed.account);
        uploadReady = true;
      } catch {}
    }
    closeAccountModal();
    renderAll();
    document.querySelector('#slots')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Login is sufficient for the shared upload engine. Prepare the hidden
    // page in the background and do not turn a valid login red when its UI
    // text changes.
    state.uploadPageStates[provider] = 'ready';
    prepareUploadProvider(provider, { force: true }).catch(() => {});
    renderAll();
    showToast(`${providerFor(result.account.provider).label} 로그인 완료 · ${uploadReady ? '영상 선택 완료' : '영상을 추가해 주세요'}${remember ? ' · 로그인 정보 기억됨' : ''}`);
  } catch (error) { state.loginStates[provider] = 'failed'; state.uploadPageStates[provider] = 'failed'; renderAll(); showToast(error.message, true); }
}

async function createCampaign(event) { event.preventDefault(); const routes = selectedRoutes(); if (!routes.length) return showToast('먼저 올릴 SNS를 클릭해 활성화하고 영상 번호를 선택해 주세요.', true); const schedule = $('#scheduleDate').value; if (!schedule) return showToast('예약 시각을 선택해 주세요.', true); try { const hashtags = $('#campaignHashtags').value.split(/\s+/).map((value) => value.trim()).filter(Boolean); const result = await api('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('#campaignTitle').value, description: $('#campaignDescription').value, hashtags, scheduledAt: schedule, privacy: $('#privacySelect').value, routes }) }); state.campaigns.unshift(result.campaign); $('#campaignForm').reset(); const next = new Date(Date.now() + 3600000); next.setSeconds(0, 0); $('#scheduleDate').value = localInputValue(next); renderAll(); showToast(`${result.campaign.jobs.length}개 번호 경로를 예약했습니다.`); if (result.skippedRoutes?.length) showToast(`${result.skippedRoutes.length}개 중복 경로는 건너뛰었습니다.`, true); } catch (error) { showToast(error.message, true); } }
async function runCampaign(id) { try { const result = await api(`/api/campaigns/${encodeURIComponent(id)}/run`, { method: 'POST' }); const index = state.campaigns.findIndex((campaign) => campaign.id === id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('업로드 작업을 실행했습니다.'); } catch (error) { showToast(error.message, true); } }
async function retryJob(id) { try { const result = await api(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }); const index = state.campaigns.findIndex((campaign) => campaign.id === result.campaign.id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('작업을 재시도했습니다.'); } catch (error) { showToast(error.message, true); } }
async function cancelCampaign(id) { if (!window.confirm('예약 작업을 취소할까요? 아직 게시되지 않은 번호 경로만 취소됩니다.')) return; try { const result = await api(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }); const index = state.campaigns.findIndex((campaign) => campaign.id === id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('예약 작업을 취소했습니다.'); } catch (error) { showToast(error.message, true); } }

async function loadInsights() { const [analytics, comments, logs] = await Promise.all([api('/api/analytics'), api('/api/comments'), api('/api/logs?limit=80')]); state.analytics = analytics; state.comments = comments.comments || []; state.logs = logs.logs || []; }
async function refreshAnalytics() { try { await api('/api/analytics/refresh', { method: 'POST' }); await loadInsights(); renderAll(); showToast('게시 통계를 갱신했습니다.'); } catch (error) { showToast(error.message, true); } }
async function replyComment(id) { const text = window.prompt('댓글에 답글을 입력하세요.'); if (!text?.trim()) return; try { await api(`/api/comments/${encodeURIComponent(id)}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); await loadInsights(); renderAll(); showToast('댓글에 답글을 남겼습니다.'); } catch (error) { showToast(error.message, true); } }
async function toggleComment(id, action) { try { await api(`/api/comments/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); await loadInsights(); renderAll(); showToast(action === 'hide' ? '댓글을 숨겼습니다.' : '댓글을 다시 표시했습니다.'); } catch (error) { showToast(error.message, true); } }
async function saveSetting(key, value) { try { const result = await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) }); state.settings = result.settings; if (['launchAtStartup', 'startMinimized'].includes(key) && window.desktopWindow?.setStartup) await window.desktopWindow.setStartup(Boolean(state.settings.launchAtStartup), Boolean(state.settings.startMinimized)); renderSettings(); showToast('설정을 저장했습니다.'); } catch (error) { showToast(error.message, true); renderSettings(); } }
async function checkUpdates() { $('#updateStatus').textContent = '업데이트 채널 확인 중…'; try { const result = window.desktopWindow?.checkForUpdates ? await window.desktopWindow.checkForUpdates() : { status: 'browser-sandbox' }; $('#updateStatus').textContent = result?.status === 'checked' ? '최신 업데이트를 확인했습니다.' : '브라우저 sandbox에서는 업데이트 확인만 표시됩니다.'; } catch { $('#updateStatus').textContent = '업데이트 확인을 완료하지 못했습니다.'; } }

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, a'); if (!target) return;
  if (target.dataset.externalLoginProvider) monitorExternalLogin(target.dataset.externalLoginProvider);
  if (target.dataset.uploadSlot) startFilePicker(target.dataset.uploadSlot);
  if (target.dataset.selectSlot) { state.selectedSlot = Number(target.dataset.selectSlot); const video = videoForSlot(state.selectedSlot); if (video && !$('#campaignTitle').value) fillMetadata(video); renderAll(); }
  if (target.dataset.deleteVideo) deleteVideo(target.dataset.deleteVideo);
  if (target.dataset.quickProvider && requireLoginPrerequisite(target.dataset.quickProvider)) activateQuickProvider(target.dataset.quickProvider);
  if (target.dataset.quickSlotProvider && requireLoginPrerequisite(target.dataset.quickSlotProvider)) toggleQuickProviderSlot(target.dataset.quickSlotProvider, target.dataset.slotNumber);
  if (target.dataset.loginProvider) {
    event.preventDefault();
    if (requireLoginPrerequisite(target.dataset.loginProvider)) openAccountModal(target.dataset.loginProvider);
  }
  if (target.dataset.openAccount || target.id === 'openAccountButton') openAccountModal();
  if (target.dataset.connectMissingProvider && requireLoginPrerequisite(target.dataset.connectMissingProvider)) openAccountModal(target.dataset.connectMissingProvider);
  if (target.dataset.connectAccountProvider && requireLoginPrerequisite(target.dataset.connectAccountProvider)) openAccountModal(target.dataset.connectAccountProvider);
  if (target.dataset.prepareUploadProvider) prepareUploadProvider(target.dataset.prepareUploadProvider, { notify: true, force: true });
  if (target.dataset.uploadAccount) uploadAccountNow(target.dataset.uploadAccount);
  if (target.id === 'registerNaverClipButton') registerNaverClip();
  if (target.id === 'publishInstagramButton') publishSocialPost();
  if (target.dataset.forceLogoutProvider) forceLogoutProvider(target.dataset.forceLogoutProvider);
  if (target.dataset.openUploadProvider) openUploadProvider(target.dataset.openUploadProvider);
  if (target.dataset.removeAccount) removeAccount(target.dataset.removeAccount);
  if (target.dataset.resetAccount) resetAccountRoutes(target.dataset.resetAccount);
  if (target.dataset.runCampaign) runCampaign(target.dataset.runCampaign);
  if (target.dataset.retryJob) retryJob(target.dataset.retryJob);
  if (target.dataset.cancelCampaign) cancelCampaign(target.dataset.cancelCampaign);
  if (target.dataset.replyComment) replyComment(target.dataset.replyComment);
  if (target.dataset.toggleComment) toggleComment(target.dataset.toggleComment, target.dataset.commentAction);
  if (target.dataset.scrollTarget) document.querySelector(target.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth' });
  if (target.dataset.windowAction && window.desktopWindow?.[target.dataset.windowAction]) window.desktopWindow[target.dataset.windowAction]();
});
document.addEventListener('change', (event) => { if (event.target.matches('[data-account-slot]')) toggleRoute(event.target); if (['launchAtStartup', 'startMinimized', 'autoUpdate'].includes(event.target.id)) saveSetting(event.target.id, event.target.checked); if (event.target.closest('#naverClipOptions')) renderNaverClipOptions(); if (event.target.closest('#instagramOptions')) renderInstagramOptions(); });
document.addEventListener('input', (event) => { if (event.target.id === 'workspaceSearch') filterWorkspace(event.target.value); if (event.target.closest('#naverClipOptions')) renderNaverClipOptions(); if (event.target.closest('#instagramOptions')) renderInstagramOptions(); });
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#workspaceSearch')?.focus(); } });
$('#chooseButton').addEventListener('click', (event) => { event.stopPropagation(); startFilePicker('auto'); });
$('#dropZone').addEventListener('click', (event) => { if (!event.target.closest('button')) startFilePicker('auto'); });
$('#dropZone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startFilePicker('auto'); } });
['dragenter', 'dragover'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.add('is-dragging'); }));
['dragleave', 'drop'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.remove('is-dragging'); }));
$('#dropZone').addEventListener('drop', (event) => handleSelectedFiles([...event.dataTransfer.files]));
$('#fileInput').addEventListener('change', () => handleSelectedFiles([...$('#fileInput').files]));
$('#campaignForm').addEventListener('submit', publishSelectedNow); $('#generateAiButton').addEventListener('click', generateAi); $('#generateNaverClipButton').addEventListener('click', generateNaverClip); $('#generateInstagramButton').addEventListener('click', generateSocialPostCopy);
$('#openAccountButton').addEventListener('click', openAccountModal); $('#accountForm').addEventListener('submit', saveAccountWithCredentials); $('#accountProvider').addEventListener('change', () => fillRememberedCredentials($('#accountProvider').value)); $('#closeAccountModal').addEventListener('click', closeAccountModal); $('#cancelAccountModal').addEventListener('click', closeAccountModal); $('#accountModal').addEventListener('click', (event) => { if (event.target.id === 'accountModal') closeAccountModal(); });
$('#prevMonth').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); }); $('#nextMonth').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); }); $('#refreshAnalytics').addEventListener('click', refreshAnalytics); $('#refreshCampaigns').addEventListener('click', loadData); $('#refreshLogs').addEventListener('click', async () => { await loadInsights(); renderAll(); }); $('#checkUpdates').addEventListener('click', checkUpdates);
const initialSchedule = new Date(Date.now() + 3600000); initialSchedule.setSeconds(0, 0); $('#scheduleDate').value = localInputValue(initialSchedule); const loginSecurityCopy = document.querySelector('.login-security-strip strong'); const loginSecurityNote = document.querySelector('.login-security-strip p'); if (loginSecurityCopy) loginSecurityCopy.textContent = '비밀번호는 암호화 저장소에만 보관됩니다.'; if (loginSecurityNote) loginSecurityNote.textContent = '비밀번호는 서버로 보내지지 않으며, Electron에서는 운영체제 암호화 저장소에만 기억합니다.'; loadData();
async function monitorExternalLogin(providerKey) {
  if (state.loginStates[providerKey] === 'pending') return;
  state.loginStates[providerKey] = 'pending';
  renderLoginPages();
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1200 : 2000));
    try {
      const result = await window.desktopWindow?.verifyLogin?.(providerKey);
      if (result?.verified) {
        state.loginStates[providerKey] = 'connected';
        state.uploadPageStates[providerKey] = 'ready';
        await restoreRememberedLoginStates();
        renderAll();
        showToast(`${providerFor(providerKey).label} 로그인됨 · 다시 할 필요 없습니다.`);
        return;
      }
    } catch {}
  }
  state.loginStates[providerKey] = 'failed';
  renderLoginPages();
}

window.desktopWindow?.onNaverClipProgress?.((progress = {}) => {
  if (progress.status === 'preparing' || progress.status === 'registering') showToast(progress.message || '네이버 클립 등록을 준비하고 있습니다.');
  if (progress.status === 'published') showToast(progress.message || `네이버 클립 ${progress.slotNumber}번 동영상 등록이 완료되었습니다.`);
  if (progress.status === 'failed') showToast(progress.message || '네이버 클립 자동 등록에 실패했습니다.', true);
});
function applyVideoProfileCopy() {
  const hint = document.querySelector('#dropZone > div:nth-child(2) span');
  if (hint) hint.textContent = `9:16 세로형 · ${VIDEO_PROFILE.width}×${VIDEO_PROFILE.height} 권장 · 최대 ${VIDEO_PROFILE.durationSeconds}초 · 예상 용량 약 ${formatBytes(estimatedProfileBytes)}`;
}

function decorateSlotSwitches() {
  document.querySelectorAll('[data-account-slot]').forEach((input) => {
    const label = input.closest('.slot-switch');
    if (!label) return;
    const slot = input.dataset.slotNumber;
    const ready = !input.disabled;
    label.classList.toggle('is-ready', ready);
    label.classList.toggle('is-selected', input.checked);
    input.setAttribute('aria-label', `${slot}번 동영상 ${input.checked ? '선택됨' : '선택 안 됨'}${ready ? '' : ' · 업로드 완료 후 선택 가능'}`);
  });
}

const accountGridObserver = $('#accountGrid') ? new MutationObserver(decorateSlotSwitches) : null;
accountGridObserver?.observe($('#accountGrid'), { childList: true, subtree: true });
applyVideoProfileCopy();
decorateSlotSwitches();

async function pollCampaigns() { if (!state.campaignsLoaded) return; try { const payload = await api('/api/campaigns'); state.campaigns = payload.campaigns || []; renderStats(); renderAccounts(); renderCampaigns(); renderCalendar(); } catch {} }
window.setInterval(pollCampaigns, 15000);

// Immediate publishing mode: scheduling remains available to the backend for
// compatibility, but the visible client no longer asks the user for a time.
const scheduleField = $('#scheduleDate')?.closest('label');
if (scheduleField) scheduleField.hidden = true;
const calendarPanel = $('#calendarPanel');
if (calendarPanel) calendarPanel.hidden = true;
const immediateSubmit = document.querySelector('#campaignForm button[type="submit"]');
if (immediateSubmit) immediateSubmit.textContent = '선택한 SNS에 바로 업로드';

document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input.matches('[data-account-slot]')) return;
  const account = state.accounts.find((item) => item.id === input.dataset.accountSlot);
  if (!account || !isAuthenticatedAccount(account)) return;
  const hasRoutedVideo = (account.slotNumbers || []).some((slot) => videoForSlot(slot));
  state.uploadPageStates[account.provider] = hasRoutedVideo ? 'ready' : 'idle';
  setAccountUploadPhase(account.id, hasRoutedVideo ? 'waiting' : 'idle');
  renderAll();
});
if (immediateSubmit) immediateSubmit.innerHTML = '선택된 SNS에 바로 등록 <span>→</span>';
// TikTok uses the already verified Facebook session. Reflect that in the connection dialog.
function syncTikTokLoginDialog() {
  const providerKey = $('#accountProvider')?.value;
  const viaFacebook = providerKey === 'tiktok' && hasLoginPrerequisite('tiktok');
  const submit = $('#accountForm button[type="submit"]');
  const password = $('#accountPassword');
  const passwordLabel = password?.closest('label');
  const remember = $('#rememberAccount')?.closest('.remember-login');
  const provider = providerFor(providerKey || 'instagram');
  if (submit) submit.textContent = viaFacebook ? 'TikTok 로그인' : `${provider.label} 로그인 확인`;
  if (password) {
    password.required = !viaFacebook;
    password.placeholder = viaFacebook ? 'Facebook 로그인 세션을 사용합니다' : '공식 로그인 창에서 입력하세요';
  }
  if (passwordLabel) passwordLabel.hidden = viaFacebook;
  if (remember) remember.hidden = viaFacebook;
}

document.addEventListener('click', (event) => {
  if (event.target.closest('#openAccountButton, [data-login-provider="tiktok"], [data-connect-missing-provider="tiktok"]')) setTimeout(syncTikTokLoginDialog, 0);
  if (event.target.closest('#accountForm button[type="submit"]')) syncTikTokLoginDialog();
});
document.addEventListener('change', (event) => {
  if (event.target.matches('#accountProvider')) syncTikTokLoginDialog();
});
