(function attachAccountUploadState(global) {
  function getState() {
    return global.__uploadDeskState;
  }

  function routeSignature(account) {
    const videoForSlot = global.videoForSlot;
    return (account?.slotNumbers || [])
      .map((slotNumber) => ({ slotNumber, video: videoForSlot?.(slotNumber) }))
      .filter(({ video }) => video)
      .sort((a, b) => a.slotNumber - b.slotNumber)
      .map(({ slotNumber, video }) => `${slotNumber}:${video.id}`)
      .join('|');
  }

  function setPhase(accountId, phase) {
    const state = getState();
    const account = state?.accounts.find((item) => item.id === accountId);
    if (!account) return;
    state.accountUploadStates.set(accountId, { phase, signature: routeSignature(account), updatedAt: new Date().toISOString() });
    global.renderAccounts?.();
  }

  function persistedPhase(account, signature) {
    const state = getState();
    if (!signature || !state) return 'idle';
    const routeKeys = new Set(signature.split('|'));
    const campaign = state.campaigns.find((item) => {
      if (item.directUpload !== true) return false;
      const jobs = (item.jobs || []).filter((job) => job.accountId === account.id);
      return jobs.length === routeKeys.size && jobs.every((job) => routeKeys.has(`${job.slotNumber}:${job.videoId}`));
    });
    if (!campaign) return 'waiting';
    const jobs = (campaign.jobs || []).filter((job) => job.accountId === account.id);
    if (jobs.length > 0 && jobs.every((job) => ['published', 'completed'].includes(job.status))) return 'waiting';
    if (jobs.some((job) => ['uploading', 'retrying'].includes(job.status))) return 'uploading';
    if (jobs.some((job) => job.status === 'failed')) return 'failed';
    return 'waiting';
  }

  function phase(account) {
    const state = getState();
    if (!state) return 'idle';
    if (state.directUploads.has(account.id)) return 'uploading';
    const signature = routeSignature(account);
    const tracked = state.accountUploadStates.get(account.id);
    if (tracked?.signature === signature) return tracked.phase;
    return persistedPhase(account, signature);
  }

  global.accountRouteSignature = routeSignature;
  global.uploadedSlotsForAccount = function uploadedSlotsForAccount(accountId) {
    const state = getState();
    const slots = new Set();
    for (const campaign of state?.campaigns || []) {
      for (const job of campaign.jobs || []) {
        if (job.accountId !== accountId || !['published', 'completed'].includes(job.status)) continue;
        const slot = Number(job.slotNumber);
        if (Number.isInteger(slot) && slot > 0) slots.add(slot);
      }
    }
    return slots;
  };
  global.setAccountUploadPhase = setPhase;
  global.accountUploadPhase = phase;
})(window);
