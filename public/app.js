const state = {
  videos: [],
  queue: new Map(),
  accounts: [],
  campaigns: [],
  selectedVideoId: '',
  selectedAccounts: new Set(),
  youtubeChecklist: {},
  search: '',
  sortNewest: true,
  activeProvider: ''
};

const allowedExtensions = new Set(['mp4', 'mov', 'webm', 'mkv']);
const maxFileSize = 2 * 1024 * 1024 * 1024;
const $ = (selector) => document.querySelector(selector);

const providers = [
  { key: 'youtube', label: 'YouTube', code: 'YT', description: '영상 · 쇼츠 예약' },
  { key: 'naver', label: '네이버', code: 'NV', description: '클립 · 블로그 영상' },
  { key: 'tiktok', label: 'TikTok', code: 'TT', description: '숏폼 동시 업로드' },
  { key: 'facebook', label: 'Facebook', code: 'FB', description: '페이지 · 그룹 공유' },
  { key: 'instagram', label: 'Instagram', code: 'IG', description: '릴스 · 피드 예약' }
];

const youtubeChecks = [
  { key: 'title', label: '제목 입력 완료', manual: false },
  { key: 'description', label: '설명 입력 완료', manual: false },
  { key: 'category', label: '카테고리 선택', manual: false },
  { key: 'privacy', label: '공개 범위 선택', manual: false },
  { key: 'tags', label: '태그·해시태그 확인', manual: false },
  { key: 'thumbnail', label: '썸네일 확인', manual: true },
  { key: 'madeForKids', label: '아동용 콘텐츠 여부', manual: true },
  { key: 'playlist', label: '재생목록 선택', manual: true }
];

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value, options = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) {
  return new Intl.DateTimeFormat('ko-KR', options).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function providerFor(key) {
  return providers.find((provider) => provider.key === key) || providers[0];
}

function selectedVideo() {
  return state.videos.find((video) => video.id === state.selectedVideoId) || state.videos[0];
}

function renderStats() {
  const stats = { videos: state.videos.length, accounts: state.accounts.length, campaigns: state.campaigns.length };
  $('#statVideoCount').textContent = stats.videos;
  $('#statAccountCount').textContent = stats.accounts;
  $('#statCampaignCount').textContent = stats.campaigns;
  $('#navVideoCount').textContent = stats.videos;
  $('#navAccountCount').textContent = stats.accounts;
  $('#navCampaignCount').textContent = stats.campaigns;
}

function renderLibrary() {
  const filtered = state.videos.filter((video) => video.originalName.toLowerCase().includes(state.search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => state.sortNewest ? new Date(b.createdAt) - new Date(a.createdAt) : new Date(a.createdAt) - new Date(b.createdAt));
  $('#videoCount').textContent = state.videos.length;
  $('#emptyState').hidden = sorted.length > 0;
  $('#videoTable').hidden = sorted.length === 0;
  $('#videoTable').innerHTML = sorted.map((video) => `<div class="video-row"><div class="video-thumb" aria-hidden="true"></div><div><div class="video-name" title="${escapeHtml(video.originalName)}">${escapeHtml(video.originalName)}</div><div class="video-meta">${escapeHtml(video.mimeType.replace('video/', '').toUpperCase())}</div></div><div class="video-size">${escapeHtml(video.sizeLabel || formatBytes(video.size))}</div><div><span class="status-tag">업로드 완료</span><div class="video-date">${formatDate(video.createdAt)}</div></div><button class="delete-button" data-delete-id="${escapeHtml(video.id)}" aria-label="${escapeHtml(video.originalName)} 삭제">×</button></div>`).join('');
  const usedBytes = state.videos.reduce((total, video) => total + video.size, 0);
  const percent = Math.min((usedBytes / (10 * 1024 ** 3)) * 100, 100);
  $('#storagePercent').textContent = `${Math.round(percent)}%`;
  $('#storageBar').style.width = `${percent}%`;
  $('#storageLabel').textContent = `${formatBytes(usedBytes)} / 10 GB 사용 중`;
  $('#lastUpdated').textContent = `마지막 동기화 ${formatDate(new Date(), { hour: '2-digit', minute: '2-digit' })}`;
  const source = selectedVideo();
  const preview = document.querySelector('.file-preview');
  if (source) {
    preview.classList.add('has-preview');
    preview.style.background = 'linear-gradient(135deg, #2d385f, #d66359)';
    preview.innerHTML = `<span class="preview-grid">▶</span><small>${escapeHtml(source.originalName)}</small>`;
  } else {
    preview.classList.remove('has-preview');
    preview.style.background = '';
    preview.innerHTML = '<span class="preview-grid">▦</span><small>NO SOURCE SELECTED</small>';
  }
  $('#mapSourceName').textContent = source ? source.originalName : '동영상을 선택하세요';
  $('#mapSummary').textContent = `영상 ${state.videos.length}개 · 계정 ${state.selectedAccounts.size}개`;
}

function renderQueue() {
  const items = [...state.queue.values()];
  $('#queueSection').hidden = items.length === 0;
  $('#queueCount').textContent = items.length;
  $('#queueList').innerHTML = items.map((item) => `<div class="queue-item"><div class="queue-thumb" aria-hidden="true"></div><div><div class="queue-name">${escapeHtml(item.file.name)}</div><div class="progress-track"><span style="width:${item.progress}%"></span></div></div><span class="queue-status">${item.status === 'error' ? '실패' : `${item.progress}%`}</span></div>`).join('');
}

function renderAccounts() {
  $('#accountGrid').innerHTML = providers.map((provider) => {
    const linked = state.accounts.filter((account) => account.provider === provider.key);
    if (!linked.length) return `<article class="account-card"><div class="provider-logo">${provider.code}</div><h3>${provider.label}</h3><p>${provider.description}</p><button class="account-action" data-connect-provider="${provider.key}" type="button">연결하기 +</button></article>`;
    const primary = linked[0];
    const extra = linked.length > 1 ? ` 외 ${linked.length - 1}개` : '';
    return `<article class="account-card is-connected"><div class="provider-logo">${provider.code}</div><h3>${provider.label}<span class="connected-mark"> ●</span></h3><p>${escapeHtml(primary.handle)}${extra}</p><button class="account-action remove" data-remove-account="${primary.id}" type="button">연결 해제</button></article>`;
  }).join('');
  renderTargetAccounts();
  renderNetwork();
}

function renderTargetAccounts() {
  if (!state.accounts.length) {
    $('#targetAccountList').innerHTML = '<span class="no-targets">먼저 SNS 계정을 연결해 주세요.</span>';
    return;
  }
  $('#targetAccountList').innerHTML = state.accounts.map((account) => {
    const provider = providerFor(account.provider);
    const checked = state.selectedAccounts.has(account.id) ? 'checked' : '';
    return `<label class="target-chip"><input type="checkbox" data-target-account="${account.id}" ${checked}><span>${provider.code}</span>${escapeHtml(account.handle)}</label>`;
  }).join('');
}

function renderNetwork() {
  const targets = state.accounts.filter((account) => state.selectedAccounts.has(account.id));
  const source = selectedVideo();
  $('#mapSourceName').textContent = source ? source.originalName : '동영상을 선택하세요';
  $('#mapSummary').textContent = `영상 ${state.videos.length}개 · 계정 ${targets.length}개`;
  $('#mapEmpty').hidden = Boolean(source && targets.length);
  $('#mapTargetNodes').innerHTML = targets.map((account) => {
    const provider = providerFor(account.provider);
    return `<div class="target-node" data-map-target="${account.id}"><span class="provider-dot">${provider.code}</span><span><b>${provider.label}</b><small>${escapeHtml(account.handle)}</small></span><span class="target-status">READY</span></div>`;
  }).join('');
  const svg = $('#networkLines');
  svg.innerHTML = '';
  if (!source || !targets.length) return;
  requestAnimationFrame(() => {
    const map = $('#connectionMap').getBoundingClientRect();
    const sourceRect = $('#mapSourceNode').getBoundingClientRect();
    targets.forEach((account) => {
      const target = document.querySelector(`[data-map-target="${CSS.escape(account.id)}"]`);
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', sourceRect.right - map.left);
      line.setAttribute('y1', sourceRect.top + sourceRect.height / 2 - map.top);
      line.setAttribute('x2', targetRect.left - map.left);
      line.setAttribute('y2', targetRect.top + targetRect.height / 2 - map.top);
      svg.appendChild(line);
    });
  });
}

function renderYoutubeChecklist() {
  const title = $('#campaignTitle').value.trim();
  const description = $('#campaignDescription').value.trim();
  const privacy = $('#privacySelect').value;
  const autoValues = {
    title: Boolean(title),
    description: Boolean(description),
    category: true,
    privacy: Boolean(privacy),
    tags: /(^|\s)#\S+/.test(description)
  };
  youtubeChecks.forEach((check) => {
    if (!check.manual) state.youtubeChecklist[check.key] = Boolean(autoValues[check.key]);
  });
  $('#youtubeChecklist').innerHTML = youtubeChecks.map((check) => `<label class="check-row${check.manual ? ' is-manual' : ''}"><input type="checkbox" data-youtube-check="${check.key}" ${state.youtubeChecklist[check.key] ? 'checked' : ''}>${check.label}${check.manual ? ' · 수동' : ' · 자동'}</label>`).join('');
  const automaticChecked = youtubeChecks.filter((check) => !check.manual && state.youtubeChecklist[check.key]).length;
  $('#youtubeAutoSummary').textContent = `자동 체크 ${automaticChecked}개 · 수동 ${youtubeChecks.filter((check) => check.manual).length}개`;
}

function renderCampaigns() {
  $('#campaignCount').textContent = state.campaigns.length;
  $('#campaignEmpty').hidden = state.campaigns.length > 0;
  $('#campaignList').innerHTML = state.campaigns.map((campaign) => `<div class="campaign-row"><div class="campaign-icon">⌁</div><div><div class="campaign-title">${escapeHtml(campaign.title)}</div><div class="campaign-meta">${escapeHtml(campaign.description || '설명 없음')}</div></div><div class="campaign-targets">${campaign.jobs.map((job) => `<span class="campaign-target">${providerFor(job.provider).code} ${escapeHtml(job.handle)}</span>`).join('')}</div><div class="campaign-schedule">${formatDate(campaign.scheduledAt, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}<br><span class="campaign-status">● ${campaign.status === 'scheduled' ? '전송 대기' : escapeHtml(campaign.status)}</span></div></div>`).join('');
}

function validateFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.has(extension)) return 'MP4, MOV, WebM, MKV 파일만 올릴 수 있습니다.';
  if (file.size > maxFileSize) return '파일 크기는 2 GB 이하여야 합니다.';
  if (file.size === 0) return '빈 파일은 업로드할 수 없습니다.';
  return null;
}

function uploadFile(file) {
  const error = validateFile(file);
  if (error) return showToast(`${file.name}: ${error}`, true);
  const id = `${Date.now()}-${Math.random()}`;
  state.queue.set(id, { file, progress: 0, status: 'uploading' });
  renderQueue();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/videos');
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
  xhr.setRequestHeader('X-File-Type', file.type || 'video/mp4');
  xhr.setRequestHeader('X-File-Size', String(file.size));
  xhr.upload.addEventListener('progress', (event) => { if (event.lengthComputable) { const item = state.queue.get(id); if (item) { item.progress = Math.round((event.loaded / event.total) * 100); renderQueue(); } } });
  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      state.queue.delete(id);
      const payload = JSON.parse(xhr.responseText);
      state.videos.unshift(payload.video);
      state.selectedVideoId = payload.video.id;
      renderQueue(); renderLibrary(); renderNetwork(); renderStats(); showToast(`${file.name} 업로드 완료`);
    } else {
      let message = '업로드에 실패했습니다.';
      try { message = JSON.parse(xhr.responseText).error.message; } catch {}
      const item = state.queue.get(id); if (item) { item.status = 'error'; item.progress = 0; renderQueue(); }
      showToast(message, true);
      setTimeout(() => { state.queue.delete(id); renderQueue(); }, 3500);
    }
  });
  xhr.addEventListener('error', () => { state.queue.delete(id); renderQueue(); showToast('서버에 연결할 수 없습니다.', true); });
  xhr.send(file);
}

async function loadData() {
  try {
    const [videosResponse, accountsResponse, campaignsResponse] = await Promise.all([fetch('/api/videos'), fetch('/api/accounts'), fetch('/api/campaigns')]);
    if (!videosResponse.ok || !accountsResponse.ok || !campaignsResponse.ok) throw new Error();
    state.videos = (await videosResponse.json()).videos;
    state.accounts = (await accountsResponse.json()).accounts;
    state.campaigns = (await campaignsResponse.json()).campaigns;
    state.selectedVideoId = state.videos[0]?.id || '';
    state.selectedAccounts = new Set(state.accounts.map((account) => account.id));
    renderStats(); renderLibrary(); renderAccounts(); renderCampaigns(); renderYoutubeChecklist();
  } catch { showToast('프로그램 데이터를 불러오지 못했습니다.', true); }
}

async function removeAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account || !window.confirm(`${account.handle} 연결을 해제할까요?`)) return;
  const response = await fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) return showToast('계정 연결을 해제하지 못했습니다.', true);
  state.accounts = state.accounts.filter((item) => item.id !== id);
  state.selectedAccounts.delete(id);
  renderAccounts(); renderStats(); showToast(`${account.handle} 연결 해제 완료`);
}

function openAccountModal(providerKey) {
  state.activeProvider = providerKey;
  const provider = providerFor(providerKey);
  $('#accountProvider').value = providerKey;
  $('#modalTitle').textContent = `${provider.label} 계정 연결`;
  $('#accountDisplayName').value = '';
  $('#accountHandle').value = '';
  $('#accountModal').hidden = false;
  $('#accountDisplayName').focus();
}

function closeAccountModal() { $('#accountModal').hidden = true; }

async function saveAccount(event) {
  event.preventDefault();
  const provider = $('#accountProvider').value;
  const response = await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, displayName: $('#accountDisplayName').value, handle: $('#accountHandle').value }) });
  if (!response.ok) { let message = '계정 연결에 실패했습니다.'; try { message = (await response.json()).error.message; } catch {} return showToast(message, true); }
  const payload = await response.json();
  state.accounts.unshift(payload.account);
  state.selectedAccounts.add(payload.account.id);
  closeAccountModal(); renderAccounts(); renderStats(); showToast(`${providerFor(provider).label} 계정 연결 완료`);
}

async function createCampaign(event) {
  event.preventDefault();
  const source = selectedVideo();
  const accountIds = [...state.selectedAccounts];
  if (!source) return showToast('먼저 업로드할 동영상을 선택해 주세요.', true);
  if (!accountIds.length) return showToast('업로드 대상 SNS 계정을 선택해 주세요.', true);
  const response = await fetch('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: source.id, title: $('#campaignTitle').value, description: $('#campaignDescription').value, scheduledAt: $('#scheduleDate').value, privacy: $('#privacySelect').value, accountIds, youtubeChecklist: state.youtubeChecklist }) });
  if (!response.ok) { let message = '예약 작업 생성에 실패했습니다.'; try { message = (await response.json()).error.message; } catch {} return showToast(message, true); }
  const payload = await response.json();
  state.campaigns.unshift(payload.campaign);
  renderCampaigns(); renderStats(); showToast(`${accountIds.length}개 계정에 동시 예약 등록 완료`);
  $('#campaignForm').reset();
  state.youtubeChecklist = {};
  renderYoutubeChecklist();
}

function setupDropZone() {
  const zone = $('#dropZone'); const input = $('#fileInput');
  $('#chooseButton').addEventListener('click', (event) => { event.stopPropagation(); input.click(); });
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { [...input.files].forEach(uploadFile); input.value = ''; });
  ['dragenter', 'dragover'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove('is-dragging'); }));
  zone.addEventListener('drop', (event) => [...event.dataTransfer.files].forEach(uploadFile));
}

document.addEventListener('click', (event) => {
  const deleteVideoButton = event.target.closest('[data-delete-id]');
  const connectButton = event.target.closest('[data-connect-provider]');
  const removeButton = event.target.closest('[data-remove-account]');
  const scrollButton = event.target.closest('[data-scroll-target]');
  const windowButton = event.target.closest('[data-window-action]');
  if (deleteVideoButton) deleteVideo(deleteVideoButton.dataset.deleteId);
  if (connectButton) openAccountModal(connectButton.dataset.connectProvider);
  if (removeButton) removeAccount(removeButton.dataset.removeAccount);
  if (scrollButton) document.querySelector(scrollButton.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth' });
  if (windowButton) {
    const action = windowButton.dataset.windowAction;
    if (window.desktopWindow?.[action]) window.desktopWindow[action]();
    else if (action === 'close') showToast('데스크톱 앱에서 닫기 버튼을 사용할 수 있습니다.');
  }
});

document.addEventListener('change', (event) => {
  const targetAccount = event.target.closest('[data-target-account]');
  const youtubeCheck = event.target.closest('[data-youtube-check]');
  if (targetAccount) { if (targetAccount.checked) state.selectedAccounts.add(targetAccount.dataset.targetAccount); else state.selectedAccounts.delete(targetAccount.dataset.targetAccount); renderNetwork(); }
  if (youtubeCheck) { state.youtubeChecklist[youtubeCheck.dataset.youtubeCheck] = youtubeCheck.checked; renderYoutubeChecklist(); }
});

$('#searchInput').addEventListener('input', (event) => { state.search = event.target.value; renderLibrary(); });
$('#filterButton').addEventListener('click', () => { state.sortNewest = !state.sortNewest; $('#filterButton').innerHTML = `${state.sortNewest ? '최신순' : '오래된순'} <span>⌄</span>`; renderLibrary(); });
$('#campaignTitle').addEventListener('input', renderYoutubeChecklist);
$('#campaignDescription').addEventListener('input', renderYoutubeChecklist);
$('#privacySelect').addEventListener('change', renderYoutubeChecklist);
$('#campaignForm').addEventListener('submit', createCampaign);
$('#accountForm').addEventListener('submit', saveAccount);
$('#openAccountButton').addEventListener('click', () => openAccountModal('youtube'));
$('#closeAccountModal').addEventListener('click', closeAccountModal);
$('#cancelAccountModal').addEventListener('click', closeAccountModal);
$('#accountModal').addEventListener('click', (event) => { if (event.target.id === 'accountModal') closeAccountModal(); });
window.addEventListener('resize', renderNetwork);

async function deleteVideo(id) {
  const video = state.videos.find((item) => item.id === id);
  if (!video || !window.confirm(`“${video.originalName}”을(를) 삭제할까요?`)) return;
  const response = await fetch(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) return showToast('삭제하지 못했습니다.', true);
  state.videos = state.videos.filter((item) => item.id !== id);
  if (state.selectedVideoId === id) state.selectedVideoId = state.videos[0]?.id || '';
  renderLibrary(); renderStats(); renderNetwork(); showToast('동영상을 삭제했습니다.');
}

setupDropZone();
loadData();
