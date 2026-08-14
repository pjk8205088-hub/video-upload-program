import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const FACEBOOK_ORIGIN = "https://www.facebook.com";
const HOME_URL = `${FACEBOOK_ORIGIN}/?locale=ko_KR`;
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export class FacebookLoginRequiredError extends Error {
  constructor(message = "열린 브라우저에서 Facebook 로그인이 필요합니다.") {
    super(message);
    this.name = "FacebookLoginRequiredError";
    this.code = "FACEBOOK_LOGIN_REQUIRED";
  }
}

export class FacebookSecurityChallengeError extends Error {
  constructor(message = "Facebook 보안 확인 또는 인증을 사용자가 완료해야 합니다.") {
    super(message);
    this.name = "FacebookSecurityChallengeError";
    this.code = "FACEBOOK_SECURITY_CHALLENGE";
  }
}

export class FacebookPublishUncertainError extends Error {
  constructor(message = "Facebook 게시 완료 상태를 확인하지 못했습니다.") {
    super(message);
    this.name = "FacebookPublishUncertainError";
    this.code = "PUBLISH_STATE_UNCERTAIN";
  }
}

export class FacebookClient {
  constructor({
    userDataDir = path.resolve(process.cwd(), ".facebook-browser"),
    headless = false,
    timeoutMs = 120_000,
    logger = console
  } = {}) {
    this.userDataDir = path.resolve(userDataDir);
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.context = null;
    this.page = null;
  }

  async start() {
    if (this.context) return this;
    try {
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: this.headless,
        viewport: { width: 1440, height: 1000 }
      });
    } catch (error) {
      if (/executable|browser.*not found|playwright install/i.test(error.message)) {
        throw new Error("Playwright Chromium이 없습니다. `npx playwright install chromium`을 실행하세요.");
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
    await this.page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(700);
    await this.#throwOnSecurityChallenge();
    return !/login|checkpoint|recover/i.test(this.page.url()) && await this.#hasAuthenticatedUi();
  }

  async ensureLoggedIn({ waitForManualLogin = true, manualTimeoutMs = 300_000 } = {}) {
    if (await this.isLoggedIn()) return true;
    if (!waitForManualLogin) throw new FacebookLoginRequiredError();

    this.logger.info("열린 브라우저에서 Facebook에 직접 로그인해 주세요. 비밀번호와 인증 코드는 저장하지 않습니다.");
    const deadline = Date.now() + manualTimeoutMs;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(1_000);
      await this.#throwOnSecurityChallenge();
      if (await this.#hasAuthenticatedUi()) return true;
    }
    throw new FacebookLoginRequiredError("Facebook 수동 로그인 대기 시간이 초과되었습니다.");
  }

  async uploadVideos({ videos, finalize = true } = {}) {
    this.#assertStarted();
    const normalized = this.#validateVideos(videos);
    await this.ensureLoggedIn();

    const results = [];
    for (const video of normalized) results.push(await this.#uploadOne(video, finalize));
    return results;
  }

  async #uploadOne(video, finalize) {
    const knownUrls = await this.#publishedUrls(video.pageHandle);
    await this.#openPage(video.pageHandle);
    await this.#openComposer();
    await this.#selectFile(video.filePath);
    await this.#waitForUploadReady();
    await this.#fillCaption(video.caption);

    if (!finalize) return { filePath: video.filePath, status: "uploaded-for-review", mode: "live" };

    const publishButton = this.page.getByRole("button", { name: /^(게시|Post|공유|Share)$/i }).last();
    if (!(await publishButton.isVisible().catch(() => false)) || !(await publishButton.isEnabled().catch(() => false))) {
      throw new Error(`Facebook 게시 버튼을 사용할 수 없습니다: ${video.filePath}`);
    }
    await publishButton.click();
    const publishedUrl = await this.#verifyPublication(video.pageHandle, knownUrls);
    if (!publishedUrl) throw new FacebookPublishUncertainError(`Facebook 게시 후 새 영상을 확인하지 못했습니다: ${video.filePath}`);

    return {
      filePath: video.filePath,
      externalId: publishedUrl.match(/(?:videos|reel|watch)[^\d]*(\d+)/i)?.[1] ?? publishedUrl,
      url: publishedUrl,
      publishedAt: new Date().toISOString(),
      status: "published",
      mode: "live"
    };
  }

  async #openPage(pageHandle) {
    const normalizedHandle = String(pageHandle || "").replace(/^@+/, "").trim();
    const target = normalizedHandle ? `${FACEBOOK_ORIGIN}/${encodeURIComponent(normalizedHandle)}/videos` : HOME_URL;
    await this.page.goto(target, { waitUntil: "domcontentloaded" });
    await this.#throwOnSecurityChallenge();
  }

  async #openComposer() {
    if (await this.page.locator('input[type="file"]').count()) return;
    const composer = this.page.getByText(/사진\/동영상|Photo\/Video|Create post|게시물 만들기/i).first();
    if (!(await composer.isVisible().catch(() => false))) {
      throw new Error("Facebook 영상 게시 작성 화면을 찾지 못했습니다. 페이지 권한과 로그인 상태를 확인해 주세요.");
    }
    await composer.click();
    await this.page.waitForTimeout(500);
  }

  async #selectFile(filePath) {
    const fileInput = this.page.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(filePath);
      return;
    }
    const chooserButton = this.page.getByRole("button", { name: /사진\/동영상|Photo\/Video|동영상 업로드|Upload video/i }).first();
    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      chooserButton.click()
    ]);
    await chooser.setFiles(filePath);
  }

  async #waitForUploadReady() {
    const deadline = Date.now() + this.timeoutMs * 3;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      const failure = this.page.getByText(/업로드 실패|Upload failed/i).first();
      if (await failure.isVisible().catch(() => false)) throw new Error(`Facebook 영상 업로드에 실패했습니다: ${await failure.innerText()}`);
      const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
      const uploading = this.page.getByText(/업로드 중|Uploading|처리 중/i).first();
      if (await captionBox.isVisible().catch(() => false) && !(await uploading.isVisible().catch(() => false))) return;
      await this.page.waitForTimeout(1_000);
    }
    throw new Error("Facebook 영상 업로드 완료 대기 시간이 초과되었습니다.");
  }

  async #fillCaption(caption) {
    if (!caption) return;
    const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
    await captionBox.fill(caption);
  }

  async #publishedUrls(pageHandle = "") {
    await this.#openPage(pageHandle).catch(() => undefined);
    await this.page.waitForTimeout(800);
    return new Set(await this.#collectVideoUrls());
  }

  async #verifyPublication(pageHandle, knownUrls) {
    const confirmation = this.page.getByText(/게시되었습니다|게시 완료|Your video is ready|Your post is published|Post published/i).first();
    await confirmation.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      const currentUrls = await this.#publishedUrls(pageHandle);
      const newUrl = [...currentUrls].find((url) => !knownUrls.has(url));
      if (newUrl) return newUrl;
      await this.page.waitForTimeout(1_000);
    }
    return null;
  }

  async #collectVideoUrls() {
    const hrefs = await this.page.locator('a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")).filter(Boolean));
    return [...new Set(hrefs.map((href) => new URL(href, FACEBOOK_ORIGIN).href))];
  }

  async #hasAuthenticatedUi() {
    if (/login|checkpoint|recover/i.test(this.page.url())) return false;
    const loginButton = this.page.getByText(/로그인|Log in|Create new account/i).first();
    return !(await loginButton.isVisible().catch(() => false));
  }

  async #throwOnSecurityChallenge() {
    const challenge = this.page.getByText(/보안 확인|Security Check|checkpoint|challenge|CAPTCHA/i).first();
    if (await challenge.isVisible().catch(() => false)) throw new FacebookSecurityChallengeError();
  }

  #validateVideos(videos) {
    if (!Array.isArray(videos) || videos.length === 0) throw new TypeError("videos 배열에 한 개 이상의 동영상을 전달하세요.");
    return videos.map((video) => {
      if (!video?.filePath || !existsSync(video.filePath) || !statSync(video.filePath).isFile()) throw new Error(`동영상 파일을 찾을 수 없습니다: ${video?.filePath ?? "(경로 없음)"}`);
      const extension = path.extname(video.filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Facebook 동영상은 MP4, MOV 또는 WebM만 지원합니다: ${video.filePath}`);
      if (statSync(video.filePath).size >= MAX_FILE_SIZE) throw new Error(`Facebook 동영상은 10GB 미만이어야 합니다: ${video.filePath}`);
      const caption = String(video.caption ?? "").trim();
      if (caption.length > 63_206) throw new Error(`Facebook 게시물 설명이 너무 깁니다: ${video.filePath}`);
      return { filePath: path.resolve(video.filePath), caption, pageHandle: String(video.pageHandle || "").trim() };
    });
  }

  #assertStarted() {
    if (!this.page) throw new Error("먼저 await client.start()를 호출하세요.");
  }
}
