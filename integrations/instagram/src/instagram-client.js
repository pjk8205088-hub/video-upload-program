import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const INSTAGRAM_ORIGIN = "https://www.instagram.com";
const HOME_URL = `${INSTAGRAM_ORIGIN}/`;
const CREATE_URL = `${INSTAGRAM_ORIGIN}/create/select/`;
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov"]);

export class InstagramLoginRequiredError extends Error {
  constructor(message = "열린 브라우저에서 Instagram 로그인이 필요합니다.") {
    super(message);
    this.name = "InstagramLoginRequiredError";
    this.code = "INSTAGRAM_LOGIN_REQUIRED";
  }
}

export class InstagramSecurityChallengeError extends Error {
  constructor(message = "Instagram 보안 확인 또는 인증을 사용자가 완료해야 합니다.") {
    super(message);
    this.name = "InstagramSecurityChallengeError";
    this.code = "INSTAGRAM_SECURITY_CHALLENGE";
  }
}

export class InstagramPublishUncertainError extends Error {
  constructor(message = "Instagram 게시 완료 상태를 확인하지 못했습니다.") {
    super(message);
    this.name = "InstagramPublishUncertainError";
    this.code = "PUBLISH_STATE_UNCERTAIN";
  }
}

export class InstagramClient {
  constructor({
    userDataDir = path.resolve(process.cwd(), ".instagram-browser"),
    browserChannel = "chrome",
    headless = false,
    timeoutMs = 120_000,
    logger = console,
    initialCookies = []
  } = {}) {
    this.userDataDir = path.resolve(userDataDir);
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
    try {
      const launchOptions = {
        headless: this.headless,
        viewport: { width: 1440, height: 1000 }
      };
      if (this.browserChannel !== "chromium") launchOptions.channel = this.browserChannel;
      this.context = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
      if (this.initialCookies.length) await this.context.addCookies(this.initialCookies);
    } catch (error) {
      if (/executable|browser.*not found|playwright install/i.test(error.message)) {
        throw new Error(`${this.browserChannel} 브라우저를 찾지 못했습니다. Chrome 또는 Edge를 설치해 주세요.`);
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
    return !/accounts\/login|login\//i.test(this.page.url()) && await this.#hasAuthenticatedUi();
  }

  async ensureLoggedIn({ waitForManualLogin = true, manualTimeoutMs = 300_000 } = {}) {
    if (await this.isLoggedIn()) return true;
    if (!waitForManualLogin) throw new InstagramLoginRequiredError();

    this.logger.info("열린 브라우저에서 Instagram에 직접 로그인해 주세요. 비밀번호와 인증 코드는 저장하지 않습니다.");
    const deadline = Date.now() + manualTimeoutMs;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(1_000);
      await this.#throwOnSecurityChallenge();
      if (await this.#hasAuthenticatedUi()) return true;
    }
    throw new InstagramLoginRequiredError("Instagram 수동 로그인 대기 시간이 초과되었습니다.");
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
    const knownUrls = await this.#publishedUrls(video.handle);
    await this.page.goto(CREATE_URL, { waitUntil: "domcontentloaded" });
    await this.#throwOnSecurityChallenge();
    await this.#selectFile(video.filePath);
    await this.#clickNextUntilCaption();
    await this.#fillCaption(video.caption);

    if (!finalize) return { filePath: video.filePath, status: "uploaded-for-review", mode: "live" };

    const shareButton = this.page.getByRole("button", { name: /^(공유|Share)$/i }).last();
    if (!(await shareButton.isVisible().catch(() => false)) || !(await shareButton.isEnabled().catch(() => false))) {
      throw new Error(`Instagram 공유 버튼을 사용할 수 없습니다: ${video.filePath}`);
    }
    await shareButton.click();
    const publishedUrl = await this.#verifyPublication(video.handle, knownUrls);
    if (!publishedUrl) throw new InstagramPublishUncertainError(`Instagram 게시 후 새 릴스를 확인하지 못했습니다: ${video.filePath}`);

    return {
      filePath: video.filePath,
      externalId: publishedUrl.match(/\/reel\/([^/?]+)/)?.[1] ?? publishedUrl,
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
    const chooserButton = this.page.getByRole("button", { name: /사진 및 동영상 선택|Select from computer|파일 선택/i }).first();
    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      chooserButton.click()
    ]);
    await chooser.setFiles(filePath);
  }

  async #clickNextUntilCaption() {
    for (let step = 0; step < 2; step += 1) {
      const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
      if (await captionBox.isVisible().catch(() => false)) return;
      const next = this.page.getByRole("button", { name: /^(다음|Next)$/i }).last();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await this.page.waitForTimeout(500);
    }
    const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
    await captionBox.waitFor({ state: "visible", timeout: this.timeoutMs });
  }

  async #fillCaption(caption) {
    if (!caption) return;
    const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
    if (await captionBox.getAttribute("contenteditable").catch(() => null) === "true") {
      await captionBox.fill(caption);
    } else {
      await captionBox.fill(caption);
    }
  }

  async #publishedUrls(handle = "") {
    const normalizedHandle = String(handle || "").replace(/^@+/, "").trim();
    const url = normalizedHandle ? `${INSTAGRAM_ORIGIN}/${encodeURIComponent(normalizedHandle)}/` : HOME_URL;
    await this.page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await this.page.waitForTimeout(800);
    return new Set(await this.#collectReelUrls());
  }

  async #verifyPublication(handle, knownUrls) {
    const shared = this.page.getByText(/게시물이 공유되었습니다|Your reel has been shared|Post shared/i).first();
    await shared.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      const currentUrls = await this.#publishedUrls(handle);
      const newUrl = [...currentUrls].find((url) => !knownUrls.has(url));
      if (newUrl) return newUrl;
      await this.page.waitForTimeout(1_000);
    }
    return null;
  }

  async #collectReelUrls() {
    const hrefs = await this.page.locator('a[href*="/reel/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")).filter(Boolean));
    return [...new Set(hrefs.map((href) => new URL(href, INSTAGRAM_ORIGIN).href))];
  }

  async #hasAuthenticatedUi() {
    if (/accounts\/login|login\//i.test(this.page.url())) return false;
    const loginText = this.page.getByText(/로그인|Log in|Log In/i).first();
    return !(await loginText.isVisible().catch(() => false));
  }

  async #throwOnSecurityChallenge() {
    const challenge = this.page.getByText(/보안 확인|Security Check|checkpoint|challenge|CAPTCHA/i).first();
    if (await challenge.isVisible().catch(() => false)) throw new InstagramSecurityChallengeError();
  }

  #validateVideos(videos) {
    if (!Array.isArray(videos) || videos.length === 0) throw new TypeError("videos 배열에 한 개 이상의 동영상을 전달하세요.");
    return videos.map((video) => {
      if (!video?.filePath || !existsSync(video.filePath) || !statSync(video.filePath).isFile()) throw new Error(`동영상 파일을 찾을 수 없습니다: ${video?.filePath ?? "(경로 없음)"}`);
      const extension = path.extname(video.filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Instagram 릴스는 MP4 또는 MOV만 지원합니다: ${video.filePath}`);
      if (statSync(video.filePath).size >= MAX_FILE_SIZE) throw new Error(`Instagram 동영상은 4GB 미만이어야 합니다: ${video.filePath}`);
      const caption = String(video.caption ?? "").trim();
      if (caption.length > 2_200) throw new Error(`Instagram 캡션은 2200자 이하여야 합니다: ${video.filePath}`);
      return { filePath: path.resolve(video.filePath), caption, handle: String(video.handle || "").trim() };
    });
  }

  #assertStarted() {
    if (!this.page) throw new Error("먼저 await client.start()를 호출하세요.");
  }
}
