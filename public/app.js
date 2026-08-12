const state = {
  videos: [], accounts: [], campaigns: [], analytics: { jobs: [], totals: {} }, comments: [], logs: [], settings: {},
  selectedSlot: 1, queue: new Map(), calendarMonth: new Date(), pendingUploadSlot: null, pendingQuickProvider: '', quickProviders: new Set(), announcedJobs: new Set(), uploadNoticeQueue: [], isAnnouncingUpload: false, campaignsLoaded: false
};

const providers = {
  naver: { label: '네이버 클립', code: 'NV' }, tiktok: { label: 'TikTok', code: 'TT' }, facebook: { label: 'Facebook', code: 'FB' }, instagram: { label: 'Instagram', code: 'IG' }
};
const supportedProviderKeys = new Set(Object.keys(providers));
const loginProviders = [
  { key: 'instagram', label: 'Instagram', code: 'IG', service: 'Meta OAuth', accent: 'coral', title: 'Instagram Business 계정', description: '릴스와 피드 게시 권한을 연결합니다.', scopes: 'instagram_content_publish · instagram_basic' },
  { key: 'tiktok', label: 'TikTok', code: 'TT', service: 'TikTok OAuth', accent: 'violet', title: 'TikTok 계정', description: 'Facebook 로그인으로 TikTok 연결을 진행합니다.', scopes: 'video.publish · user.info.basic', requiresProvider: 'facebook' },
  { key: 'naver', label: '네이버 클립', code: 'NV', service: 'NAVER OAuth', accent: 'green', title: '네이버 클립 채널', description: '클립 콘텐츠 게시 권한을 연결합니다.', scopes: 'clip.publish · profile.read' },
  { key: 'facebook', label: 'Facebook', code: 'FB', service: 'Meta OAuth', accent: 'blue', title: 'Facebook 페이지', description: '페이지 동영상 게시와 댓글 관리 권한을 연결합니다.', scopes: 'pages_manage_posts · pages_read_engagement' }
];
const allowedExtensions = new Set(['mp4', 'mov', 'webm', 'mkv']);
const VIDEO_PROFILE = Object.freeze({ width: 1080, height: 1920, ratio: 9 / 16, durationSeconds: 60, videoBitrate: 8_000_000, audioBitrate: 128_000 });
const estimatedProfileBytes = Math.ceil(((VIDEO_PROFILE.videoBitrate + VIDEO_PROFILE.audioBitrate) / 8) * VIDEO_PROFILE.durationSeconds);
const maxFileSize = Math.ceil(estimatedProfileBytes * 1.1);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]); }
function formatNumber(value) { return new Intl.NumberFormat('ko-KR').format(Number(value || 0)); }
function formatDate(value, options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ko-KR', options).format(date); }
function localInputValue(date) { const pad = (value) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function providerFor(key) { return providers[key] || { label: key, code: '??' }; }
function videoForSlot(slot) { return state.videos.find((video) => video.slotNumber === Number(slot)); }
function showToast(message, isError = false) { const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('is-error', isError); toast.classList.add('is-visible'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3400); }
async function api(url, options = {}) { const response = await fetch(url, options); const payload = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(payload.error?.message || '요청을 처리하지 못했습니다.'), { payload, status: response.status }); return payload; }
function loginProviderFor(key) { return loginProviders.find((item) => item.key === key); }
function hasLoginPrerequisite(providerKey) { const provider = loginProviderFor(providerKey); return !provider?.requiresProvider || state.accounts.some((account) => account.provider === provider.requiresProvider && account.status === 'connected'); }
function requireLoginPrerequisite(providerKey) { const provider = loginProviderFor(providerKey); if (!provider?.requiresProvider || hasLoginPrerequisite(providerKey)) return true; const prerequisite = providerFor(provider.requiresProvider); showToast(`${provider.label}은(는) ${prerequisite.label} 로그인 후 진행할 수 있습니다.`, true); document.querySelector(`#login-${provider.requiresProvider}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; }

function selectedRoutes() { return state.accounts.filter((account) => state.quickProviders.has(account.provider)).flatMap((account) => (account.slotNumbers || []).filter((slot) => videoForSlot(slot)).map((slotNumber) => ({ accountId: account.id, slotNumber }))); }
function syncQuickProviders() { state.quickProviders = new Set(state.accounts.filter((account) => videoForSlot(state.selectedSlot) && (account.slotNumbers || []).includes(state.selectedSlot)).map((account) => account.provider)); }

function renderQuickPublish() {
  const target = $('#quickProviderBar');
  if (!target) return;
  const selectedVideo = videoForSlot(state.selectedSlot);
  target.innerHTML = loginProviders.map((item) => {
    const linked = state.accounts.filter((account) => account.provider === item.key);
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
  const accounts = state.accounts.filter((item) => item.provider === providerKey);
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

function speakUploadAnnouncement(message, done = () => {}) {
  if (window.desktopWindow?.speak) {
    window.desktopWindow.speak(message).then((result) => {
      if (result?.supported) done();
      else speakUploadAnnouncementInBrowser(message, done);
    }).catch(() => speakUploadAnnouncementInBrowser(message, done));
    return;
  }
  speakUploadAnnouncementInBrowser(message, done);
}

function speakUploadAnnouncementInBrowser(message, done = () => {}) {
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return done();
  const voices = window.speechSynthesis.getVoices();
  const koreanVoices = voices.filter((voice) => String(voice.lang || '').toLowerCase().startsWith('ko'));
  const femaleKorean = koreanVoices.find((voice) => /female|여성|yuna|sora|heami|google/i.test(voice.name));
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ko-KR'; utterance.rate = 0.92; utterance.pitch = 1.12; utterance.volume = 0.95;
  if (femaleKorean || koreanVoices[0]) utterance.voice = femaleKorean || koreanVoices[0];
  let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  utterance.onend = finish; utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
  window.setTimeout(finish, 5000);
}

function drainUploadAnnouncements() {
  if (state.isAnnouncingUpload || !state.uploadNoticeQueue.length) return;
  state.isAnnouncingUpload = true;
  const message = state.uploadNoticeQueue.shift();
  const notice = $('#uploadNotice');
  if (notice) { notice.hidden = false; $('#uploadNoticeText').textContent = message; notice.classList.add('is-speaking'); clearTimeout(drainUploadAnnouncements.timer); drainUploadAnnouncements.timer = window.setTimeout(() => notice.classList.remove('is-speaking'), 4200); }
  showToast(message);
  speakUploadAnnouncement(message, () => { state.isAnnouncingUpload = false; window.setTimeout(drainUploadAnnouncements, 220); });
}

function uploadAnnouncementFor(job) {
  const slotLabel = `${job.slotNumber}번`;
  const messages = {
    tiktok: `틱톡 ${slotLabel} 동영상이 업로드되었습니다.`,
    naver: `네이버 클립에 ${slotLabel} 동영상이 올라갔습니다.`,
    instagram: `인스타그램에 ${slotLabel} 동영상이 업로드되었습니다.`,
    facebook: `페이스북에 ${slotLabel} 동영상이 업로드되었습니다.`
  };
  return messages[job.provider] || `${providerFor(job.provider).label}에 ${slotLabel} 동영상이 업로드되었습니다.`;
}

function announcePublishedJobs(campaign) {
  (campaign?.jobs || []).filter((job) => job.status === 'published' && !state.announcedJobs.has(job.id)).forEach((job) => {
    state.announcedJobs.add(job.id);
    state.uploadNoticeQueue.push(uploadAnnouncementFor(job));
  });
  drainUploadAnnouncements();
}

async function uploadAccountVideos(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return;
  const routedVideos = (account.slotNumbers || []).map((slotNumber) => ({ slotNumber, video: videoForSlot(slotNumber) })).filter(({ video }) => video);
  if (account.status !== 'connected') return showToast('먼저 이 계정에 로그인해 주세요.', true);
  if (!routedVideos.length) return showToast('이 계정에 업로드할 영상을 먼저 선택해 주세요.', true);
  const provider = providerFor(account.provider);
  const firstVideo = routedVideos[0].video;
  const metadata = firstVideo.aiMetadata || {};
  const routes = routedVideos.map(({ slotNumber }) => ({ accountId: account.id, slotNumber }));
  try {
    const created = await api('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: metadata.title || `${provider.label} ${routedVideos[0].slotNumber}번 동영상`, description: metadata.description || `${provider.label}에 바로 업로드합니다.`, hashtags: metadata.hashtags || ['#동영상', '#콘텐츠'], scheduledAt: new Date().toISOString(), privacy: 'public', routes }) });
    state.campaigns.unshift(created.campaign);
    renderAll();
    const result = await api(`/api/campaigns/${encodeURIComponent(created.campaign.id)}/run`, { method: 'POST' });
    const index = state.campaigns.findIndex((campaign) => campaign.id === result.campaign.id);
    if (index >= 0) state.campaigns[index] = result.campaign;
    await loadInsights();
    renderAll();
    showToast(`${provider.label} ${routedVideos.length}개 동영상 업로드를 완료했습니다.`);
    announcePublishedJobs(result.campaign);
  } catch (error) { showToast(error.message, true); }
}

function renderSidebarStatus() {
  const instagramReady = state.accounts.some((account) => account.provider === 'instagram' && account.status === 'connected');
  const uploadReady = state.videos.length > 0 && selectedRoutes().length > 0;
  const statuses = [
    { ready: instagramReady, light: '#instagramLoginLight', status: '#instagramLoginStatus', code: '#instagramLoginCode', readyText: '로그인 완료', waitText: '연결 필요' },
    { ready: uploadReady, light: '#uploadReadyLight', status: '#uploadReadyStatus', code: '#uploadReadyCode', readyText: '업로드 준비완료', waitText: '영상·라우팅 확인 필요' }
  ];
  statuses.forEach(({ ready, light, status, code, readyText, waitText }) => { $(light)?.classList.toggle('is-ready', ready); $(light)?.classList.toggle('is-waiting', !ready); $(status).textContent = ready ? readyText : waitText; $(code).textContent = ready ? 'BLUE' : 'RED'; $(code).classList.toggle('is-ready', ready); $(code).classList.toggle('is-waiting', !ready); });
}

function renderSidebarStatus() {
  const target = document.querySelector('.status-inline-row');
  if (!target) return;
  const rows = loginProviders.map((item) => {
    const ready = state.accounts.some((account) => account.provider === item.key && account.status === 'connected');
    return `<a class="status-inline-item status-all-item" href="#login-${item.key}" aria-label="${item.label} 로그인 상태"><span class="status-light${ready ? ' is-ready' : ' is-waiting'}"></span><span><strong>${item.label}</strong><small>${ready ? '로그인 완료' : '로그인 필요'}</small></span><b class="${ready ? 'is-ready' : 'is-waiting'}">${ready ? 'GREEN' : 'RED'}</b></a>`;
  });
  const uploadReady = state.videos.length > 0 && selectedRoutes().length > 0;
  rows.push(`<a class="status-inline-item status-all-item" href="#slots" aria-label="업로드 준비 상태"><span class="status-light${uploadReady ? ' is-ready' : ' is-waiting'}"></span><span><strong>업로드 준비</strong><small>${uploadReady ? '영상·라우팅 준비 완료' : '영상·라우팅 확인 필요'}</small></span><b class="${uploadReady ? 'is-ready' : 'is-waiting'}">${uploadReady ? 'GREEN' : 'RED'}</b></a>`);
  target.innerHTML = rows.join('');
}

function renderSidebarStatus() {
  const target = document.querySelector('.status-inline-row');
  if (!target) return;
  const rows = loginProviders.map((item) => {
    const linkedAccounts = state.accounts.filter((account) => account.provider === item.key && account.status === 'connected');
    const loggedIn = linkedAccounts.length > 0;
    const uploadReady = loggedIn && Boolean(videoForSlot(state.selectedSlot)) && linkedAccounts.some((account) => (account.slotNumbers || []).includes(state.selectedSlot));
    const light = (ready) => `<i class="status-check-light${ready ? ' is-ready' : ' is-waiting'}"></i>`;
    const code = (ready) => `<b class="${ready ? 'is-ready' : 'is-waiting'}">${ready ? 'GREEN' : 'RED'}</b>`;
    return `<a class="status-inline-item status-all-item status-sns-item" href="#login-${item.key}" aria-label="${item.label} 로그인 및 업로드 상태"><div class="status-provider-head"><span class="status-light${loggedIn ? ' is-ready' : ' is-waiting'}"></span><span><strong>${item.label}</strong><small>${loggedIn ? '로그인 완료' : '로그인 필요'}</small></span>${code(loggedIn)}</div><div class="status-provider-checks"><span class="status-check${loggedIn ? ' is-ready' : ' is-waiting'}">${light(loggedIn)}로그인 ${code(loggedIn)}</span><span class="status-check${uploadReady ? ' is-ready' : ' is-waiting'}">${light(uploadReady)}업로드 준비 ${code(uploadReady)}</span></div></a>`;
  });
  const uploadReady = state.videos.length > 0 && selectedRoutes().length > 0;
  rows.push(`<a class="status-inline-item status-all-item status-overall-item" href="#slots" aria-label="전체 업로드 준비 상태"><div class="status-provider-head"><span class="status-light${uploadReady ? ' is-ready' : ' is-waiting'}"></span><span><strong>전체 업로드 준비</strong><small>${uploadReady ? '모든 선택 경로 준비 완료' : '영상·SNS 라우팅 확인 필요'}</small></span>${code(uploadReady)}</div></a>`);
  target.innerHTML = rows.join('');
}

function renderSidebarStatus() {
  const target = document.querySelector('.status-inline-row');
  if (!target) return;
  target.innerHTML = loginProviders.map((item) => {
    const linkedAccounts = state.accounts.filter((account) => account.provider === item.key && account.status === 'connected');
    const loggedIn = linkedAccounts.length > 0;
    const uploadReady = loggedIn && Boolean(videoForSlot(state.selectedSlot)) && linkedAccounts.some((account) => (account.slotNumbers || []).includes(state.selectedSlot));
    const chip = (label, ready) => `<span class="status-state-chip${ready ? ' is-ready' : ' is-waiting'}"><i class="status-check-light${ready ? ' is-ready' : ' is-waiting'}"></i>${label}<b>${ready ? 'GREEN' : 'RED'}</b></span>`;
    return `<a class="status-inline-item status-all-item status-sns-single-row" href="#login-${item.key}" aria-label="${item.label} 로그인 및 업로드 준비 상태"><span class="status-light${loggedIn ? ' is-ready' : ' is-waiting'}"></span><span class="status-sns-name"><strong>${item.label}</strong></span>${chip('로그인', loggedIn)}${chip('업로드 준비', uploadReady)}</a>`;
  }).join('');
}

function renderQuickPublish() {
  const target = $('#quickProviderBar');
  if (!target) return;
  target.innerHTML = loginProviders.map((item) => {
    const linked = state.accounts.filter((account) => account.provider === item.key && account.status === 'connected');
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
  const accounts = state.accounts.filter((account) => account.provider === providerKey && account.status === 'connected');
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
  $('#accountGrid').innerHTML = state.accounts.map((account) => {
    const provider = providerFor(account.provider); const checkedCount = (account.slotNumbers || []).filter((slot) => videoForSlot(slot)).length;
    const routedVideos = (account.slotNumbers || []).map((slot) => ({ slot, video: videoForSlot(slot) })).filter(({ video }) => video).sort((a, b) => a.slot - b.slot);
    const videoPreviews = routedVideos.length ? `<div class="account-video-preview-list" aria-label="${provider.label} 연결 영상 미리보기">${routedVideos.map(({ slot, video }) => `<button class="account-video-preview" data-select-slot="${slot}" type="button" title="${slot}번 영상 ${escapeHtml(video.originalName)}"><img src="${escapeHtml(video.thumbnailUrl)}" alt="${slot}번 ${escapeHtml(video.originalName)} 썸네일"><span>${String(slot).padStart(2, '0')}</span></button>`).join('')}</div>` : '<div class="account-video-empty">선택된 영상 없음</div>';
    const switches = Array.from({ length: 10 }, (_, index) => { const slot = index + 1; const hasVideo = Boolean(videoForSlot(slot)); const checked = (account.slotNumbers || []).includes(slot); return `<label class="slot-switch${hasVideo ? '' : ' is-disabled'}" title="${hasVideo ? `${slot}번 영상을 ${provider.label}에 연결` : `${slot}번 슬롯이 비어 있습니다`}"><input type="checkbox" data-account-slot="${escapeHtml(account.id)}" data-slot-number="${slot}" ${checked ? 'checked' : ''} ${hasVideo ? '' : 'disabled'}><span>${slot}</span></label>`; }).join('');
    const canUpload = account.status === 'connected' && routedVideos.length > 0;
    const uploadTitle = account.status !== 'connected' ? '먼저 이 계정에 로그인해 주세요' : routedVideos.length ? `${routedVideos.length}개 영상을 즉시 업로드` : '계정에 업로드할 영상을 먼저 선택해 주세요';
    return `<article class="account-card provider-${account.provider}"><div class="account-head"><span class="provider-code">${provider.code}</span><div><strong>${escapeHtml(account.displayName)}</strong><small>${provider.label} · ${escapeHtml(account.handle)}</small></div><span class="connected-dot">●</span><button class="account-upload-button" data-upload-account="${escapeHtml(account.id)}" type="button" ${canUpload ? '' : 'disabled'} title="${uploadTitle}">동영상 올리기</button></div><div class="account-route-label"><span>게시할 번호</span><b>${checkedCount}개</b></div>${videoPreviews}<div class="slot-switches">${switches}</div><div class="account-footer"><span>${account.mode === 'sandbox' ? 'SANDBOX ADAPTER' : 'OAUTH CONNECTED'}</span><button class="text-button" data-remove-account="${escapeHtml(account.id)}" type="button">연결 해제</button></div></article>`;
  }).join('');
  renderRouteSummary();
}

function renderLoginPages() {
  const target = $('#loginPageGrid');
  if (!target) return;
  target.innerHTML = loginProviders.map((item, index) => {
    const linked = state.accounts.filter((account) => account.provider === item.key);
    const prerequisite = item.requiresProvider ? providerFor(item.requiresProvider) : null;
    const prerequisiteReady = hasLoginPrerequisite(item.key);
    const prerequisiteNotice = prerequisite ? `<div class="login-prerequisite${prerequisiteReady ? ' is-ready' : ' is-blocked'}"><span class="login-prerequisite-light"></span><span>${prerequisite.label} 로그인 ${prerequisiteReady ? '완료' : '필요'}</span>${prerequisiteReady ? '' : `<a href="#login-${item.requiresProvider}" data-scroll-target="#login-${item.requiresProvider}">${prerequisite.label} 로그인으로 이동</a>`}</div>` : '';
    const accounts = linked.length ? linked.map((account) => `<div class="login-account"><span class="login-account-dot"></span><div><strong>${escapeHtml(account.displayName)}</strong><small>${escapeHtml(account.handle)}</small></div><span class="login-account-state">CONNECTED</span></div>`).join('') : '<div class="login-empty">아직 연결된 계정이 없습니다.</div>';
    return `<article class="login-page login-${item.key}" id="login-${item.key}"><div class="login-page-head"><span class="login-brand login-brand-${item.accent}">${item.code}</span><div><span class="eyebrow">${item.service}</span><h3>${item.label} 로그인</h3></div><span class="login-page-index">${String(index + 1).padStart(2, '0')}</span></div><div class="login-copy"><strong>${item.title}</strong><p>${item.description}</p><span class="login-scopes">${item.scopes}</span></div>${prerequisiteNotice}<div class="login-connected"><div class="login-connected-label"><span>연결 상태</span><b>${linked.length ? `${linked.length}개 연결됨` : '연결 대기'}</b></div>${accounts}</div><button class="button login-button login-button-${item.accent}${prerequisite && !prerequisiteReady ? ' is-blocked' : ''}" data-login-provider="${item.key}" type="button">${prerequisite && !prerequisiteReady ? `${prerequisite.label} 로그인 필요` : linked.length ? '다른 계정 연결' : `${item.label} 로그인 시작`} <span>→</span></button><div class="login-page-footer"><span>OAuth callback seam</span><span>${linked.length ? 'SANDBOX CONNECTED' : prerequisite && !prerequisiteReady ? 'FACEBOOK AUTH REQUIRED' : 'READY TO CONNECT'}</span></div></article>`;
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
function renderAll() { syncQuickProviders(); renderStats(); renderSlots(); renderAccounts(); renderLoginPages(); renderSidebarStatus(); renderQuickPublish(); renderCampaigns(); renderCalendar(); renderAnalytics(); renderComments(); renderLogs(); renderSettings(); $('#lastUpdated').textContent = `마지막 동기화 ${formatDate(new Date(), { hour: '2-digit', minute: '2-digit' })}`; }
function filterWorkspace(query) {
  const normalized = String(query || '').trim().toLowerCase();
  ['.slot-card', '.account-card', '.campaign-card', '.login-page', '.comment-card'].forEach((selector) => {
    $$(selector).forEach((item) => item.classList.toggle('is-search-hidden', Boolean(normalized && !item.textContent.toLowerCase().includes(normalized))));
  });
}

async function loadData() {
  try {
    const [videos, accounts, campaigns, analytics, comments, logs, settings] = await Promise.all([api('/api/videos'), api('/api/accounts'), api('/api/campaigns'), api('/api/analytics'), api('/api/comments'), api('/api/logs?limit=80'), api('/api/settings')]);
    state.videos = videos.videos || [];
    state.accounts = (accounts.accounts || []).filter((account) => supportedProviderKeys.has(account.provider));
    state.campaigns = (campaigns.campaigns || []).map((campaign) => ({ ...campaign, jobs: (campaign.jobs || []).filter((job) => supportedProviderKeys.has(job.provider)) })).filter((campaign) => campaign.jobs.length > 0);
    state.analytics = { ...analytics, jobs: (analytics.jobs || []).filter((job) => supportedProviderKeys.has(job.provider)) };
    state.comments = (comments.comments || []).filter((comment) => supportedProviderKeys.has(comment.provider));
    state.logs = logs.logs || []; state.settings = settings.settings || {};
    state.quickProviders = new Set();
    if (!state.campaignsLoaded) { state.campaigns.flatMap((campaign) => campaign.jobs || []).filter((job) => job.status === 'published').forEach((job) => state.announcedJobs.add(job.id)); state.campaignsLoaded = true; }
    state.selectedSlot = state.videos.find((video) => video.slotNumber)?.slotNumber || 1; renderAll(); const source = videoForSlot(state.selectedSlot); if (source && !$('#campaignTitle').value) fillMetadata(source);
  } catch (error) { showToast(error.message || '프로그램 데이터를 불러오지 못했습니다.', true); }
}

function fillMetadata(video) {
  if (!video) return;
  const meta = video.aiMetadata || {};
  const fallbackTitle = String(video.originalName || `영상 ${video.slotNumber || ''}`).replace(/\.[^.]+$/, '').trim();
  if (!$('#campaignTitle').value.trim()) $('#campaignTitle').value = meta.title || fallbackTitle || '새 동영상';
  if (!$('#campaignDescription').value.trim()) $('#campaignDescription').value = meta.description || `${$('#campaignTitle').value.trim()} 업로드 설명`;
  if (!$('#campaignHashtags').value.trim()) $('#campaignHashtags').value = (meta.hashtags || ['#동영상', '#콘텐츠']).join(' ');
}
async function generateAi() { const video = videoForSlot(state.selectedSlot); if (!video) return showToast('먼저 영상을 선택해 주세요.', true); try { const result = await api('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: video.id }) }); fillMetadata({ aiMetadata: result.metadata }); showToast(result.metadata.source === 'openai' ? 'OpenAI 초안을 적용했습니다.' : '로컬 fallback 초안을 적용했습니다.'); } catch (error) { showToast(error.message, true); } }

function validateFile(file) { const extension = file.name.split('.').pop().toLowerCase(); if (!allowedExtensions.has(extension)) return 'MP4, MOV, WebM, MKV 파일만 올릴 수 있습니다.'; if (file.size > maxFileSize) return '파일 크기는 2 GB 이하여야 합니다.'; if (!file.size) return '빈 파일은 업로드할 수 없습니다.'; return null; }
function firstFreeSlot() { return Array.from({ length: 10 }, (_, index) => index + 1).find((slot) => !videoForSlot(slot)); }
function uploadFile(file, slotNumber) {
  const validation = validateFile(file); if (validation) return showToast(`${file.name}: ${validation}`, true); const existing = videoForSlot(slotNumber); const queueId = `${Date.now()}-${Math.random()}`; state.queue.set(queueId, { file, slotNumber, progress: 0, status: 'uploading' }); renderQueue();
  const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/videos'); xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name)); xhr.setRequestHeader('X-File-Type', file.type || 'video/mp4'); xhr.setRequestHeader('X-File-Size', String(file.size)); xhr.setRequestHeader('X-Slot-Number', String(slotNumber)); xhr.setRequestHeader('X-Replace', String(Boolean(existing)));
  xhr.upload.addEventListener('progress', (event) => { const item = state.queue.get(queueId); if (item && event.lengthComputable) { item.progress = Math.round((event.loaded / event.total) * 100); renderQueue(); } });
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
async function toggleRoute(input) { const account = state.accounts.find((item) => item.id === input.dataset.accountSlot); const slot = Number(input.dataset.slotNumber); if (!account) return; const previous = [...(account.slotNumbers || [])]; account.slotNumbers = input.checked ? [...new Set([...previous, slot])].sort((a, b) => a - b) : previous.filter((item) => item !== slot); renderAccounts(); try { const result = await api(`/api/accounts/${encodeURIComponent(account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: account.slotNumbers }) }); Object.assign(account, result.account); renderAll(); } catch (error) { account.slotNumbers = previous; renderAll(); showToast(error.message, true); } }

async function saveAccount(event) { event.preventDefault(); try { const result = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: $('#accountProvider').value, displayName: $('#accountDisplayName').value, handle: $('#accountHandle').value }) }); state.accounts.unshift(result.account); const quickProvider = state.pendingQuickProvider; state.pendingQuickProvider = ''; if (quickProvider === result.account.provider && videoForSlot(state.selectedSlot)) { state.quickProviders.add(quickProvider); result.account.slotNumbers = [state.selectedSlot]; try { const routed = await api(`/api/accounts/${encodeURIComponent(result.account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: result.account.slotNumbers }) }); Object.assign(result.account, routed.account); } catch {} } closeAccountModal(); renderAll(); document.querySelector(`#login-${result.account.provider}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); showToast(`${providerFor(result.account.provider).label} 계정을 연결했습니다.`); } catch (error) { showToast(error.message, true); } }
async function removeAccount(id) { const account = state.accounts.find((item) => item.id === id); if (!account || !window.confirm(`${account.handle} 연결을 해제할까요?`)) return; try { await api(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.accounts = state.accounts.filter((item) => item.id !== id); renderAll(); showToast('계정 연결을 해제했습니다.'); } catch (error) { showToast(error.message, true); } }
function openAccountModal(providerKey = 'instagram') { const provider = providerFor(providerKey); $('#accountProvider').value = providerKey; $('#accountModalEyebrow').textContent = `${provider.code} / OAUTH LOGIN`; $('#accountModalTitle').textContent = `${provider.label} 로그인`; $('#accountModalDescription').textContent = `${provider.label} OAuth 연결을 시작합니다. sandbox에서는 계정 식별자만 저장하며 비밀번호는 저장하지 않습니다.`; $('#accountModal').hidden = false; $('#accountDisplayName').value = ''; $('#accountHandle').value = ''; $('#accountDisplayName').focus(); }
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
  openAccountModalBase(providerKey);
  $('#accountModalDescription').textContent = `${providerFor(providerKey).label} OAuth 연결을 시작합니다. 비밀번호는 서버에 저장하지 않고 이 PC의 암호화 저장소에만 기억합니다.`;
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
  try {
    const result = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, displayName, handle }) });
    if (window.desktopWindow?.saveCredentials) {
      try { await window.desktopWindow.saveCredentials({ provider, displayName, handle, password, remember }); } catch {}
    }
    state.accounts.unshift(result.account);
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
    showToast(`${providerFor(result.account.provider).label} 로그인 완료 · ${uploadReady ? '업로드 준비 완료' : '영상을 추가하면 업로드 준비'}${remember ? ' · 로그인 정보 기억됨' : ''}`);
  } catch (error) { showToast(error.message, true); }
}

async function createCampaign(event) { event.preventDefault(); const routes = selectedRoutes(); if (!routes.length) return showToast('먼저 올릴 SNS를 클릭해 활성화하고 영상 번호를 선택해 주세요.', true); const schedule = $('#scheduleDate').value; if (!schedule) return showToast('예약 시각을 선택해 주세요.', true); try { const hashtags = $('#campaignHashtags').value.split(/\s+/).map((value) => value.trim()).filter(Boolean); const result = await api('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('#campaignTitle').value, description: $('#campaignDescription').value, hashtags, scheduledAt: schedule, privacy: $('#privacySelect').value, routes }) }); state.campaigns.unshift(result.campaign); $('#campaignForm').reset(); const next = new Date(Date.now() + 3600000); next.setSeconds(0, 0); $('#scheduleDate').value = localInputValue(next); renderAll(); showToast(`${result.campaign.jobs.length}개 번호 경로를 예약했습니다.`); if (result.skippedRoutes?.length) showToast(`${result.skippedRoutes.length}개 중복 경로는 건너뛰었습니다.`, true); } catch (error) { showToast(error.message, true); } }
async function runCampaign(id) { try { const result = await api(`/api/campaigns/${encodeURIComponent(id)}/run`, { method: 'POST' }); const index = state.campaigns.findIndex((campaign) => campaign.id === id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('작업을 sandbox에서 실행했습니다.'); announcePublishedJobs(result.campaign); } catch (error) { showToast(error.message, true); } }
async function retryJob(id) { try { const result = await api(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }); const index = state.campaigns.findIndex((campaign) => campaign.id === result.campaign.id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('작업을 재시도했습니다.'); announcePublishedJobs(result.campaign); } catch (error) { showToast(error.message, true); } }
async function cancelCampaign(id) { if (!window.confirm('예약 작업을 취소할까요? 아직 게시되지 않은 번호 경로만 취소됩니다.')) return; try { const result = await api(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }); const index = state.campaigns.findIndex((campaign) => campaign.id === id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('예약 작업을 취소했습니다.'); } catch (error) { showToast(error.message, true); } }

async function loadInsights() { const [analytics, comments, logs] = await Promise.all([api('/api/analytics'), api('/api/comments'), api('/api/logs?limit=80')]); state.analytics = analytics; state.comments = comments.comments || []; state.logs = logs.logs || []; }
async function refreshAnalytics() { try { await api('/api/analytics/refresh', { method: 'POST' }); await loadInsights(); renderAll(); showToast('게시 통계를 갱신했습니다.'); } catch (error) { showToast(error.message, true); } }
async function replyComment(id) { const text = window.prompt('댓글에 답글을 입력하세요.'); if (!text?.trim()) return; try { await api(`/api/comments/${encodeURIComponent(id)}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); await loadInsights(); renderAll(); showToast('댓글에 답글을 남겼습니다.'); } catch (error) { showToast(error.message, true); } }
async function toggleComment(id, action) { try { await api(`/api/comments/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); await loadInsights(); renderAll(); showToast(action === 'hide' ? '댓글을 숨겼습니다.' : '댓글을 다시 표시했습니다.'); } catch (error) { showToast(error.message, true); } }
async function saveSetting(key, value) { try { const result = await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) }); state.settings = result.settings; if (['launchAtStartup', 'startMinimized'].includes(key) && window.desktopWindow?.setStartup) await window.desktopWindow.setStartup(Boolean(state.settings.launchAtStartup), Boolean(state.settings.startMinimized)); renderSettings(); showToast('설정을 저장했습니다.'); } catch (error) { showToast(error.message, true); renderSettings(); } }
async function checkUpdates() { $('#updateStatus').textContent = '업데이트 채널 확인 중…'; try { const result = window.desktopWindow?.checkForUpdates ? await window.desktopWindow.checkForUpdates() : { status: 'browser-sandbox' }; $('#updateStatus').textContent = result?.status === 'checked' ? '최신 업데이트를 확인했습니다.' : '브라우저 sandbox에서는 업데이트 확인만 표시됩니다.'; } catch { $('#updateStatus').textContent = '업데이트 확인을 완료하지 못했습니다.'; } }

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, a'); if (!target) return;
  if (target.dataset.uploadSlot) startFilePicker(target.dataset.uploadSlot);
  if (target.dataset.selectSlot) { state.selectedSlot = Number(target.dataset.selectSlot); const video = videoForSlot(state.selectedSlot); if (video && !$('#campaignTitle').value) fillMetadata(video); renderAll(); }
  if (target.dataset.deleteVideo) deleteVideo(target.dataset.deleteVideo);
  if (target.dataset.quickProvider && requireLoginPrerequisite(target.dataset.quickProvider)) activateQuickProvider(target.dataset.quickProvider);
  if (target.dataset.quickSlotProvider && requireLoginPrerequisite(target.dataset.quickSlotProvider)) toggleQuickProviderSlot(target.dataset.quickSlotProvider, target.dataset.slotNumber);
  if (target.dataset.loginProvider && requireLoginPrerequisite(target.dataset.loginProvider)) openAccountModal(target.dataset.loginProvider);
  if (target.dataset.openAccount || target.id === 'openAccountButton') openAccountModal();
  if (target.dataset.uploadAccount) uploadAccountVideos(target.dataset.uploadAccount);
  if (target.dataset.removeAccount) removeAccount(target.dataset.removeAccount);
  if (target.dataset.runCampaign) runCampaign(target.dataset.runCampaign);
  if (target.dataset.retryJob) retryJob(target.dataset.retryJob);
  if (target.dataset.cancelCampaign) cancelCampaign(target.dataset.cancelCampaign);
  if (target.dataset.replyComment) replyComment(target.dataset.replyComment);
  if (target.dataset.toggleComment) toggleComment(target.dataset.toggleComment, target.dataset.commentAction);
  if (target.dataset.scrollTarget) document.querySelector(target.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth' });
  if (target.dataset.windowAction && window.desktopWindow?.[target.dataset.windowAction]) window.desktopWindow[target.dataset.windowAction]();
});
document.addEventListener('change', (event) => { if (event.target.matches('[data-account-slot]')) toggleRoute(event.target); if (['launchAtStartup', 'startMinimized', 'autoUpdate'].includes(event.target.id)) saveSetting(event.target.id, event.target.checked); });
document.addEventListener('input', (event) => { if (event.target.id === 'workspaceSearch') filterWorkspace(event.target.value); });
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#workspaceSearch')?.focus(); } });
$('#chooseButton').addEventListener('click', (event) => { event.stopPropagation(); startFilePicker('auto'); });
$('#dropZone').addEventListener('click', (event) => { if (!event.target.closest('button')) startFilePicker('auto'); });
$('#dropZone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startFilePicker('auto'); } });
['dragenter', 'dragover'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.add('is-dragging'); }));
['dragleave', 'drop'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.remove('is-dragging'); }));
$('#dropZone').addEventListener('drop', (event) => handleSelectedFiles([...event.dataTransfer.files]));
$('#fileInput').addEventListener('change', () => handleSelectedFiles([...$('#fileInput').files]));
$('#campaignForm').addEventListener('submit', createCampaign); $('#generateAiButton').addEventListener('click', generateAi);
$('#openAccountButton').addEventListener('click', openAccountModal); $('#accountForm').addEventListener('submit', saveAccountWithCredentials); $('#accountProvider').addEventListener('change', () => fillRememberedCredentials($('#accountProvider').value)); $('#closeAccountModal').addEventListener('click', closeAccountModal); $('#cancelAccountModal').addEventListener('click', closeAccountModal); $('#accountModal').addEventListener('click', (event) => { if (event.target.id === 'accountModal') closeAccountModal(); });
$('#prevMonth').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); }); $('#nextMonth').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); }); $('#refreshAnalytics').addEventListener('click', refreshAnalytics); $('#refreshCampaigns').addEventListener('click', loadData); $('#refreshLogs').addEventListener('click', async () => { await loadInsights(); renderAll(); }); $('#checkUpdates').addEventListener('click', checkUpdates);
const initialSchedule = new Date(Date.now() + 3600000); initialSchedule.setSeconds(0, 0); $('#scheduleDate').value = localInputValue(initialSchedule); const loginSecurityCopy = document.querySelector('.login-security-strip strong'); const loginSecurityNote = document.querySelector('.login-security-strip p'); if (loginSecurityCopy) loginSecurityCopy.textContent = '비밀번호는 암호화 저장소에만 보관됩니다.'; if (loginSecurityNote) loginSecurityNote.textContent = '현재는 sandbox 연결이며 비밀번호는 서버로 보내지지 않습니다. Electron에서는 운영체제 암호화 저장소에만 기억합니다.'; loadData();
function applyVideoProfileCopy() {
  const hint = document.querySelector('#dropZone > div:nth-child(2) span');
  if (hint) hint.textContent = `9:16 세로형 · ${VIDEO_PROFILE.width}×${VIDEO_PROFILE.height} 권장 · 최대 ${VIDEO_PROFILE.durationSeconds}초 · 예상 용량 약 ${formatBytes(estimatedProfileBytes)}`;
}

function replaceVoiceNoticeWithImage() {
  document.querySelectorAll('.quick-voice-note').forEach((target) => {
    target.replaceChildren();
    const image = document.createElement('img');
    image.src = '/assets/upload-complete.svg';
    image.alt = '업로드 완료 음성 안내';
    image.title = '업로드 완료 음성 안내';
    target.append(image);
  });
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
replaceVoiceNoticeWithImage();
decorateSlotSwitches();

async function pollCampaigns() { if (!state.campaignsLoaded) return; try { const payload = await api('/api/campaigns'); state.campaigns = payload.campaigns || []; state.campaigns.forEach(announcePublishedJobs); renderStats(); renderCampaigns(); renderCalendar(); } catch {} }
window.setInterval(pollCampaigns, 15000);
