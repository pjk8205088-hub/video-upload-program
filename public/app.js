const state = { videos: [], queue: new Map(), search: '', sortNewest: true };
const allowedExtensions = new Set(['mp4', 'mov', 'webm', 'mkv']);
const maxFileSize = 2 * 1024 * 1024 * 1024;
const $ = (selector) => document.querySelector(selector);

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
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
  $('#lastUpdated').textContent = `마지막 동기화 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
}

function renderQueue() {
  const items = [...state.queue.values()];
  $('#queueSection').hidden = items.length === 0;
  $('#queueCount').textContent = items.length;
  $('#queueList').innerHTML = items.map((item) => `<div class="queue-item"><div class="queue-thumb" aria-hidden="true"></div><div><div class="queue-name">${escapeHtml(item.file.name)}</div><div class="progress-track"><span style="width:${item.progress}%"></span></div></div><span class="queue-status">${item.status === 'error' ? '실패' : item.status === 'done' ? '완료' : `${item.progress}%`}</span></div>`).join('');
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
  xhr.addEventListener('load', async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      state.queue.delete(id);
      const payload = JSON.parse(xhr.responseText);
      state.videos.unshift(payload.video);
      renderQueue(); renderLibrary(); showToast(`${file.name} 업로드 완료`);
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

async function loadVideos() {
  try { const response = await fetch('/api/videos'); if (!response.ok) throw new Error(); state.videos = (await response.json()).videos; renderLibrary(); } catch { showToast('동영상 목록을 불러오지 못했습니다.', true); }
}

async function deleteVideo(id) {
  const video = state.videos.find((item) => item.id === id);
  if (!video || !window.confirm(`“${video.originalName}”을(를) 삭제할까요?`)) return;
  const response = await fetch(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) return showToast('삭제하지 못했습니다.', true);
  state.videos = state.videos.filter((item) => item.id !== id); renderLibrary(); showToast('동영상을 삭제했습니다.');
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

document.addEventListener('click', (event) => { const button = event.target.closest('[data-delete-id]'); if (button) deleteVideo(button.dataset.deleteId); });
$('#searchInput').addEventListener('input', (event) => { state.search = event.target.value; renderLibrary(); });
$('#filterButton').addEventListener('click', () => { state.sortNewest = !state.sortNewest; $('#filterButton').innerHTML = `${state.sortNewest ? '최신순' : '오래된순'} <span>⌄</span>`; renderLibrary(); });
setupDropZone();
loadVideos();
