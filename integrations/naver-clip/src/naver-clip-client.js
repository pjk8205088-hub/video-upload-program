import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const CREATOR_ORIGIN = "https://clipcreators.naver.com";
const CONTENTS_URL = `${CREATOR_ORIGIN}/web/contents/clips`;
const UPLOAD_URL = `${CREATOR_ORIGIN}/web/upload`;

export function normalizeCreatorText(value) {
  return String(value || "")
    .replace(/지원되지 않는 명령줄 플래그[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyUploadState({ url, bodyText, fileName, playable }) {
  const text = normalizeCreatorText(bodyText);
  const onDraftPage = /\/web\/draft\/\d+/i.test(String(url || ""));
  const hasFile = !fileName || text.includes(fileName) || text.includes(path.parse(fileName).name);
  const hasFailure = /(업로드|인코딩|동영상 처리)\s*(실패|오류)/.test(text);
  const isProcessing = /(인코딩 중|인코딩 진행 중|업로드 중)/.test(text);

  if (hasFailure) return "failed";
  if (onDraftPage && playable && !isProcessing && (hasFile || /등록|공개 설정|카테고리/.test(text))) return "ready";
  if (onDraftPage && hasFile) return "processing";
  return "waiting";
}

export function classifyRegistrationState({ url, bodyText, itemText, visibility = "current" }) {
  const pageText = normalizeCreatorText(bodyText);
  const publishedText = normalizeCreatorText(itemText);
  if (/등록|게시/.test(pageText) && /실패|오류/.test(pageText)) return "failed";
  if (publishedText) {
    if (visibility === "private" && /비공개/.test(publishedText)) return "private";
    if (visibility === "public" && !/비공개/.test(publishedText)) return "published";
    if (visibility === "current") return /비공개/.test(publishedText) ? "private" : "published";
  }
  return "uncertain";
}

export class LoginRequiredError extends Error {
  constructor(message = "브라우저에서 네이버 로그인이 필요합니다.") {
    super(message);
    this.name = "LoginRequiredError";
    this.code = "NAVER_LOGIN_REQUIRED";
  }
}

export class ClipProfileRequiredError extends Error {
  constructor(message = "네이버 클립 프로필 생성 또는 약관 동의가 필요합니다.") {
    super(message);
    this.name = "ClipProfileRequiredError";
    this.code = "NAVER_CLIP_PROFILE_REQUIRED";
  }
}

export class NaverClipPublishUncertainError extends Error {
  constructor(message = "네이버 클립 최종 등록 상태를 확인하지 못했습니다.") {
    super(message);
    this.name = "NaverClipPublishUncertainError";
    this.code = "PUBLISH_STATE_UNCERTAIN";
  }
}

export class NaverClipClient {
  constructor({
    userDataDir = path.resolve(process.cwd(), ".naver-clip-browser"),
    browserChannel = "chrome",
    headless = false,
    timeoutMs = 120_000,
    logger = console,
    initialCookies = []
  } = {}) {
    this.userDataDir = userDataDir;
    this.browserChannel = String(browserChannel || "chrome").toLowerCase();
    if (!["chrome", "msedge", "chromium"].includes(this.browserChannel)) throw new Error(`지원하지 않는 브라우저 채널입니다: ${browserChannel}`);
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.initialCookies = Array.isArray(initialCookies) ? initialCookies : [];
    this.context = null;
    this.page = null;
  }

  async start() {
    if (this.context) return this;

    const launchOptions = {
      headless: this.headless,
      chromiumSandbox: true,
      viewport: { width: 1440, height: 1000 }
    };
    if (this.browserChannel !== "chromium") launchOptions.channel = this.browserChannel;
    this.context = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
    if (this.initialCookies.length) await this.context.addCookies(this.initialCookies);
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.setDefaultTimeout(this.timeoutMs);
    return this;
  }

  async close() {
    await this.context?.close();
    this.context = null;
    this.page = null;
  }

  async isLoggedIn() {
    this.#assertStarted();
    await this.page.goto(CONTENTS_URL, { waitUntil: "domcontentloaded" });

    const currentUrl = this.page.url();
    if (/nid\.naver\.com|nidlogin/i.test(currentUrl)) return false;
    if (/clipcreators\.naver\.com\/join/i.test(currentUrl)) {
      throw new ClipProfileRequiredError();
    }

    return this.#hasCreatorUi();
  }

  async ensureLoggedIn({ waitForManualLogin = true, manualTimeoutMs = 300_000 } = {}) {
    if (await this.isLoggedIn()) return true;
    if (!waitForManualLogin) throw new LoginRequiredError();

    this.logger.info(
      "열린 브라우저에서 네이버에 직접 로그인해 주세요. 비밀번호나 인증번호는 이 코드가 입력하거나 저장하지 않습니다."
    );

    const deadline = Date.now() + manualTimeoutMs;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(1_000);
      const currentUrl = this.page.url();
      if (/clipcreators\.naver\.com\/join/i.test(currentUrl)) {
        throw new ClipProfileRequiredError();
      }
      if (/clipcreators\.naver\.com\/web\//i.test(currentUrl)) {
        if (await this.#hasCreatorUi()) return true;
      }
    }

    throw new LoginRequiredError("수동 로그인 대기 시간이 초과되었습니다.");
  }

  /**
   * @param {object} options
   * @param {Array<{filePath:string, caption?:string, title?:string, category?:string[], visibility?:'public'|'private'|'current'}>} options.videos
   * @param {boolean} [options.finalize=true] 등록까지 완료할지 여부
   */
  async uploadVideos({ videos, finalize = true } = {}) {
    this.#assertStarted();
    const normalized = this.#validateVideos(videos, finalize);
    await this.ensureLoggedIn();

    const results = [];
    for (const video of normalized) {
      await this.page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" });
      await this.#waitForUploadSurface();
      await this.#selectFiles([video.filePath]);
      const draftUrl = await this.#waitForUploadCompletion(video);

      if (!finalize) {
        results.push({ filePath: video.filePath, caption: video.caption, status: "draft", draftUrl });
        continue;
      }

      results.push(await this.#registerCurrentDraft(video, draftUrl));
    }
    return results;
  }

  async finalizeDraft({ draftUrl, video } = {}) {
    this.#assertStarted();
    if (!/^https:\/\/clipcreators\.naver\.com\/web\/draft\/\d+$/i.test(String(draftUrl || ""))) {
      throw new TypeError("올바른 네이버 클립 draftUrl을 전달하세요.");
    }

    const normalized = this.#validateVideos([video], true)[0];
    await this.ensureLoggedIn();
    await this.page.goto(draftUrl, { waitUntil: "domcontentloaded" });
    const readyDraftUrl = await this.#waitForUploadCompletion(normalized);
    return this.#registerCurrentDraft(normalized, readyDraftUrl);
  }

  async #selectFiles(filePaths) {
    const chooseButton = this.page.getByRole("button", { name: /파일 선택|동영상 선택|영상 선택/ }).first();
    if (await chooseButton.isVisible().catch(() => false)) {
      const [chooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        chooseButton.click()
      ]);
      await chooser.setFiles(filePaths);
      return;
    }

    const fileInput = this.page.locator('input[type="file"]').last();
    if (await fileInput.count()) {
      await fileInput.waitFor({ state: "attached", timeout: this.timeoutMs });
      await fileInput.setInputFiles(filePaths);
      return;
    }

    throw new Error("네이버 클립 동영상 선택 입력을 찾지 못했습니다. 업로드 페이지를 새로고침한 뒤 다시 시도해 주세요.");
  }

  async #waitForUploadCompletion(video) {
    const fileName = path.basename(video.filePath);
    const timeout = this.timeoutMs * 3;
    const deadline = Date.now() + timeout;

    await this.page.waitForURL(/\/web\/draft\/\d+/, { timeout });
    await this.#descriptionBox().waitFor({ state: "visible", timeout });

    while (Date.now() < deadline) {
      const bodyText = await this.page.locator("body").innerText();
      const playable = await this.#hasPlayablePreview();
      const state = classifyUploadState({ url: this.page.url(), bodyText, fileName, playable });
      if (state === "ready") return this.page.url();
      if (state === "failed") throw new Error(`네이버 클립 영상 처리에 실패했습니다: ${fileName}`);
      await this.page.waitForTimeout(500);
    }

    throw new Error(`네이버 클립 영상 처리 시간이 초과되었습니다: ${fileName}`);
  }

  async #hasCreatorUi() {
    if (!/clipcreators\.naver\.com\/web\//i.test(this.page.url())) return false;
    const uploadControl = this.page.getByRole("button", { name: /업로드/ }).first();
    if (await uploadControl.isVisible().catch(() => false)) return true;
    const uploadLink = this.page.getByRole("link", { name: /업로드/ }).first();
    if (await uploadLink.isVisible().catch(() => false)) return true;
    return /\/web\/(?:dashboard|contents|upload|draft)/i.test(this.page.url());
  }

  async #waitForUploadSurface() {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const currentUrl = this.page.url();
      if (/nid\.naver\.com|nidlogin/i.test(currentUrl)) throw new LoginRequiredError();
      if (/clipcreators\.naver\.com\/join/i.test(currentUrl)) throw new ClipProfileRequiredError();
      const fileInput = this.page.locator('input[type="file"]');
      if (await fileInput.count()) return true;
      const chooseButton = this.page.getByRole("button", { name: /파일 선택|동영상 선택|영상 선택/ }).first();
      if (await chooseButton.isVisible().catch(() => false)) return true;
      await this.page.waitForTimeout(350);
    }
    throw new Error("네이버 클립 업로드 화면이 준비되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
  }

  #descriptionBox() {
    return this.page.locator('textarea[placeholder*="경험"], textarea[aria-label*="경험"], textarea, [contenteditable="true"]').first();
  }

  async #hasPlayablePreview() {
    if (await this.page.locator("video").count()) {
      const playable = await this.page.locator("video").first().evaluate((video) => video.readyState >= 2 || Number.isFinite(video.duration)).catch(() => false);
      if (playable) return true;
    }
    return this.page.getByRole("button", { name: /재생|play/i }).first().isVisible().catch(() => false);
  }

  async #registerCurrentDraft(video, draftUrl) {
    const captionBox = this.#descriptionBox();
    await captionBox.waitFor({ state: "visible" });
    await captionBox.fill(video.caption);

    await this.#chooseCategory(video.category);
    if (video.infoTag) await this.#chooseInfoTag(video.infoTag);
    if (video.productInfo?.name || video.productInfo?.url) await this.#chooseProduct(video.productInfo);
    await this.#setVisibility(video.visibility);
    await this.#disableComments();
    await this.page.waitForTimeout(500);
    const registerButton = this.page.getByRole("button", { name: /^등록$/ }).last();
    await registerButton.waitFor({ state: "visible", timeout: this.timeoutMs });
    await registerButton.scrollIntoViewIfNeeded().catch(() => undefined);
    const enabled = await registerButton.isEnabled().catch(() => false);
    if (!enabled) throw new Error("네이버 클립 등록 버튼이 아직 활성화되지 않았습니다. 필수 입력값을 확인해 주세요.");
    await registerButton.click();

    // A confirmation button only belongs to the modal opened by 등록.
    // Never click a second page-level 등록 button when no modal appeared.
    const confirmationDialog = this.page.getByRole("dialog").last();
    if (await confirmationDialog.isVisible().catch(() => false)) {
      const confirmButton = confirmationDialog.getByRole("button", { name: /^(확인|등록)$/ }).last();
      if (await confirmButton.isVisible().catch(() => false) && await confirmButton.isEnabled().catch(() => false)) await confirmButton.click();
    }

    let successMessageSeen = false;
    const successMessage = this.page.getByText(/등록 (완료|되었습니다)|게시 (완료|되었습니다)/).first();
    successMessageSeen = await successMessage.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);

    await this.page.waitForURL(/\/web\/contents(?:\/clips)?/, {
      timeout: this.timeoutMs
    }).catch(async () => {
      await this.page.goto(CONTENTS_URL, { waitUntil: "domcontentloaded" });
    });

    const verification = await this.#verifyRegistration(video, successMessageSeen);
    if (verification.status === "failed") throw new Error(`네이버 클립 최종 등록에 실패했습니다: ${video.caption}`);
    if (verification.status === "uncertain") throw new NaverClipPublishUncertainError(`네이버 클립 등록 후 콘텐츠 목록에서 영상을 확인하지 못했습니다: ${video.caption}`);

    return {
      filePath: video.filePath,
      caption: video.caption,
      category: video.category,
      visibility: video.visibility,
      status: verification.status,
      draftUrl,
      url: this.page.url(),
      rowText: verification.itemText,
      verification: verification.evidence
    };
  }

  async #verifyRegistration(video, successMessageSeen) {
    const caption = normalizeCreatorText(video.caption);
    const needles = [caption, caption.slice(0, 40), caption.slice(0, 20), path.basename(video.filePath), video.draftName]
      .map(normalizeCreatorText)
      .filter((value, index, values) => value && values.indexOf(value) === index);
    // Clip Creator can update the list asynchronously. Keep polling long
    // enough for the list refresh, but do not leave the UI in "checking"
    // forever when the publish confirmation already returned.
    const deadline = Date.now() + Math.min(Math.max(this.timeoutMs, 20_000), 35_000);
    while (Date.now() < deadline) {
      let itemText = "";
      for (const needle of needles) {
        const item = this.page.locator('tr, [role="row"], li, article, [class*="item"], [class*="card"]').filter({ hasText: needle }).first();
        if (await item.isVisible().catch(() => false)) {
          itemText = normalizeCreatorText(await item.innerText().catch(() => ""));
          break;
        }
        const textMatch = this.page.getByText(needle, { exact: false }).first();
        if (await textMatch.isVisible().catch(() => false)) {
          itemText = normalizeCreatorText(await textMatch.innerText().catch(() => needle));
          break;
        }
      }
      const bodyText = normalizeCreatorText(await this.page.locator("body").innerText().catch(() => ""));
      const status = classifyRegistrationState({ url: this.page.url(), bodyText, itemText, visibility: video.visibility });
      if (status !== "uncertain") return { status, itemText, evidence: "content-list" };
      if (successMessageSeen && /\/web\/contents(?:\/clips)?/i.test(this.page.url()) && await this.#hasContentListItem(needles)) {
        return { status: video.visibility === "private" ? "private" : "published", itemText: "", evidence: "success-and-content-list" };
      }
      await this.page.waitForTimeout(1_500);
      await this.page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    return { status: "uncertain", itemText: "", evidence: successMessageSeen ? "success-message-only" : "none" };
  }

  async #hasContentListItem(needles = []) {
    const candidates = this.page.locator('tr, [role="row"], li, article, [class*="item"], [class*="card"]');
    const count = await candidates.count().catch(() => 0);
    if (count < 2) return false;
    for (let index = 0; index < Math.min(count, 30); index += 1) {
      const row = candidates.nth(index);
      const text = normalizeCreatorText(await row.innerText().catch(() => ""));
      if (!text || /콘텐츠|카테고리|상태|날짜|조회수/.test(text)) continue;
      const matchesVideo = needles.some((needle) => needle && text.includes(needle));
      if (matchesVideo && await row.locator('video, img, button, a').count().catch(() => 0)) return true;
    }
    return false;
  }

  async #chooseCategory(category) {
    if (!Array.isArray(category) || category.length < 2) {
      throw new Error("최종 등록에는 category가 필요합니다.");
    }

    const [primary, secondary] = category;
    await this.#chooseCategoryLevel(0, "1차 카테고리", primary);
    await this.#chooseCategoryLevel(1, "2차 카테고리", secondary);
  }

  async #chooseCategoryLevel(index, label, value) {
    const selects = this.page.locator("select");
    if (await selects.count() > index) {
      const select = selects.nth(index);
      const selected = await select.selectOption({ label: value }).then(() => true).catch(() => false);
      if (selected) return;
    }

    const trigger = this.page.getByRole("button", { name: new RegExp(`${label}|${value}`) }).first();
    if (!(await trigger.isVisible().catch(() => false))) throw new Error(`네이버 클립 ${label} 선택 메뉴를 찾지 못했습니다.`);
    await trigger.click();
    const option = this.page.getByRole("option", { name: value, exact: true }).last();
    if (await option.isVisible().catch(() => false)) await option.click();
    else {
      const textOption = this.page.getByText(value, { exact: true }).last();
      if (!(await textOption.isVisible().catch(() => false))) throw new Error(`네이버 클립 카테고리를 찾지 못했습니다: ${value}`);
      await textOption.click();
    }

    // The current Clip Creator dialog applies both selections with a
    // separate 저장 button. Older pages have no such button, so this is
    // intentionally best-effort.
    const save = this.page.getByRole("button", { name: "저장", exact: true }).last();
    if (await save.isVisible().catch(() => false) && await save.isEnabled().catch(() => false)) await save.click();
  }

  async #chooseInfoTag(infoTag) {
    const tag = String(infoTag || '').trim();
    if (!tag) return;

    const directButton = this.page.getByRole('button', { name: tag, exact: true }).last();
    if (await directButton.isVisible().catch(() => false)) {
      await directButton.click();
    } else {
      const trigger = this.page.getByText(tag, { exact: true }).last();
      if (!(await trigger.isVisible().catch(() => false))) {
        this.logger.warn?.(`네이버 클립 정보태그를 찾지 못해 기본값으로 계속합니다: ${tag}`);
        return false;
      }
      await trigger.click();
    }

    const confirm = this.page.getByRole('button', { name: '선택', exact: true }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    const close = this.page.getByRole('button', { name: /닫기|×/ }).last();
    if (await close.isVisible().catch(() => false)) await close.click();
    return true;
  }

  async #chooseProduct(productInfo) {
    const name = String(productInfo?.name || '').trim();
    const url = String(productInfo?.url || '').trim();
    const trigger = this.page.getByRole('button', { name: /상품 정보|Product information/i }).first();
    if (!(await trigger.isVisible().catch(() => false))) return false;
    await trigger.click();
    const search = this.page.getByPlaceholder(/상품 검색|상품을 검색|Search product/i).first();
    if (await search.isVisible().catch(() => false)) await search.fill(name || url);
    const card = this.page.locator('[role="dialog"], [class*="modal"], body').filter({ hasText: name || url }).last();
    const select = card.getByRole('button', { name: /선택|Select/i }).last();
    if (!(await select.isVisible().catch(() => false))) return false;
    await select.click();
    const purchaseDialog = this.page.getByRole('dialog').filter({ hasText: /구매 인증|Purchase verification/i }).last();
    const certificationButton = purchaseDialog.getByRole('button', { name: /^인증하기$|^Verify$/i }).last();
    if (await purchaseDialog.isVisible().catch(() => false)) {
      if (!(await certificationButton.isVisible().catch(() => false))) throw new Error('네이버 상품 구매 인증 창을 확인했지만 인증하기 버튼을 찾지 못했습니다.');
      if (!(await certificationButton.isEnabled().catch(() => false))) throw new Error('네이버 상품 구매 인증 버튼이 아직 활성화되지 않았습니다.');
      await certificationButton.click();
      const completed = purchaseDialog.getByText(/인증 완료|인증되었습니다|Verified|완료/i).first();
      await completed.waitFor({ state: 'visible', timeout: this.timeoutMs }).catch(() => undefined);
    } else {
      const confirm = this.page.getByRole('button', { name: /선택 완료|저장|확인|Done|Save/i }).last();
      if (await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) await confirm.click();
    }
    return true;
  }

  async #setVisibility(visibility) {
    if (visibility === "current") return;

    let publicSwitch = this.page.getByRole("switch", { name: /전체 공개/ }).first();
    if (!(await publicSwitch.count())) {
      publicSwitch = this.page.getByText("전체 공개", { exact: true }).first().locator("xpath=ancestor::label[1]//input");
    }
    if (!(await publicSwitch.count())) throw new Error("네이버 클립 전체 공개 설정을 찾지 못했습니다.");
    const checked = await publicSwitch.isChecked();
    const shouldBeChecked = visibility === "public";
    if (checked !== shouldBeChecked) await publicSwitch.click();
  }

  async #disableComments() {
    const deny = this.page.getByRole('radio', { name: /허용 안함|댓글 허용 안함|Don't allow comments/i }).last();
    if (await deny.isVisible().catch(() => false)) {
      if (!(await deny.isChecked().catch(() => false))) await deny.click();
      return true;
    }
    const label = this.page.getByText(/허용 안함|Don't allow comments/i, { exact: true }).last();
    if (await label.isVisible().catch(() => false)) {
      await label.click();
      return true;
    }
    return false;
  }

  #validateVideos(videos, finalize) {
    if (!Array.isArray(videos) || videos.length === 0) {
      throw new TypeError("videos 배열에 한 개 이상의 동영상을 전달하세요.");
    }

    return videos.map((video) => {
      if (!video?.filePath || !existsSync(video.filePath) || !statSync(video.filePath).isFile()) {
        throw new Error(`동영상 파일을 찾을 수 없습니다: ${video?.filePath ?? "(경로 없음)"}`);
      }

      const draftName = path.parse(video.filePath).name;
      const caption = video.caption ?? video.title ?? draftName;
      if (caption.length > 300) {
        throw new Error(`설명은 300자 이하여야 합니다: ${video.filePath}`);
      }
      if (finalize && (!Array.isArray(video.category) || video.category.length < 2)) {
        throw new Error(`최종 등록할 1차·2차 카테고리를 지정하세요: ${video.filePath}`);
      }

      return {
        filePath: path.resolve(video.filePath),
        draftName,
        caption,
        category: video.category ?? [],
        infoTag: video.infoTag ?? '',
        visibility: video.visibility ?? "current"
      };
    });
  }

  #assertStarted() {
    if (!this.page) {
      throw new Error("먼저 await client.start()를 호출하세요.");
    }
  }
}
