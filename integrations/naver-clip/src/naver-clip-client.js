import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const CREATOR_ORIGIN = "https://clipcreators.naver.com";
const CONTENTS_URL = `${CREATOR_ORIGIN}/web/contents/clips`;
const UPLOAD_URL = `${CREATOR_ORIGIN}/web/upload`;

export function classifyUploadState({ url, bodyText, fileName, playable }) {
  const text = String(bodyText || "");
  const onDraftPage = /\/web\/draft\/\d+/i.test(String(url || ""));
  const hasFile = !fileName || text.includes(fileName);
  const hasFailure = /(업로드|인코딩|동영상 처리)\s*(실패|오류)/.test(text);
  const isProcessing = /(인코딩 중|인코딩 진행 중|업로드 중)/.test(text);

  if (hasFailure) return "failed";
  if (onDraftPage && hasFile && playable && !isProcessing) return "ready";
  if (onDraftPage && hasFile) return "processing";
  return "waiting";
}

export class LoginRequiredError extends Error {
  constructor(message = "브라우저에서 네이버 로그인이 필요합니다.") {
    super(message);
    this.name = "LoginRequiredError";
  }
}

export class ClipProfileRequiredError extends Error {
  constructor(message = "네이버 클립 프로필 생성 또는 약관 동의가 필요합니다.") {
    super(message);
    this.name = "ClipProfileRequiredError";
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

    const hasCreatorUi = await this.page
      .getByRole("button", { name: "업로드", exact: true })
      .isVisible()
      .catch(() => false);
    return hasCreatorUi;
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
        const hasCreatorUi = await this.page
          .getByRole("button", { name: "업로드", exact: true })
          .isVisible()
          .catch(() => false);
        if (hasCreatorUi) return true;
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
    const chooseButton = this.page.getByRole("button", { name: "파일 선택", exact: true });
    if (await chooseButton.isVisible().catch(() => false)) {
      const [chooser] = await Promise.all([
        this.page.waitForEvent("filechooser"),
        chooseButton.click()
      ]);
      await chooser.setFiles(filePaths);
      return;
    }

    const fileInput = this.page.locator('input[type="file"]').last();
    await fileInput.waitFor({ state: "attached" });
    await fileInput.setInputFiles(filePaths);
  }

  async #waitForUploadCompletion(video) {
    const fileName = path.basename(video.filePath);
    const timeout = this.timeoutMs * 3;
    const deadline = Date.now() + timeout;

    await this.page.waitForURL(/\/web\/draft\/\d+/, { timeout });
    await this.page.getByRole("textbox", { name: "경험을 기록해보세요." }).waitFor({ state: "visible", timeout });

    while (Date.now() < deadline) {
      const bodyText = await this.page.locator("body").innerText();
      const playable = await this.page.getByRole("button", { name: "재생", exact: true }).isVisible().catch(() => false);
      const state = classifyUploadState({ url: this.page.url(), bodyText, fileName, playable });
      if (state === "ready") return this.page.url();
      if (state === "failed") throw new Error(`네이버 클립 영상 처리에 실패했습니다: ${fileName}`);
      await this.page.waitForTimeout(500);
    }

    throw new Error(`네이버 클립 영상 처리 시간이 초과되었습니다: ${fileName}`);
  }

  async #registerCurrentDraft(video, draftUrl) {
    await this.page.getByRole("textbox", { name: "경험을 기록해보세요." }).waitFor({ state: "visible" });

    const captionBox = this.page.getByRole("textbox", {
      name: "경험을 기록해보세요."
    });
    await captionBox.fill(video.caption);

    await this.#chooseCategory(video.category);
    if (video.infoTag) await this.#chooseInfoTag(video.infoTag);
    await this.#setVisibility(video.visibility);
    const registerButton = this.page.getByRole("button", { name: "등록", exact: true });
    await registerButton.click();

    await this.page.waitForURL(/\/web\/contents(?:\/clips)?/, {
      timeout: this.timeoutMs
    }).catch(async () => {
      await this.page.goto(CONTENTS_URL, { waitUntil: "domcontentloaded" });
    });

    const publishedRow = this.page.locator("tr").filter({ hasText: video.caption }).first();
    await publishedRow.waitFor({ state: "visible" });

    const statusText = await publishedRow.innerText();
    if (video.visibility === "public" && !statusText.includes("공개")) {
      throw new Error(`최종 등록 상태를 확인하지 못했습니다: ${video.caption}`);
    }
    if (video.visibility === "private" && !statusText.includes("비공개")) {
      throw new Error(`비공개 등록 상태를 확인하지 못했습니다: ${video.caption}`);
    }

    return {
      filePath: video.filePath,
      caption: video.caption,
      category: video.category,
      visibility: video.visibility,
      status: video.visibility === "private" ? "private" : "published",
      draftUrl,
      rowText: statusText.replace(/\s+/g, " ").trim()
    };
  }

  async #chooseCategory(category) {
    if (!Array.isArray(category) || category.length < 2) {
      throw new Error("최종 등록에는 category가 필요합니다.");
    }

    const [primary, secondary] = category;
    await this.page.getByRole("button", { name: "1차 카테고리", exact: true }).click();
    await this.page.getByRole("button", { name: primary, exact: true }).click();
    await this.page.getByRole("button", { name: "2차 카테고리", exact: true }).click();
    await this.page.getByRole("button", { name: secondary, exact: true }).click();
    await this.page.getByRole("button", { name: primary, exact: true }).waitFor({ state: "visible" });
    await this.page.getByRole("button", { name: secondary, exact: true }).waitFor({ state: "visible" });
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
        throw new Error(`네이버 클립 정보태그를 찾지 못했습니다: ${tag}`);
      }
      await trigger.click();
    }

    const confirm = this.page.getByRole('button', { name: '선택', exact: true }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    const close = this.page.getByRole('button', { name: /닫기|×/ }).last();
    if (await close.isVisible().catch(() => false)) await close.click();
  }

  async #setVisibility(visibility) {
    if (visibility === "current") return;

    const publicSwitch = this.page.getByRole("switch", { name: "전체 공개" });
    const checked = await publicSwitch.isChecked();
    const shouldBeChecked = visibility === "public";
    if (checked !== shouldBeChecked) await publicSwitch.click();
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
