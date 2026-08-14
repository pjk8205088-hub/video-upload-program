import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const FACEBOOK_ORIGIN = "https://www.facebook.com";
const FEED_URL = `${FACEBOOK_ORIGIN}/`;
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv"]);

export class FacebookLoginRequiredError extends Error {
  constructor(message = "열린 브라우저에서 Facebook 로그인이 필요합니다.") {
    super(message);
    this.name = "FacebookLoginRequiredError";
    this.code = "FACEBOOK_LOGIN_REQUIRED";
  }
}

export class FacebookSecurityChallengeError extends Error {
  constructor(message = "Facebook 보안 확인 또는 CAPTCHA를 사용자가 완료해야 합니다.") {
    super(message);
    this.name = "FacebookSecurityChallengeError";
    this.code = "FACEBOOK_SECURITY_CHALLENGE";
  }
}

export class FacebookPublishUncertainError extends Error {
  constructor(message = "Facebook 게시 버튼을 누른 뒤 게시 상태를 확인하지 못했습니다.") {
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
        throw new Error(
          "Playwright Chromium이 없습니다. `npx playwright install chromium`을 실행하세요."
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
    await this.page.goto(FEED_URL, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(700);
    await this.#throwOnSecurityChallenge();

    if (/facebook\.com\/login/i.test(this.page.url())) return false;

    const loginForm = this.page.getByRole("textbox", { name: /이메일|전화번호|email|phone/i }).first();
    if (await loginForm.isVisible().catch(() => false)) return false;

    return this.#hasComposer();
  }

  async ensureLoggedIn({ waitForManualLogin = true, manualTimeoutMs = 300_000 } = {}) {
    if (await this.isLoggedIn()) return true;
    if (!waitForManualLogin) throw new FacebookLoginRequiredError();

    this.logger.info(
      "열린 브라우저에서 Facebook에 직접 로그인해 주세요. 비밀번호와 인증 코드는 코드가 입력하거나 저장하지 않습니다."
    );

    const deadline = Date.now() + manualTimeoutMs;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(1_000);
      await this.#throwOnSecurityChallenge();
      if (await this.#hasComposer()) return true;
    }

    throw new FacebookLoginRequiredError("Facebook 수동 로그인 대기 시간이 초과되었습니다.");
  }

  /**
   * @param {object} options
   * @param {Array<{filePath:string, caption?:string}>} options.videos
   * @param {boolean} [options.finalize=true] 게시 버튼까지 누를지 여부
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
    await this.page.goto(FEED_URL, { waitUntil: "domcontentloaded" });
    await this.#throwOnSecurityChallenge();

    const chooserPromise = this.page.waitForEvent("filechooser", { timeout: 10_000 });
    await this.page
      .getByRole("button", { name: /사진\/동영상|Photo\/video|Photo\/Video/i })
      .first()
      .click();
    const chooser = await chooserPromise;
    await chooser.setFiles(video.filePath);

    const dialog = this.page
      .getByRole("dialog", { name: /게시물 만들기|Create post/i })
      .first();
    await this.#waitForUploadReady(dialog);
    await this.#fillCaption(dialog, video.caption);

    if (!finalize) {
      return { filePath: video.filePath, status: "uploaded-for-review", mode: "live" };
    }

    const postButton = dialog.getByRole("button", { name: /^(게시|Post)$/i }).first();
    if (!(await postButton.isVisible().catch(() => false)) || !(await postButton.isEnabled())) {
      throw new Error(`Facebook 게시 버튼을 사용할 수 없습니다: ${video.filePath}`);
    }

    await postButton.click();
    const published = await this.#waitForPublishConfirmation();
    if (!published) {
      throw new FacebookPublishUncertainError(
        `Facebook 게시 후 성공 알림을 확인하지 못했습니다: ${video.filePath}`
      );
    }

    return {
      filePath: video.filePath,
      externalId: `facebook_${Date.now().toString(36)}`,
      publishedAt: new Date().toISOString(),
      status: "published",
      mode: "live"
    };
  }

  async #waitForUploadReady(dialog) {
    const postButton = dialog.getByRole("button", { name: /^(게시|Post)$/i }).first();
    const deadline = Date.now() + this.timeoutMs * 3;

    while (Date.now() < deadline) {
      await this.#throwOnSecurityChallenge();

      const failure = dialog.getByText(/업로드 실패|Upload failed/i).first();
      if (await failure.isVisible().catch(() => false)) {
        throw new Error(`Facebook 업로드 실패: ${await failure.innerText()}`);
      }

      const uploading = dialog
        .getByRole("progressbar", { name: /동영상 업로드 중|Uploading video/i })
        .count();
      const isUploading = (await uploading) > 0;
      const canPost =
        (await postButton.isVisible().catch(() => false)) &&
        (await postButton.isEnabled().catch(() => false));

      if (canPost && !isUploading) return;
      await this.page.waitForTimeout(1_000);
    }

    throw new Error("Facebook 동영상 업로드 완료 대기 시간이 초과되었습니다.");
  }

  async #fillCaption(dialog, caption) {
    if (!caption) return;
    const textbox = dialog.getByRole("textbox").first();
    if (!(await textbox.isVisible().catch(() => false))) {
      throw new Error("Facebook 게시물 설명 입력란을 찾지 못했습니다.");
    }
    await textbox.fill(caption);
  }

  async #waitForPublishConfirmation() {
    const success = this.page.getByText(/게시물이 .*공유되었습니다|Post shared/i).first();
    await Promise.race([
      success.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined),
      this.page.waitForTimeout(20_000)
    ]);
    return success.isVisible().catch(() => false);
  }

  async #hasComposer() {
    return this.page
      .getByRole("button", { name: /무슨 생각을 하고 계신가요|What's on your mind/i })
      .isVisible()
      .catch(() => false);
  }

  async #throwOnSecurityChallenge() {
    const challenge = this.page
      .getByText(/보안 확인|Security check|CAPTCHA|일시적으로 차단/i)
      .first();
    if (await challenge.isVisible().catch(() => false)) {
      throw new FacebookSecurityChallengeError();
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
        throw new Error(`Facebook 업로드는 MP4, MOV, WebM 또는 MKV만 지원합니다: ${video.filePath}`);
      }
      if (statSync(video.filePath).size > MAX_FILE_SIZE) {
        throw new Error(`Facebook 동영상은 2GB 이하여야 합니다: ${video.filePath}`);
      }

      const caption = String(video.caption ?? "").trim();
      return { filePath: path.resolve(video.filePath), caption };
    });
  }

  #assertStarted() {
    if (!this.page) throw new Error("먼저 await client.start()를 호출하세요.");
  }
}
