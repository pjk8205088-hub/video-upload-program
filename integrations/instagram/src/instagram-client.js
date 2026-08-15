import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const INSTAGRAM_ORIGIN = "https://www.instagram.com";
const HOME_URL = `${INSTAGRAM_ORIGIN}/`;
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov"]);
const CREATE_LABEL = /\uB9CC\uB4E4\uAE30|Create|\uC0C8 \uAC8C\uC2DC\uBB3C|New post/i;
const POST_LABEL = /\uAC8C\uC2DC\uBB3C|Post|\uB9B4\uC2A4|Reel/i;
const FILE_PICKER_LABEL = /\uCEF4\uD4E8\uD130\uC5D0\uC11C \uC120\uD0DD|\uC0AC\uC9C4\uACFC \uB3D9\uC601\uC0C1|\uC0AC\uC9C4 \uBC0F \uB3D9\uC601\uC0C1|Select from computer|Choose from computer|File select/i;
const NEXT_LABEL = /^\uB2E4\uC74C|Next$/i;
const SHARE_LABEL = /^\uACF5\uC720|\uAC8C\uC2DC|\uAC8C\uC2DC\uBB3C \uACF5\uC720|Share$/i;
const UPLOAD_ERROR_LABEL = /\uC624\uB958|\uC2E4\uD328|\uD615\uC2DD|\uC6A9\uB7C9|\uD30C\uC77C\uC744 \uC5C5\uB85C\uB4DC|error|failed|format|size|upload failed/i;

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
        chromiumSandbox: true,
        ignoreDefaultArgs: ['--no-sandbox'],
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

  async ensureLoggedIn({ waitForManualLogin = true, manualTimeoutMs = 900_000 } = {}) {
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
    await this.#openCreateComposer(video.handle);
    await this.#throwOnSecurityChallenge();
    await this.#selectFile(video.filePath);
    await this.#waitForSelectedMedia();
    await this.#clickNextUntilCaption();
    await this.#fillCaption(video.caption);

    if (!finalize) return { filePath: video.filePath, status: "uploaded-for-review", mode: "live" };

    const shareButton = this.#shareButton();
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
    const visibleChooser = this.page.getByRole("button", { name: FILE_PICKER_LABEL }).first();
    if (await visibleChooser.isVisible().catch(() => false)) {
      const [chooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        visibleChooser.click()
      ]);
      await chooser.setFiles(filePath);
      return;
    }
    const fileInput = this.page.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(filePath);
      return;
    }
    const chooserButton = this.page.getByText(FILE_PICKER_LABEL).first();
    if (!(await chooserButton.isVisible().catch(() => false))) {
      throw new Error("Instagram 파일 선택 버튼을 찾지 못했습니다.");
    }
    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      chooserButton.click()
    ]);
    await chooser.setFiles(filePath);
  }

  async #openCreateComposer(handle = "") {
    const normalizedHandle = String(handle || "").replace(/^@+/, "").trim();
    await this.page.goto(normalizedHandle ? `${INSTAGRAM_ORIGIN}/${encodeURIComponent(normalizedHandle)}/` : HOME_URL, { waitUntil: "domcontentloaded" });
    await this.#throwOnSecurityChallenge();
    if (normalizedHandle) {
      const currentPath = new URL(this.page.url()).pathname.toLowerCase();
      if (!currentPath.includes(`/${normalizedHandle.toLowerCase()}`)) {
        throw new InstagramLoginRequiredError(`Instagram 계정 ${normalizedHandle} 프로필을 확인하지 못했습니다.`);
      }
    }

    const create = this.page.getByRole("link", { name: CREATE_LABEL }).first();
    const createButton = this.page.getByRole("button", { name: CREATE_LABEL }).first();
    if (await create.isVisible().catch(() => false)) await create.click();
    else if (await createButton.isVisible().catch(() => false)) await createButton.click();
    else {
      const createText = this.page.getByText(CREATE_LABEL).first();
      if (await createText.isVisible().catch(() => false)) await createText.click();
      else throw new Error("인스타그램 프로필에서 + 만들기 버튼을 찾지 못했습니다. 로그인 계정과 프로필을 확인해 주세요.");
    }

    await this.page.waitForTimeout(500);
    const post = this.page.getByRole("menuitem", { name: POST_LABEL }).first();
    if (await post.isVisible().catch(() => false)) await post.click();
    const directFileInput = this.page.locator('input[type="file"]').first();
    if (!(await directFileInput.count())) {
      const uploadText = this.page.getByText(/사진과 동영상을 여기로 끌어다 놓으세요|Select from computer|컴퓨터에서 선택/i).first();
      if (!(await uploadText.isVisible().catch(() => false))) await this.page.waitForTimeout(500);
    }
  }

  async #waitForSelectedMedia() {
    const deadline = Date.now() + Math.min(this.timeoutMs, 30_000);
    while (Date.now() < deadline) {
      await this.#throwOnUploadError();
      const fileInput = this.page.locator('input[type="file"]').first();
      const hasSelectedFile = await fileInput.evaluate((element) => Boolean(element.files?.length)).catch(() => false);
      const hasPreview = await this.page.locator('video, img[src^="blob:"]').count().catch(() => 0);
      const next = this.page.getByRole("button", { name: NEXT_LABEL }).last();
      if (hasPreview > 0 || (hasSelectedFile && await next.isVisible().catch(() => false))) return true;
      await this.page.waitForTimeout(350);
    }
    throw new Error(`Instagram 업로드 미리보기를 준비하지 못했습니다: ${this.page.url()}`);
  }

  async #clickNextUntilCaption() {
    for (let step = 0; step < 2; step += 1) {
      const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
      if (await captionBox.isVisible().catch(() => false)) return;
      const next = this.page.getByRole("button", { name: NEXT_LABEL }).last();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await this.page.waitForTimeout(500);
    }
    const captionBox = this.page.locator('textarea, [contenteditable="true"]').first();
    await captionBox.waitFor({ state: "visible", timeout: this.timeoutMs });
  }

  #shareButton() {
    return this.page.getByRole("button", { name: SHARE_LABEL }).last();
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
    const sharedSeen = await shared.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();
      const currentUrls = await this.#publishedUrls(handle);
      const newUrl = [...currentUrls].find((url) => !knownUrls.has(url));
      if (newUrl) return newUrl;
      // Instagram sometimes shows the successful share confirmation before
      // the profile grid exposes the new Reel. Treat that confirmation as
      // the authoritative publish result after a short propagation grace
      // period instead of leaving the UI in a false waiting state.
      if (sharedSeen && Date.now() + 25_000 >= deadline) {
        const normalizedHandle = String(handle || "").replace(/^@+/, "").trim();
        if (normalizedHandle) return `${INSTAGRAM_ORIGIN}/${encodeURIComponent(normalizedHandle)}/`;
      }
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

  async #throwOnUploadError() {
    const error = this.page.getByText(UPLOAD_ERROR_LABEL).first();
    if (await error.isVisible().catch(() => false)) {
      const message = (await error.innerText().catch(() => "Instagram 업로드가 거부되었습니다.")).trim();
      throw new Error(`Instagram 업로드 실패: ${message}`);
    }
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
