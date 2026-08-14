import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const TIKTOK_ORIGIN = "https://www.tiktok.com";
const STUDIO_URL = `${TIKTOK_ORIGIN}/tiktokstudio`;
const UPLOAD_URL = `${STUDIO_URL}/upload?from=creator_center&tab=video`;
const CONTENT_URL = `${STUDIO_URL}/content`;
const MAX_FILE_SIZE = 30 * 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".webm"]);

export class TikTokLoginRequiredError extends Error {
  constructor(message = "열린 브라우저에서 TikTok 로그인이 필요합니다.") {
    super(message);
    this.name = "TikTokLoginRequiredError";
    this.code = "TIKTOK_LOGIN_REQUIRED";
  }
}

export class TikTokSecurityChallengeError extends Error {
  constructor(message = "TikTok 보안 확인 또는 CAPTCHA를 사용자가 완료해야 합니다.") {
    super(message);
    this.name = "TikTokSecurityChallengeError";
    this.code = "TIKTOK_SECURITY_CHALLENGE";
  }
}

export class TikTokPublishUncertainError extends Error {
  constructor(message = "게시 버튼을 누른 뒤 TikTok 게시 상태를 확인하지 못했습니다.") {
    super(message);
    this.name = "TikTokPublishUncertainError";
    this.code = "PUBLISH_STATE_UNCERTAIN";
  }
}

export class TikTokClient {
  constructor({
    userDataDir = path.resolve(process.cwd(), ".tiktok-browser"),
    browserChannel = "chrome",
    headless = false,
    timeoutMs = 120_000,
    logger = console
  } = {}) {
    this.userDataDir = path.resolve(userDataDir);
    this.browserChannel = String(browserChannel || "chrome").toLowerCase();
    if (!["chrome", "msedge", "chromium"].includes(this.browserChannel)) {
      throw new Error(`지원하지 않는 브라우저 채널입니다: ${browserChannel}`);
    }
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.context = null;
    this.page = null;
  }

  async start() {
    if (this.context) return this;

    try {
      const launchOptions = {
        headless: this.headless,
        viewport: { width: 1440, height: 1000 }
      };
      if (this.browserChannel !== "chromium") launchOptions.channel = this.browserChannel;
      this.context = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
    } catch (error) {
      if (/executable|browser.*not found|playwright install/i.test(error.message)) {
        throw new Error(
          this.browserChannel === "chromium"
            ? "Playwright Chromium이 없습니다. `npx playwright install chromium`을 실행하세요."
            : `${this.browserChannel} 브라우저를 찾지 못했습니다. 브라우저를 설치하거나 UPLOAD_DESK_TIKTOK_BROWSER_CHANNEL=chromium을 사용하세요.`
        );
      }
      throw error;
    }

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
    await this.page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" });
    await this.#throwOnSecurityChallenge();
    return this.#waitForUploadUi(5_000);
  }

  async ensureLoggedIn({ waitForManualLogin = true, manualTimeoutMs = 300_000 } = {}) {
    if (await this.isLoggedIn()) return true;
    if (!waitForManualLogin) throw new TikTokLoginRequiredError();

    this.logger.info(
      "열린 브라우저에서 TikTok에 직접 로그인해 주세요. 비밀번호와 인증 코드는 코드가 입력하거나 저장하지 않습니다."
    );

    const deadline = Date.now() + manualTimeoutMs;
    let lastNavigationAt = 0;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(1_000);
      await this.#throwOnSecurityChallenge();
      if (await this.#hasUploadUi()) return true;

      const currentUrl = this.page.url();
      const canRetryStudio =
        /(?:^|\.)tiktok\.com/i.test(new URL(currentUrl).hostname) &&
        !/login|passport/i.test(currentUrl);
      if (canRetryStudio && Date.now() - lastNavigationAt > 5_000) {
        lastNavigationAt = Date.now();
        await this.page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        if (await this.#waitForUploadUi(5_000)) return true;
      }
    }

    throw new TikTokLoginRequiredError("TikTok 수동 로그인 대기 시간이 초과되었습니다.");
  }

  /**
   * @param {object} options
   * @param {Array<{filePath:string, caption?:string, visibility?:'public'|'private'|'friends'|'current'}>} options.videos
   * @param {boolean} [options.finalize=true]
   */
  async uploadVideos({ videos, finalize = true } = {}) {
    this.#assertStarted();
    const normalized = this.#validateVideos(videos);
    await this.ensureLoggedIn();

    const results = [];
    for (const video of normalized) {
      results.push(await this.#uploadOne(video, finalize));
    }
    return results;
  }

  async #uploadOne(video, finalize) {
    const knownUrls = await this.#publishedUrls();
    await this.page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" });
    await this.#throwOnSecurityChallenge();
    await this.#selectFile(video.filePath);
    await this.#waitForUploadReady();
    await this.#fillCaption(video.caption);
    await this.#setVisibility(video.visibility);
    await this.#dismissDialogs();

    if (!finalize) {
      return {
        filePath: video.filePath,
        status: "uploaded-for-review",
        mode: "live"
      };
    }

    const postButton = this.page.getByRole("button", { name: /^(게시|Post)$/i });
    if (!(await postButton.isVisible().catch(() => false)) || !(await postButton.isEnabled())) {
      throw new Error(`TikTok 게시 버튼을 사용할 수 없습니다: ${video.filePath}`);
    }

    await postButton.click();
    await Promise.race([
      this.page.waitForURL(/\/tiktokstudio\/content/i, { timeout: 20_000 }).catch(() => undefined),
      this.page
        .getByText(/동영상이 게시되었습니다|video has been posted/i)
        .waitFor({ state: "visible", timeout: 20_000 })
        .catch(() => undefined),
      this.page.waitForTimeout(20_000)
    ]);

    const publishedUrl = await this.#verifyPublication(knownUrls);
    if (!publishedUrl) {
      throw new TikTokPublishUncertainError(
        `TikTok 게시 후 콘텐츠 목록에서 새 영상을 확인하지 못했습니다: ${video.filePath}`
      );
    }

    const externalId = publishedUrl.match(/\/video\/(\d+)/)?.[1] ?? publishedUrl;
    return {
      filePath: video.filePath,
      externalId,
      url: publishedUrl,
      publishedAt: new Date().toISOString(),
      status: "published",
      mode: "live"
    };
  }

  async #selectFile(filePath) {
    const fileInput = this.page.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(filePath);
      return;
    }

    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      this.page.getByRole("button", { name: /동영상 선택|Select video/i }).click()
    ]);
    await chooser.setFiles(filePath);
  }

  async #waitForUploadReady() {
    const postButton = this.page.getByRole("button", { name: /^(게시|Post)$/i });
    const deadline = Date.now() + this.timeoutMs * 3;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      await this.#dismissDialogs();

      const failure = this.page.getByText(/업로드 실패|Upload failed/i).first();
      if (await failure.isVisible().catch(() => false)) {
        throw new Error(`TikTok 업로드 실패: ${await failure.innerText()}`);
      }

      const uploading = this.page.getByText(/업로드 중|Uploading/i).first();
      const stillUploading = await uploading.isVisible().catch(() => false);
      const canPost =
        (await postButton.isVisible().catch(() => false)) &&
        (await postButton.isEnabled().catch(() => false));
      if (canPost && !stillUploading) return;
      await this.page.waitForTimeout(1_000);
    }

    throw new Error("TikTok 동영상 업로드 완료 대기 시간이 초과되었습니다.");
  }

  async #fillCaption(caption) {
    if (!caption) return;

    let captionBox = this.page.locator('[contenteditable="true"][role="combobox"]').first();
    if (!(await captionBox.isVisible().catch(() => false))) {
      captionBox = this.page.getByRole("combobox").first();
    }
    if (!(await captionBox.isVisible().catch(() => false))) {
      throw new Error("TikTok 설명 입력란을 찾지 못했습니다.");
    }
    await captionBox.fill(caption);
  }

  async #setVisibility(visibility) {
    if (visibility === "current") return;

    const audiencePattern = /모두|나만|친구|Everyone|Only me|Friends/i;
    const comboboxes = this.page.getByRole("combobox");
    let audience = null;
    for (let index = 0; index < (await comboboxes.count()); index += 1) {
      const candidate = comboboxes.nth(index);
      const text = await candidate.innerText().catch(() => "");
      if (audiencePattern.test(text)) {
        audience = candidate;
        break;
      }
    }
    if (!audience) throw new Error("TikTok 공개 범위 선택기를 찾지 못했습니다.");

    const optionNames = {
      public: [/^모두$/, /^Everyone$/i],
      private: [/^나만$/, /^Only me$/i],
      friends: [/^친구$/, /^Friends$/i]
    }[visibility];
    await audience.click();
    for (const name of optionNames) {
      const option = this.page.getByText(name, { exact: true }).last();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        return;
      }
    }
    throw new Error(`TikTok 공개 범위를 설정하지 못했습니다: ${visibility}`);
  }

  async #dismissDialogs() {
    for (let index = 0; index < 4; index += 1) {
      let changed = false;

      const contentCheckDialog = this.page
        .getByRole("dialog")
        .filter({ hasText: /자동 콘텐츠 검사를 켤까요|automatic content check/i });
      if (await contentCheckDialog.isVisible().catch(() => false)) {
        const cancel = contentCheckDialog.getByRole("button", { name: /취소|Cancel/i });
        if (await cancel.isVisible().catch(() => false)) {
          await cancel.click();
          changed = true;
        }
      }

      const notice = this.page.getByRole("alertdialog").first();
      if (await notice.isVisible().catch(() => false)) {
        const confirm = notice.getByRole("button", { name: /확인|Got it|OK/i }).last();
        if (await confirm.isVisible().catch(() => false)) {
          await confirm.click();
          changed = true;
        }
      }

      if (!changed) return;
      await this.page.waitForTimeout(250);
    }
  }

  async #verifyPublication(knownUrls) {
    if (!/\/tiktokstudio\/content/i.test(this.page.url())) {
      await this.page.goto(CONTENT_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      const currentUrls = await this.#collectVideoUrls();
      const publishedUrl = currentUrls.find((url) => !knownUrls.has(url));
      if (publishedUrl) return publishedUrl;
      await this.page.waitForTimeout(1_000);
    }
    return null;
  }

  async #publishedUrls() {
    await this.page.goto(CONTENT_URL, { waitUntil: "domcontentloaded" });
    await Promise.race([
      this.page.locator('a[href*="/video/"]').first().waitFor({ state: "attached", timeout: 5_000 }),
      this.page
        .getByText(/아직 게시한 동영상이 없습니다|게시물이 없습니다|No videos|No content/i)
        .first()
        .waitFor({ state: "visible", timeout: 5_000 }),
      this.page.waitForTimeout(5_000)
    ]).catch(() => undefined);
    await this.#throwOnSecurityChallenge();
    return new Set(await this.#collectVideoUrls());
  }

  async #collectVideoUrls() {
    const hrefs = await this.page
      .locator('a[href*="/video/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")).filter(Boolean));
    return [...new Set(hrefs.map((href) => new URL(href, TIKTOK_ORIGIN).href))];
  }

  async #hasUploadUi() {
    const fileInput = this.page.locator('input[type="file"]');
    if ((await fileInput.count()) > 0) return true;
    return this.page
      .getByRole("button", { name: /동영상 선택|Select video/i })
      .isVisible()
      .catch(() => false);
  }

  async #waitForUploadUi(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      if (await this.#hasUploadUi()) return true;
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  async #throwOnSecurityChallenge() {
    const challenge = this.page
      .getByText(/보안 확인|Security verification|CAPTCHA/i)
      .first();
    if (await challenge.isVisible().catch(() => false)) {
      throw new TikTokSecurityChallengeError();
    }
  }

  #validateVideos(videos) {
    if (!Array.isArray(videos) || videos.length === 0) {
      throw new TypeError("videos 배열에 한 개 이상의 동영상을 전달하세요.");
    }

    return videos.map((video) => {
      if (!video?.filePath || !existsSync(video.filePath) || !statSync(video.filePath).isFile()) {
        throw new Error(`동영상 파일을 찾을 수 없습니다: ${video?.filePath ?? "(경로 없음)"}`);
      }
      const extension = path.extname(video.filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new Error(`TikTok 업로드는 MP4 또는 WebM만 지원합니다: ${video.filePath}`);
      }
      if (statSync(video.filePath).size >= MAX_FILE_SIZE) {
        throw new Error(`TikTok 동영상은 30GB 미만이어야 합니다: ${video.filePath}`);
      }

      const caption = String(video.caption ?? "").trim();
      if (caption.length > 4_000) {
        throw new Error(`TikTok 설명은 4000자 이하여야 합니다: ${video.filePath}`);
      }
      const visibility = video.visibility ?? "current";
      if (!["public", "private", "friends", "current"].includes(visibility)) {
        throw new Error(`지원하지 않는 TikTok 공개 범위입니다: ${visibility}`);
      }
      return {
        filePath: path.resolve(video.filePath),
        caption,
        visibility
      };
    });
  }

  #assertStarted() {
    if (!this.page) throw new Error("먼저 await client.start()를 호출하세요.");
  }
}
