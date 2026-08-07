const state = {
  videos: [], accounts: [], campaigns: [], analytics: { jobs: [], totals: {} }, comments: [], logs: [], settings: {},
  selectedSlot: 1, queue: new Map(), calendarMonth: new Date(), pendingUploadSlot: null
};

const providers = {
  youtube: { label: 'YouTube', code: 'YT' }, naver: { label: '네이버', code: 'NV' }, tiktok: { label: 'TikTok', code: 'TT' }, facebook: { label: 'Facebook', code: 'FB' }, instagram: { label: 'Instagram', code: 'IG' }
};
const youtubeChecks = [
  ['title', '제목 입력', false], ['description', '설명 입력', false], ['tags', '해시태그 확인', false], ['thumbnail', '썸네일 확인', true], ['madeForKids', '아동용 콘텐츠 여부', true]
];
const allowedExtensions = new Set(['mp4', 'mov', 'webm', 'mkv']);
const maxFileSize = 2 * 1024 * 1024 * 1024;
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

function selectedRoutes() { return state.accounts.flatMap((account) => (account.slotNumbers || []).filter((slot) => videoForSlot(slot)).map((slotNumber) => ({ accountId: account.id, slotNumber }))); }

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
    const switches = Array.from({ length: 10 }, (_, index) => { const slot = index + 1; const hasVideo = Boolean(videoForSlot(slot)); const checked = (account.slotNumbers || []).includes(slot); return `<label class="slot-switch${hasVideo ? '' : ' is-disabled'}" title="${hasVideo ? `${slot}번 영상을 ${provider.label}에 연결` : `${slot}번 슬롯이 비어 있습니다`}"><input type="checkbox" data-account-slot="${escapeHtml(account.id)}" data-slot-number="${slot}" ${checked ? 'checked' : ''} ${hasVideo ? '' : 'disabled'}><span>${slot}</span></label>`; }).join('');
    return `<article class="account-card"><div class="account-head"><span class="provider-code">${provider.code}</span><div><strong>${escapeHtml(account.displayName)}</strong><small>${provider.label} · ${escapeHtml(account.handle)}</small></div><span class="connected-dot">●</span></div><div class="account-route-label"><span>게시할 번호</span><b>${checkedCount}개</b></div><div class="slot-switches">${switches}</div><div class="account-footer"><span>${account.mode === 'sandbox' ? 'SANDBOX ADAPTER' : 'OAUTH CONNECTED'}</span><button class="text-button" data-remove-account="${escapeHtml(account.id)}" type="button">연결 해제</button></div></article>`;
  }).join('');
  renderRouteSummary();
}

function renderRouteSummary() {
  const routes = selectedRoutes(); $('#routeSummary').textContent = `${routes.length}개 경로 선택`;
  $('#routeChips').innerHTML = routes.length ? routes.map((route) => { const account = state.accounts.find((item) => item.id === route.accountId); const provider = providerFor(account?.provider); return `<span class="route-chip"><b>${String(route.slotNumber).padStart(2, '0')}</b>${provider.code} ${escapeHtml(account?.handle || '')}</span>`; }).join('') : '<span class="muted">계정별 번호 체크가 아직 없습니다.</span>';
  const grouped = state.accounts.flatMap((account) => (account.slotNumbers || []).filter((slot) => videoForSlot(slot)).map((slot) => ({ account, slot })));
  $('#selectedRouteList').innerHTML = grouped.length ? grouped.map(({ account, slot }) => `<div class="selected-route"><span>${String(slot).padStart(2, '0')}</span><strong>${providerFor(account.provider).code}</strong><small>${escapeHtml(account.handle)}</small></div>`).join('') : '<span class="muted">계정에서 번호를 체크하면 경로가 보입니다.</span>';
}

function renderYoutubeChecklist() {
  const title = $('#campaignTitle').value.trim(); const description = $('#campaignDescription').value.trim(); const hashtags = $('#campaignHashtags').value.trim();
  const automatic = { title: Boolean(title), description: Boolean(description), tags: /(^|\s)#\S+/.test(hashtags || description) };
  $('#youtubeSummary').textContent = `자동 확인 ${Object.values(automatic).filter(Boolean).length}/3 · 수동 ${youtubeChecks.filter((item) => item[2]).length}`;
  $('#youtubeChecklist').innerHTML = youtubeChecks.map(([key, label, manual]) => `<label class="check-row${manual ? ' manual' : ''}"><input type="checkbox" ${manual ? '' : automatic[key] ? 'checked' : ''} ${manual ? '' : 'disabled'}>${label}<small>${manual ? '수동' : automatic[key] ? '완료' : '필요'}</small></label>`).join('');
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
function renderAll() { renderStats(); renderSlots(); renderAccounts(); renderYoutubeChecklist(); renderCampaigns(); renderCalendar(); renderAnalytics(); renderComments(); renderLogs(); renderSettings(); $('#lastUpdated').textContent = `마지막 동기화 ${formatDate(new Date(), { hour: '2-digit', minute: '2-digit' })}`; }

async function loadData() {
  try {
    const [videos, accounts, campaigns, analytics, comments, logs, settings] = await Promise.all([api('/api/videos'), api('/api/accounts'), api('/api/campaigns'), api('/api/analytics'), api('/api/comments'), api('/api/logs?limit=80'), api('/api/settings')]);
    state.videos = videos.videos || []; state.accounts = accounts.accounts || []; state.campaigns = campaigns.campaigns || []; state.analytics = analytics; state.comments = comments.comments || []; state.logs = logs.logs || []; state.settings = settings.settings || {};
    state.selectedSlot = state.videos.find((video) => video.slotNumber)?.slotNumber || 1; renderAll(); const source = videoForSlot(state.selectedSlot); if (source && !$('#campaignTitle').value) fillMetadata(source);
  } catch (error) { showToast(error.message || '프로그램 데이터를 불러오지 못했습니다.', true); }
}

function fillMetadata(video) { const meta = video?.aiMetadata; if (!meta) return; $('#campaignTitle').value = meta.title || ''; $('#campaignDescription').value = meta.description || ''; $('#campaignHashtags').value = (meta.hashtags || []).join(' '); renderYoutubeChecklist(); }
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
function startFilePicker(slot) { state.pendingUploadSlot = slot === 'auto' ? (firstFreeSlot() || state.selectedSlot) : Number(slot); $('#fileInput').value = ''; $('#fileInput').click(); }
function handleSelectedFiles(files) { let slot = state.pendingUploadSlot || firstFreeSlot(); for (const file of files) { if (!slot) { showToast('10개 슬롯이 가득 찼습니다.', true); break; } uploadFile(file, slot); slot = firstFreeSlot(); } state.pendingUploadSlot = null; }

async function deleteVideo(id) { const video = state.videos.find((item) => item.id === id); if (!video || !window.confirm(`${video.slotNumber}번 슬롯 영상을 삭제할까요? 연결된 미게시 작업은 취소됩니다.`)) return; try { await api(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.videos = state.videos.filter((item) => item.id !== id); state.accounts.forEach((account) => { account.slotNumbers = (account.slotNumbers || []).filter((slot) => slot !== video.slotNumber); }); if (state.selectedSlot === video.slotNumber) state.selectedSlot = firstFreeSlot() || 1; renderAll(); showToast(`${video.slotNumber}번 슬롯을 비웠습니다.`); } catch (error) { showToast(error.message, true); } }
async function toggleRoute(input) { const account = state.accounts.find((item) => item.id === input.dataset.accountSlot); const slot = Number(input.dataset.slotNumber); if (!account) return; const previous = [...(account.slotNumbers || [])]; account.slotNumbers = input.checked ? [...new Set([...previous, slot])].sort((a, b) => a - b) : previous.filter((item) => item !== slot); renderAccounts(); try { const result = await api(`/api/accounts/${encodeURIComponent(account.id)}/routing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slotNumbers: account.slotNumbers }) }); Object.assign(account, result.account); renderAll(); } catch (error) { account.slotNumbers = previous; renderAll(); showToast(error.message, true); } }

async function saveAccount(event) { event.preventDefault(); try { const result = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: $('#accountProvider').value, displayName: $('#accountDisplayName').value, handle: $('#accountHandle').value }) }); state.accounts.unshift(result.account); closeAccountModal(); renderAll(); showToast(`${providerFor(result.account.provider).label} 계정을 연결했습니다.`); } catch (error) { showToast(error.message, true); } }
async function removeAccount(id) { const account = state.accounts.find((item) => item.id === id); if (!account || !window.confirm(`${account.handle} 연결을 해제할까요?`)) return; try { await api(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }); state.accounts = state.accounts.filter((item) => item.id !== id); renderAll(); showToast('계정 연결을 해제했습니다.'); } catch (error) { showToast(error.message, true); } }
function openAccountModal() { $('#accountModal').hidden = false; $('#accountDisplayName').value = ''; $('#accountHandle').value = ''; $('#accountDisplayName').focus(); }
function closeAccountModal() { $('#accountModal').hidden = true; }

async function createCampaign(event) { event.preventDefault(); const routes = selectedRoutes(); if (!routes.length) return showToast('계정별 번호를 한 개 이상 체크해 주세요.', true); const schedule = $('#scheduleDate').value; if (!schedule) return showToast('예약 시각을 선택해 주세요.', true); try { const hashtags = $('#campaignHashtags').value.split(/\s+/).map((value) => value.trim()).filter(Boolean); const result = await api('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('#campaignTitle').value, description: $('#campaignDescription').value, hashtags, scheduledAt: schedule, privacy: $('#privacySelect').value, routes }) }); state.campaigns.unshift(result.campaign); $('#campaignForm').reset(); const next = new Date(Date.now() + 3600000); next.setSeconds(0, 0); $('#scheduleDate').value = localInputValue(next); renderAll(); showToast(`${result.campaign.jobs.length}개 번호 경로를 예약했습니다.`); if (result.skippedRoutes?.length) showToast(`${result.skippedRoutes.length}개 중복 경로는 건너뛰었습니다.`, true); } catch (error) { showToast(error.message, true); } }
async function runCampaign(id) { try { const result = await api(`/api/campaigns/${encodeURIComponent(id)}/run`, { method: 'POST' }); const index = state.campaigns.findIndex((campaign) => campaign.id === id); if (index >= 0) state.campaigns[index] = result.campaign; await loadInsights(); renderAll(); showToast('작업을 sandbox에서 실행했습니다.'); } catch (error) { showToast(error.message, true); } }
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
  if (target.dataset.uploadSlot) startFilePicker(target.dataset.uploadSlot);
  if (target.dataset.selectSlot) { state.selectedSlot = Number(target.dataset.selectSlot); const video = videoForSlot(state.selectedSlot); if (video && !$('#campaignTitle').value) fillMetadata(video); renderAll(); }
  if (target.dataset.deleteVideo) deleteVideo(target.dataset.deleteVideo);
  if (target.dataset.openAccount || target.id === 'openAccountButton') openAccountModal();
  if (target.dataset.removeAccount) removeAccount(target.dataset.removeAccount);
  if (target.dataset.runCampaign) runCampaign(target.dataset.runCampaign);
  if (target.dataset.retryJob) retryJob(target.dataset.retryJob);
  if (target.dataset.cancelCampaign) cancelCampaign(target.dataset.cancelCampaign);
  if (target.dataset.replyComment) replyComment(target.dataset.replyComment);
  if (target.dataset.toggleComment) toggleComment(target.dataset.toggleComment, target.dataset.commentAction);
  if (target.dataset.scrollTarget) document.querySelector(target.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth' });
  if (target.dataset.windowAction && window.desktopWindow?.[target.dataset.windowAction]) window.desktopWindow[target.dataset.windowAction]();
});
document.addEventListener('change', (event) => { if (event.target.matches('[data-account-slot]')) toggleRoute(event.target); if (['#campaignTitle', '#campaignDescription', '#campaignHashtags'].includes(`#${event.target.id}`)) renderYoutubeChecklist(); if (['launchAtStartup', 'startMinimized', 'autoUpdate'].includes(event.target.id)) saveSetting(event.target.id, event.target.checked); });
$('#chooseButton').addEventListener('click', (event) => { event.stopPropagation(); startFilePicker('auto'); });
$('#dropZone').addEventListener('click', (event) => { if (!event.target.closest('button')) startFilePicker('auto'); });
$('#dropZone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startFilePicker('auto'); } });
['dragenter', 'dragover'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.add('is-dragging'); }));
['dragleave', 'drop'].forEach((name) => $('#dropZone').addEventListener(name, (event) => { event.preventDefault(); $('#dropZone').classList.remove('is-dragging'); }));
$('#dropZone').addEventListener('drop', (event) => handleSelectedFiles([...event.dataTransfer.files]));
$('#fileInput').addEventListener('change', () => handleSelectedFiles([...$('#fileInput').files]));
$('#campaignForm').addEventListener('submit', createCampaign); $('#generateAiButton').addEventListener('click', generateAi); $('#campaignTitle').addEventListener('input', renderYoutubeChecklist); $('#campaignDescription').addEventListener('input', renderYoutubeChecklist); $('#campaignHashtags').addEventListener('input', renderYoutubeChecklist);
$('#openAccountButton').addEventListener('click', openAccountModal); $('#accountForm').addEventListener('submit', saveAccount); $('#closeAccountModal').addEventListener('click', closeAccountModal); $('#cancelAccountModal').addEventListener('click', closeAccountModal); $('#accountModal').addEventListener('click', (event) => { if (event.target.id === 'accountModal') closeAccountModal(); });
$('#prevMonth').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1); renderCalendar(); }); $('#nextMonth').addEventListener('click', () => { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1); renderCalendar(); }); $('#refreshAnalytics').addEventListener('click', refreshAnalytics); $('#refreshCampaigns').addEventListener('click', loadData); $('#refreshLogs').addEventListener('click', async () => { await loadInsights(); renderAll(); }); $('#checkUpdates').addEventListener('click', checkUpdates);
const initialSchedule = new Date(Date.now() + 3600000); initialSchedule.setSeconds(0, 0); $('#scheduleDate').value = localInputValue(initialSchedule); loadData();
