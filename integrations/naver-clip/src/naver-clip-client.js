import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const CREATOR_ORIGIN = "https://clipcreators.naver.com";
const CONTENTS_URL = `${CREATOR_ORIGIN}/web/contents/clips`;
const UPLOAD_URL = `${CREATOR_ORIGIN}/web/upload`;

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
    headless = false,
    timeoutMs = 120_000,
    logger = console
  } = {}) {
    this.userDataDir = userDataDir;
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.context = null;
    this.page = null;
  }

  async start() {
    if (this.context) return this;

    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      headless: this.headless,
      viewport: { width: 1440, height: 1000 }
    });
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

    await this.page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" });
    await this.#selectFiles(normalized.map((video) => video.filePath));
    await this.#waitForUploadCompletion(normalized);

    const toContents = this.page.getByRole("button", { name: "콘텐츠 메뉴로 이동" });
    if (await toContents.isVisible().catch(() => false)) {
      await toContents.click();
    } else {
      await this.page.goto(CONTENTS_URL, { waitUntil: "domcontentloaded" });
    }

    if (!finalize) {
      return normalized.map((video) => ({ ...video, status: "draft" }));
    }

    const results = [];
    for (const video of normalized) {
      results.push(await this.#registerDraft(video));
    }
    return results;
  }

  async #selectFiles(filePaths) {
    const fileInput = this.page.locator('input[type="file"]').last();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(filePaths);
      return;
    }

    const [chooser] = await Promise.all([
      this.page.waitForEvent("filechooser"),
      this.page.getByRole("button", { name: "파일 선택", exact: true }).click()
    ]);
    await chooser.setFiles(filePaths);
  }

  async #waitForUploadCompletion(videos) {
    const completion = this.page.getByText("업로드 완료", { exact: true });
    await completion.waitFor({ state: "visible", timeout: this.timeoutMs * 3 });

    for (const video of videos) {
      const fileName = path.basename(video.filePath);
      await this.page
        .getByText(fileName, { exact: true })
        .waitFor({ state: "visible", timeout: 10_000 })
        .catch(() => undefined);
    }
  }

  async #registerDraft(video) {
    await this.page.goto(CONTENTS_URL, { waitUntil: "domcontentloaded" });
    const row = await this.#findDraftRow(video);
    await row.getByRole("button").first().click();

    await this.page
      .getByRole("heading", { name: /동영상 (등록|수정)/ })
      .waitFor({ state: "visible" });

    const captionBox = this.page.getByRole("textbox", {
      name: "경험을 기록해보세요."
    });
    await captionBox.fill(video.caption);

    await this.#chooseCategory(video.category);
    await this.#setVisibility(video.visibility);
    await this.page.getByRole("button", { name: "등록", exact: true }).click();

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

    return {
      filePath: video.filePath,
      caption: video.caption,
      category: video.category,
      visibility: video.visibility,
      status: video.visibility === "private" ? "private" : "published"
    };
  }

  async #findDraftRow(video) {
    const candidates = [
      path.basename(video.filePath),
      video.caption,
      video.draftName
    ];

    for (const candidate of candidates) {
      const row = this.page.locator("tr").filter({ hasText: candidate }).first();
      if (await row.isVisible().catch(() => false)) return row;
    }

    throw new Error(`업로드된 임시 동영상을 찾지 못했습니다: ${video.filePath}`);
  }

  async #chooseCategory(category) {
    if (!Array.isArray(category) || category.length < 1) {
      throw new Error("최종 등록에는 category가 필요합니다.");
    }

    for (const categoryName of category) {
      const exactButton = this.page.getByRole("button", {
        name: categoryName,
        exact: true
      });
      if (await exactButton.isVisible().catch(() => false)) {
        await exactButton.click();
        await this.page.waitForTimeout(250);
        continue;
      }

      const categoryTrigger = this.page.getByRole("button", {
        name: /카테고리.*선택|선택.*카테고리/
      });
      if (await categoryTrigger.isVisible().catch(() => false)) {
        await categoryTrigger.click();
      }

      const option = this.page.getByText(categoryName, { exact: true }).last();
      await option.click();
      await this.page.waitForTimeout(250);
    }
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
      if (finalize && (!Array.isArray(video.category) || video.category.length === 0)) {
        throw new Error(`최종 등록할 카테고리를 지정하세요: ${video.filePath}`);
      }

      return {
        filePath: path.resolve(video.filePath),
        draftName,
        caption,
        category: video.category ?? [],
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
