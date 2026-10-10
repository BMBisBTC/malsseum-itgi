(() => {
  "use strict";

  const STORAGE_KEY = "malsseum-itgi-progress-v1";
  const VALID_VIEWS = new Set(["learn", "meaning", "blank", "syllable", "progress"]);
  const VIEW_TITLES = {
    learn: "단어 학습",
    meaning: "뜻 맞히기",
    blank: "말씀 암송",
    syllable: "음절 퍼즐",
    progress: "나의 기록",
  };
  const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
  const JOURNEYS = {
    daily: { title: "오늘의 맞춤 복습", description: "복습할 때가 된 단어와 오늘의 새 단어를 함께 만나요.", terms: [] },
    salvation: { title: "구원의 길", description: "복음에서 영생까지 구원의 흐름을 따라가요.", terms: ["복음", "구원", "은혜", "믿음", "회개", "구속", "십자가", "부활", "영생"] },
    faith: { title: "믿음과 소망", description: "기다림과 인내 속에서 믿음을 단단히 세워요.", terms: ["믿음", "소망", "인내", "충성", "평강", "기쁨", "지혜"] },
    prayer: { title: "기도와 예배", description: "하나님께 마음을 열고 예배하는 단어를 익혀요.", terms: ["기도", "예배", "찬양", "감사", "성령", "교회"] },
    love: { title: "사랑과 용서", description: "이웃을 품고 화평을 이루는 말씀을 배워요.", terms: ["사랑", "긍휼", "용서", "화평", "겸손", "온유"] },
    fruit: { title: "성령의 열매", description: "일상에서 맺어 갈 믿음의 성품을 돌아봐요.", terms: ["사랑", "기쁨", "평강", "인내", "온유", "절제", "충성"] },
    cross: { title: "십자가와 부활", description: "예수님의 희생과 다시 사심을 깊이 새겨요.", terms: ["대속물", "십자가", "구속", "속죄", "화목", "부활", "영생"] },
    comfort: { title: "고난 속 위로", description: "힘든 날에도 붙들 수 있는 소망을 찾아요.", terms: ["시험", "곤고", "소망", "평강", "기도", "인내", "은혜"] },
  };

  const loadingCard = document.querySelector("#loading-card");
  const viewRoot = document.querySelector("#view-root");
  const liveRegion = document.querySelector("#live-region");
  const toast = document.querySelector("#toast");
  const dailyProgressLabel = document.querySelector("#daily-progress-label");
  const dailyProgressBar = document.querySelector("#daily-progress-bar");
  const streakCount = document.querySelector("#streak-count");

  let dataset = null;
  let words = [];
  let dailyWords = [];
  let activeView = readHash();
  let learnIndex = 0;
  let meaningQuestion = null;
  let meaningMode = "definition";
  let blankQuestion = null;
  let memorizationLevel = 1;
  let syllableState = null;
  let syllableLevel = 1;
  let shapePuzzleState = null;
  let activeJourneyKey = "daily";
  let mediaRecorder = null;
  let recordingStream = null;
  let recordedChunks = [];
  let recordingUrl = null;
  let installPrompt = null;
  let toastTimer = null;
  let progress = loadProgress();

  function readHash() {
    const value = window.location.hash.replace(/^#\/?/, "");
    return VALID_VIEWS.has(value) ? value : "learn";
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function yesterdayKey() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return localDateKey(date);
  }

  function defaultProgress() {
    return {
      learned: [],
      correct: 0,
      attempts: 0,
      streak: 0,
      lastActive: null,
      daily: {},
      wordStats: {},
      reflections: {},
    };
  }

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.learned)) return defaultProgress();
      return {
        ...defaultProgress(),
        ...saved,
        daily: saved.daily && typeof saved.daily === "object" ? saved.daily : {},
        wordStats: saved.wordStats && typeof saved.wordStats === "object" ? saved.wordStats : {},
        reflections: saved.reflections && typeof saved.reflections === "object" ? saved.reflections : {},
      };
    } catch {
      return defaultProgress();
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (error) {
      console.warn("Learning progress could not be saved", error);
      showToast("기록을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.");
    }
    updateSidebar();
  }

  function touchActivity() {
    const today = localDateKey();
    if (progress.lastActive === today) return;
    progress.streak = progress.lastActive === yesterdayKey() ? progress.streak + 1 : 1;
    progress.lastActive = today;
  }

  function displayStreak() {
    if (progress.lastActive === localDateKey() || progress.lastActive === yesterdayKey()) {
      return progress.streak;
    }
    return 0;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    return function random() {
      let value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, random = Math.random) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function randomWord(filter = () => true, previousId = null) {
    const pool = words.filter((word) => filter(word) && word.id !== previousId);
    const duePool = dueWords().filter((word) => filter(word) && word.id !== previousId);
    const candidates = duePool.length ? duePool : pool;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizePracticeText(value) {
    return String(value).normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function announce(message) {
    liveRegion.textContent = "";
    window.setTimeout(() => { liveRegion.textContent = message; }, 30);
  }

  function markLearned(word) {
    if (!progress.learned.includes(word.id)) progress.learned.push(word.id);
    const statKey = String(word.id);
    if (!progress.wordStats[statKey]) {
      progress.wordStats[statKey] = {
        attempts: 0,
        correct: 0,
        reviewLevel: 0,
        hintCount: 0,
        lastReviewed: localDateKey(),
        nextReview: addDaysKey(1),
      };
    }
    const today = localDateKey();
    progress.daily[today] ||= [];
    if (!progress.daily[today].includes(word.id)) progress.daily[today].push(word.id);
    touchActivity();
    saveProgress();
  }

  function addDaysKey(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return localDateKey(date);
  }

  function recordAnswer(correct, targetWords = []) {
    progress.attempts += 1;
    if (correct) progress.correct += 1;
    const targets = Array.isArray(targetWords) ? targetWords : [targetWords];
    targets.filter(Boolean).forEach((word) => {
      const key = String(word.id);
      const current = progress.wordStats[key] || { attempts: 0, correct: 0, reviewLevel: -1, hintCount: 0 };
      current.attempts += 1;
      if (correct) {
        current.correct += 1;
        current.reviewLevel = Math.min((Number.isFinite(current.reviewLevel) ? current.reviewLevel : -1) + 1, REVIEW_INTERVALS.length - 1);
        current.nextReview = addDaysKey(REVIEW_INTERVALS[current.reviewLevel]);
      } else {
        current.reviewLevel = -1;
        current.nextReview = localDateKey();
      }
      current.lastReviewed = localDateKey();
      progress.wordStats[key] = current;
    });
    touchActivity();
    saveProgress();
  }

  function recordHint(word) {
    if (!word) return;
    const key = String(word.id);
    const current = progress.wordStats[key] || { attempts: 0, correct: 0, reviewLevel: -1, hintCount: 0 };
    current.hintCount += 1;
    current.nextReview = localDateKey();
    progress.wordStats[key] = current;
    saveProgress();
  }

  function dueWords() {
    const today = localDateKey();
    return words.filter((word) => {
      const stat = progress.wordStats[String(word.id)];
      return stat?.nextReview && stat.nextReview <= today;
    }).sort((first, second) => {
      const a = progress.wordStats[String(first.id)];
      const b = progress.wordStats[String(second.id)];
      return (a.nextReview || "").localeCompare(b.nextReview || "") || (b.hintCount || 0) - (a.hintCount || 0);
    });
  }

  function weakWords() {
    return words.filter((word) => progress.wordStats[String(word.id)]?.attempts)
      .sort((first, second) => {
        const a = progress.wordStats[String(first.id)];
        const b = progress.wordStats[String(second.id)];
        const aRate = a.correct / a.attempts;
        const bRate = b.correct / b.attempts;
        return aRate - bRate || (b.hintCount || 0) - (a.hintCount || 0);
      });
  }

  function personalizedDailyWords() {
    const random = seededRandom(hashString(localDateKey()));
    const priority = [...dueWords(), ...weakWords()];
    const uniquePriority = priority.filter((word, index, items) => items.findIndex((item) => item.id === word.id) === index);
    const remaining = shuffle(words.filter((word) => !uniquePriority.some((item) => item.id === word.id)), random);
    return [...uniquePriority, ...remaining].slice(0, 5);
  }

  function updateSidebar() {
    if (!dailyWords.length) return;
    const completed = dailyWords.filter((word) => progress.learned.includes(word.id)).length;
    dailyProgressLabel.textContent = `${completed} / ${dailyWords.length}`;
    dailyProgressBar.style.width = `${(completed / dailyWords.length) * 100}%`;
    streakCount.textContent = `${displayStreak()}일`;
  }

  function navigate(view, updateHash = true) {
    if (!VALID_VIEWS.has(view)) view = "learn";
    if (activeView === "blank" && view !== "blank" && mediaRecorder?.state === "recording") mediaRecorder.stop();
    activeView = view;
    document.querySelectorAll("[data-view]").forEach((button) => {
      const selected = button.dataset.view === view;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    });
    if (updateHash) history.replaceState(null, "", `#${view}`);
    document.title = `${VIEW_TITLES[view]} · 말씀잇기`;
    renderActiveView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function headerTemplate(eyebrow, title, description, score = false) {
    return `
      <header class="view-header">
        <div>
          <span class="eyebrow">${escapeHtml(eyebrow)}</span>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
        </div>
        ${score ? `<span class="score-chip">정답 ${progress.correct} · 도전 ${progress.attempts}</span>` : ""}
      </header>`;
  }

  function renderActiveView() {
    if (!dataset) return;
    const renderers = {
      learn: renderLearn,
      meaning: renderMeaning,
      blank: renderBlank,
      syllable: renderSyllable,
      progress: renderProgress,
    };
    renderers[activeView]();
  }

  function originalLanguageTemplate(word) {
    const original = word.originalLanguage;
    if (!original?.roots?.length) return "";
    const headingId = `original-language-${word.id}`;
    return `
      <section class="original-panel" aria-labelledby="${headingId}">
        <div class="original-panel-heading">
          <div>
            <span class="original-kicker">원어로 더 깊이</span>
            <h3 id="${headingId}">이 구절에서는</h3>
          </div>
          <span class="original-basis">${escapeHtml(original.basis)}</span>
        </div>
        <div class="original-root-list">
          ${original.roots.map((root) => {
            const isHebrew = root.language === "히브리어";
            return `
              <article class="original-root">
                <div class="original-root-topline">
                  <span class="language-pill">${escapeHtml(root.language)}</span>
                  <span class="strong-pill">Strong ${escapeHtml(root.strong)}</span>
                </div>
                <div class="original-script" lang="${isHebrew ? "he" : "grc"}" ${isHebrew ? 'dir="rtl"' : ""}>${escapeHtml(root.script)}</div>
                <div class="original-reading">
                  <strong>${escapeHtml(root.pronunciation)}</strong>
                  <span lang="en">${escapeHtml(root.transliteration)}</span>
                  <small>${escapeHtml(root.partOfSpeech)}</small>
                </div>
                <p class="original-gloss">${escapeHtml(root.gloss)}</p>
              </article>`;
          }).join("")}
        </div>
        <p class="original-explanation">${escapeHtml(original.explanation)}</p>
      </section>`;
  }

  function journeyPickerTemplate() {
    const activeJourney = JOURNEYS[activeJourneyKey];
    return `
      <details class="journey-picker">
        <summary>
          <span><small>말씀 여정</small><strong>${escapeHtml(activeJourney.title)}</strong></span>
          <span aria-hidden="true">＋</span>
        </summary>
        <p>${escapeHtml(activeJourney.description)}</p>
        <div class="journey-grid">
          ${Object.entries(JOURNEYS).map(([key, journey]) => `
            <button type="button" class="journey-button${key === activeJourneyKey ? " is-active" : ""}" data-journey="${key}">
              <strong>${escapeHtml(journey.title)}</strong><span>${escapeHtml(journey.description)}</span>
            </button>`).join("")}
        </div>
      </details>`;
  }

  function contextTemplate(word) {
    if (!word.context?.length) return "";
    return `
      <details class="verse-context">
        <summary>앞뒤 말씀 함께 보기</summary>
        <div class="context-list">
          ${word.context.map((item) => `
            <p class="context-verse${item.current ? " is-current" : ""}">
              <strong>${escapeHtml(item.reference)}</strong><span>${escapeHtml(item.verse)}</span>
            </p>`).join("")}
        </div>
      </details>`;
  }

  function reflectionTemplate(word) {
    const saved = progress.reflections[String(word.id)] || {};
    return `
      <details class="reflection-card">
        <summary>말씀으로 기도하기</summary>
        <form id="reflection-form" class="reflection-form">
          <label>이 말씀에서 하나님은 어떤 분인가요?
            <textarea name="god" rows="2" placeholder="말씀에서 발견한 하나님의 성품">${escapeHtml(saved.god || "")}</textarea>
          </label>
          <label>오늘 순종할 한 가지는 무엇인가요?
            <textarea name="obedience" rows="2" placeholder="작고 구체적인 한 가지">${escapeHtml(saved.obedience || "")}</textarea>
          </label>
          <label>한 문장 기도
            <textarea name="prayer" rows="2" placeholder="하나님께 드리는 짧은 기도">${escapeHtml(saved.prayer || "")}</textarea>
          </label>
          <button class="secondary-button" type="submit">묵상과 기도 저장</button>
          <p>이 내용은 이 기기에만 저장됩니다.</p>
        </form>
      </details>`;
  }

  function renderLearn() {
    const word = dailyWords[learnIndex % dailyWords.length];
    const learned = progress.learned.includes(word.id);
    const otherVerses = word.occurrences.filter((item) => item.reference !== word.reference).slice(0, 5);
    const verseLength = normalizePracticeText(word.verse).length;

    viewRoot.innerHTML = `
      ${headerTemplate(JOURNEYS[activeJourneyKey].title, "말씀에서 단어를 만나요", "뜻을 읽고 실제 구절 속에서 단어가 어떻게 쓰였는지 살펴보세요.")}
      ${journeyPickerTemplate()}
      <article class="study-card">
        <div class="card-topline">
          <span class="category-pill">${escapeHtml(word.category)}</span>
          <span class="word-count">${learnIndex + 1} / ${dailyWords.length}</span>
        </div>
        <h2 class="study-word">${escapeHtml(word.term)}</h2>
        <p class="definition">${escapeHtml(word.definition)}</p>
        ${originalLanguageTemplate(word)}
        <div class="verse-box">
          <blockquote>${escapeHtml(word.verse)}</blockquote>
          <cite>${escapeHtml(word.reference)}</cite>
        </div>
        ${contextTemplate(word)}
        <section class="verse-practice" aria-labelledby="verse-practice-title-${word.id}">
          <div class="verse-practice-heading">
            <div>
              <span class="verse-practice-kicker">말씀 새겨 쓰기</span>
              <h3 id="verse-practice-title-${word.id}">성경구절 전체 쓰기</h3>
            </div>
            <span class="verse-practice-reference">${escapeHtml(word.reference)}</span>
          </div>
          <p class="verse-practice-help">위 말씀을 처음부터 끝까지 직접 써 보세요. 띄어쓰기와 문장부호는 채점하지 않으며, 성경 주소는 쓰지 않아도 됩니다.</p>
          <form class="verse-practice-form" id="verse-practice-form" novalidate>
            <label class="sr-only" for="verse-practice-answer">${escapeHtml(word.reference)} 성경구절 전체 쓰기</label>
            <textarea class="verse-practice-input" id="verse-practice-answer" rows="5" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="성경구절 전체를 여기에 써 보세요" aria-describedby="verse-practice-feedback"></textarea>
            <div class="verse-practice-actions">
              <span class="verse-practice-progress" id="verse-practice-progress">0 / ${verseLength}자</span>
              <button class="secondary-button" type="submit">쓴 구절 확인</button>
            </div>
          </form>
          <p class="verse-practice-feedback" id="verse-practice-feedback" role="status" aria-live="polite">말씀을 보며 천천히 한 절 전체를 써 보세요.</p>
        </section>
        ${reflectionTemplate(word)}
        <div class="study-meta">
          <span>성경 전체에서 ${word.occurrenceCount.toLocaleString("ko-KR")}개 절에 등장</span>
          <span>${learned ? "오늘 학습 완료" : "아직 학습 전"}</span>
        </div>
        <div class="card-actions">
          <button class="secondary-button" type="button" id="random-word">다른 단어 보기</button>
          <button class="primary-button" type="button" id="mark-learned">${learned ? "복습 완료" : "오늘 외웠어요"}</button>
        </div>
      </article>
      <details class="more-verses">
        <summary>이 단어가 담긴 다른 구절</summary>
        <ul class="verse-list">
          ${otherVerses.map((item) => `<li><strong>${escapeHtml(item.reference)}</strong><span>${escapeHtml(item.verse)}</span></li>`).join("")}
        </ul>
      </details>`;

    document.querySelectorAll("[data-journey]").forEach((button) => {
      button.addEventListener("click", () => {
        activeJourneyKey = button.dataset.journey;
        const journey = JOURNEYS[activeJourneyKey];
        dailyWords = activeJourneyKey === "daily"
          ? personalizedDailyWords()
          : journey.terms.map((term) => words.find((wordItem) => wordItem.term === term)).filter(Boolean);
        learnIndex = 0;
        updateSidebar();
        renderLearn();
      });
    });

    document.querySelector("#reflection-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      progress.reflections[String(word.id)] = {
        god: String(formData.get("god") || "").trim(),
        obedience: String(formData.get("obedience") || "").trim(),
        prayer: String(formData.get("prayer") || "").trim(),
        updatedAt: new Date().toISOString(),
      };
      touchActivity();
      saveProgress();
      showToast("묵상과 기도를 이 기기에 저장했어요.");
    });

    const versePracticeInput = document.querySelector("#verse-practice-answer");
    const versePracticeFeedback = document.querySelector("#verse-practice-feedback");
    const versePracticeProgress = document.querySelector("#verse-practice-progress");

    versePracticeInput.addEventListener("input", () => {
      versePracticeProgress.textContent = `${normalizePracticeText(versePracticeInput.value).length} / ${verseLength}자`;
      versePracticeInput.classList.remove("is-correct", "is-wrong");
      versePracticeFeedback.className = "verse-practice-feedback";
      versePracticeFeedback.textContent = "말씀을 보며 천천히 한 절 전체를 써 보세요.";
    });

    document.querySelector("#verse-practice-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const answer = normalizePracticeText(versePracticeInput.value);
      const expected = normalizePracticeText(word.verse);

      if (!answer) {
        versePracticeInput.classList.add("is-wrong");
        versePracticeFeedback.className = "verse-practice-feedback is-wrong";
        versePracticeFeedback.textContent = "먼저 입력 칸에 성경구절을 써 주세요.";
        versePracticeInput.focus();
        return;
      }

      if (answer !== expected) {
        versePracticeInput.classList.remove("is-correct");
        versePracticeInput.classList.add("is-wrong");
        versePracticeFeedback.className = "verse-practice-feedback is-wrong";
        versePracticeFeedback.textContent = "말씀과 다른 부분이 있어요. 빠지거나 더해진 말이 없는지 위 구절과 비교해 보세요.";
        versePracticeInput.focus();
        announce("쓴 구절이 말씀과 조금 달라요.");
        return;
      }

      versePracticeInput.classList.remove("is-wrong");
      versePracticeInput.classList.add("is-correct");
      versePracticeFeedback.className = "verse-practice-feedback is-correct";
      versePracticeFeedback.textContent = "성경구절 전체를 정확하게 잘 썼어요! 말씀을 한 번 소리 내어 읽어 보세요.";
      announce("성경구절 전체를 정확하게 썼습니다.");
    });

    document.querySelector("#mark-learned").addEventListener("click", () => {
      markLearned(word);
      showToast(`‘${word.term}’ 학습을 기록했어요.`);
      learnIndex = (learnIndex + 1) % dailyWords.length;
      renderLearn();
    });
    document.querySelector("#random-word").addEventListener("click", () => {
      learnIndex = (learnIndex + 1) % dailyWords.length;
      renderLearn();
    });
  }

  function createMeaningQuestion() {
    const previous = meaningQuestion?.word?.id;
    const requiresOriginal = meaningMode !== "definition";
    const word = randomWord((item) => !requiresOriginal || item.originalLanguage?.roots?.length, previous);
    const answerScript = word.originalLanguage?.roots?.[0]?.script;
    const distractors = shuffle(words.filter((item) => {
      if (item.id === word.id) return false;
      if (requiresOriginal && !item.originalLanguage?.roots?.length) return false;
      if (meaningMode !== "koreanOriginal") return true;
      const script = item.originalLanguage?.roots?.[0]?.script;
      return script && script !== answerScript;
    })).filter((item, index, items) => {
      if (meaningMode !== "koreanOriginal") return true;
      const script = item.originalLanguage?.roots?.[0]?.script;
      return items.findIndex((candidate) => candidate.originalLanguage?.roots?.[0]?.script === script) === index;
    }).slice(0, 3);
    return { word, options: shuffle([word, ...distractors]), answered: false, selectedId: null };
  }

  function meaningPrompt(word) {
    if (meaningMode === "koreanOriginal") {
      return `<span class="meaning-reference-prompt">${escapeHtml(word.term)}</span><small>${escapeHtml(word.reference)}에서 이 단어에 쓰인 대표 원어를 골라 보세요.</small>`;
    }
    if (meaningMode === "original") {
      const root = word.originalLanguage?.roots?.[0];
      return root
        ? `<span class="meaning-original-script" lang="${root.language === "히브리어" ? "he" : "grc"}" ${root.language === "히브리어" ? 'dir="rtl"' : ""}>${escapeHtml(root.script)}</span><small>${escapeHtml(root.pronunciation)} · ${escapeHtml(root.gloss)}</small>`
        : escapeHtml(word.definition);
    }
    return escapeHtml(word.definition);
  }

  function renderMeaning() {
    meaningQuestion ||= createMeaningQuestion();
    const question = meaningQuestion;
    viewRoot.innerHTML = `
      ${headerTemplate("기억 훈련", "다르게 떠올려 보기", "뜻·한글 단어·원어를 서로 연결하며 같은 말씀을 여러 길로 기억해 보세요.", true)}
      <div class="mode-tabs" role="tablist" aria-label="문제 방식 선택">
        <button type="button" role="tab" data-meaning-mode="definition" aria-selected="${meaningMode === "definition"}" class="mode-tab${meaningMode === "definition" ? " is-active" : ""}">뜻 → 단어</button>
        <button type="button" role="tab" data-meaning-mode="koreanOriginal" aria-selected="${meaningMode === "koreanOriginal"}" class="mode-tab${meaningMode === "koreanOriginal" ? " is-active" : ""}">단어 → 원어</button>
        <button type="button" role="tab" data-meaning-mode="original" aria-selected="${meaningMode === "original"}" class="mode-tab${meaningMode === "original" ? " is-active" : ""}">원어 → 단어</button>
      </div>
      <section class="quiz-card" aria-labelledby="meaning-question">
        <span class="quiz-kicker">${meaningMode === "definition" ? "이 설명에 알맞은 단어는?" : meaningMode === "koreanOriginal" ? "이 단어와 연결된 대표 원어는?" : "이 원어와 이어지는 우리말 단어는?"}</span>
        <h2 class="quiz-prompt meaning-prompt" id="meaning-question">${meaningPrompt(question.word)}</h2>
        <div class="quiz-options">
          ${question.options.map((option) => {
            const className = question.answered
              ? option.id === question.word.id ? " is-correct" : option.id === question.selectedId ? " is-wrong" : ""
              : "";
            if (meaningMode === "koreanOriginal") {
              const root = option.originalLanguage?.roots?.[0];
              return `<button class="option-button original-option${className}" type="button" data-answer="${option.id}" ${question.answered ? "disabled" : ""}><strong>${escapeHtml(root?.script || option.term)}</strong><span>${escapeHtml(root?.pronunciation || "")}</span></button>`;
            }
            return `<button class="option-button${className}" type="button" data-answer="${option.id}" ${question.answered ? "disabled" : ""}>${escapeHtml(option.term)}</button>`;
          }).join("")}
        </div>
        <div class="feedback-row">
          <p class="feedback-message ${question.answered && question.selectedId !== question.word.id ? "is-wrong" : ""}">
            ${question.answered
              ? question.selectedId === question.word.id
                ? `<strong>정답이에요!</strong> 말씀을 천천히 다시 읽어 보세요.`
                : meaningMode === "koreanOriginal"
                  ? `<strong>아쉬워요.</strong> 대표 원어는 ‘${escapeHtml(question.word.originalLanguage?.roots?.[0]?.script || "")}, ${escapeHtml(question.word.originalLanguage?.roots?.[0]?.pronunciation || "")}’입니다.`
                  : `<strong>아쉬워요.</strong> 정답은 ‘${escapeHtml(question.word.term)}’입니다. 말씀 속에서 확인해 보세요.`
              : "한 번 천천히 읽어 보세요."}
          </p>
        </div>
        ${question.answered ? `
          <aside class="answer-verse" aria-label="정답이 담긴 말씀">
            <span class="answer-verse-label">말씀으로 다시 보기</span>
            ${meaningMode === "koreanOriginal" ? `<p class="answer-original"><strong>${escapeHtml(question.word.originalLanguage?.roots?.[0]?.script || "")}</strong><span>${escapeHtml(question.word.originalLanguage?.roots?.[0]?.pronunciation || "")} · ${escapeHtml(question.word.originalLanguage?.roots?.[0]?.gloss || "")}</span></p>` : ""}
            <blockquote>${escapeHtml(question.word.verse)}</blockquote>
            <cite>${escapeHtml(question.word.reference)}</cite>
          </aside>
          <div class="quiz-next-row">
            <button class="primary-button" type="button" id="next-meaning">다음 문제</button>
          </div>` : ""}
      </section>`;

    document.querySelectorAll("[data-meaning-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        meaningMode = button.dataset.meaningMode;
        meaningQuestion = null;
        renderMeaning();
      });
    });

    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => {
        if (question.answered) return;
        question.selectedId = Number(button.dataset.answer);
        question.answered = true;
        const correct = question.selectedId === question.word.id;
        recordAnswer(correct, question.word);
        announce(correct ? "정답입니다." : `오답입니다. 정답은 ${question.word.term}입니다.`);
        renderMeaning();
      });
    });
    document.querySelector("#next-meaning")?.addEventListener("click", () => {
      meaningQuestion = createMeaningQuestion();
      renderMeaning();
    });
  }

  function createBlankQuestion() {
    const previous = blankQuestion?.word?.id;
    const word = randomWord((item) => item.verse.includes(item.term), previous);
    const distractors = shuffle(words.filter((item) => item.id !== word.id)).slice(0, 3);
    return { word, options: shuffle([word, ...distractors]), answered: false, selectedId: null };
  }

  function blankVerse(word, reveal = false) {
    if (reveal) return escapeHtml(word.verse);
    return word.verse.split(word.term).map(escapeHtml).join(`<span class="blank-word" aria-label="빈칸">?</span>`);
  }

  function memorizationPrompt(word, level) {
    const pieces = word.verse.split(/(\s+)/);
    if (level === 3) {
      let wordIndex = 0;
      return pieces.map((piece) => {
        if (/^\s+$/.test(piece)) return piece;
        const hidden = wordIndex % 2 === 1;
        wordIndex += 1;
        return hidden ? `<span class="memory-blank">＿＿＿</span>` : escapeHtml(piece);
      }).join("");
    }
    if (level === 4) {
      return pieces.map((piece) => {
        if (/^\s+$/.test(piece)) return piece;
        const letters = [...piece];
        return `<span class="memory-initial">${escapeHtml(letters[0] || "")} ${"＿".repeat(Math.max(1, letters.length - 1))}</span>`;
      }).join("");
    }
    return "말씀을 보지 않고 한 절 전체를 떠올려 보세요.";
  }

  function memorizationTabs() {
    const names = ["읽기", "핵심 빈칸", "절반 가리기", "첫 글자", "전체 암송"];
    return `<div class="memory-levels" role="tablist" aria-label="말씀 암송 단계">
      ${names.map((name, index) => `<button type="button" role="tab" data-memory-level="${index + 1}" aria-selected="${memorizationLevel === index + 1}" class="memory-level${memorizationLevel === index + 1 ? " is-active" : ""}"><strong>${index + 1}</strong><span>${name}</span></button>`).join("")}
    </div>`;
  }

  function recordingPanelTemplate() {
    const isRecording = mediaRecorder?.state === "recording";
    return `<section class="recitation-panel" aria-labelledby="recitation-title">
      <div><span class="verse-practice-kicker">소리 내어 암송</span><h3 id="recitation-title">내 목소리로 들어 보기</h3></div>
      <p>말씀을 소리 내어 말하고 바로 들어 보세요. 녹음은 서버로 전송되지 않으며 이 화면에만 잠시 머뭅니다.</p>
      <div class="recitation-actions">
        ${isRecording
          ? `<button class="record-button is-recording" type="button" id="stop-recording"><span aria-hidden="true">■</span> 녹음 마치기</button>`
          : `<button class="record-button" type="button" id="start-recording"><span aria-hidden="true">●</span> 암송 녹음</button>`}
        ${recordingUrl ? `<audio controls src="${recordingUrl}" aria-label="내 암송 녹음 재생"></audio>` : ""}
      </div>
    </section>`;
  }

  function bindRecordingControls() {
    document.querySelector("#start-recording")?.addEventListener("click", async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        showToast("이 브라우저에서는 음성 녹음을 사용할 수 없어요.");
        return;
      }
      try {
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        recordingUrl = null;
        recordedChunks = [];
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(recordingStream);
        mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data.size) recordedChunks.push(event.data);
        });
        mediaRecorder.addEventListener("stop", () => {
          recordingUrl = URL.createObjectURL(new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" }));
          recordingStream?.getTracks().forEach((track) => track.stop());
          recordingStream = null;
          mediaRecorder = null;
          if (activeView === "blank") renderBlank();
        });
        mediaRecorder.start();
        renderBlank();
        announce("암송 녹음을 시작했습니다.");
      } catch (error) {
        console.warn("Audio recording could not start", error);
        showToast("마이크 사용을 허용하면 암송을 녹음할 수 있어요.");
      }
    });
    document.querySelector("#stop-recording")?.addEventListener("click", () => mediaRecorder?.stop());
  }

  function renderBlank() {
    blankQuestion ||= createBlankQuestion();
    const question = blankQuestion;
    const advancedStage = memorizationLevel >= 3;
    viewRoot.innerHTML = `
      ${headerTemplate("단계별 말씀 암송", "한 절을 마음에 새겨요", "읽기부터 전체 암송까지 조금씩 가려 가며 개역한글 말씀을 익혀 보세요.", true)}
      ${memorizationTabs()}
      <section class="quiz-card memory-card" aria-labelledby="blank-question">
        <span class="quiz-kicker">${memorizationLevel}단계 · ${["읽기", "핵심 단어 빈칸", "절반 가리기", "첫 글자 보기", "전체 암송"][memorizationLevel - 1]}</span>
        <h2 class="quiz-prompt memory-prompt" id="blank-question">${memorizationLevel === 1 ? escapeHtml(question.word.verse) : memorizationLevel === 2 ? blankVerse(question.word, question.answered) : memorizationPrompt(question.word, memorizationLevel)}</h2>
        <p class="quiz-reference">${escapeHtml(question.word.reference)}</p>
        ${memorizationLevel === 1 ? `
          <div class="memory-stage-action"><button class="primary-button" type="button" id="memory-read-done">소리 내어 읽었어요</button></div>` : ""}
        ${memorizationLevel === 2 ? `<div class="quiz-options">
          ${question.options.map((option) => {
            const className = question.answered
              ? option.id === question.word.id ? " is-correct" : option.id === question.selectedId ? " is-wrong" : ""
              : "";
            return `<button class="option-button${className}" type="button" data-blank-answer="${option.id}" ${question.answered ? "disabled" : ""}>${escapeHtml(option.term)}</button>`;
          }).join("")}
        </div>
        <div class="feedback-row">
          <p class="feedback-message ${question.answered && question.selectedId !== question.word.id ? "is-wrong" : ""}">
            ${question.answered
              ? question.selectedId === question.word.id
                ? `<strong>말씀이 완성됐어요!</strong> 원문을 다시 읽어 보세요.`
                : `<strong>정답은 ‘${escapeHtml(question.word.term)}’</strong>입니다. 원문을 소리 내어 읽어 보세요.`
              : "구절의 흐름을 생각하면 답이 보여요."}
          </p>
          ${question.answered ? `<button class="primary-button" type="button" id="memory-next-stage">다음 단계</button>` : ""}
        </div>` : ""}
        ${advancedStage ? `
          <form class="memory-recall-form" id="memory-recall-form">
            <label class="sr-only" for="memory-recall-answer">${escapeHtml(question.word.reference)} 전체 말씀 쓰기</label>
            <textarea id="memory-recall-answer" rows="5" autocomplete="off" spellcheck="false" placeholder="기억나는 성경구절 전체를 써 보세요">${escapeHtml(question.recallAnswer || "")}</textarea>
            <div class="memory-recall-actions">
              ${memorizationLevel > 3 ? `<button class="ghost-button" type="button" id="previous-memory-stage">이전 단계 보기</button>` : `<span></span>`}
              <button class="primary-button" type="submit">전체 구절 확인</button>
            </div>
            <p class="feedback-message ${question.recallStatus === "wrong" ? "is-wrong" : ""}" role="status">${question.recallStatus === "correct" ? `<strong>정확히 암송했어요!</strong> 말씀을 마음에 잘 새겼습니다.` : question.recallStatus === "wrong" ? `<strong>조금 달라요.</strong> 이전 단계의 단서를 보고 다시 떠올려 보세요.` : "띄어쓰기와 문장부호는 채점하지 않습니다."}</p>
            ${question.recallStatus === "correct" ? `<div class="memory-finish-actions">${memorizationLevel < 5 ? `<button class="secondary-button" type="button" id="memory-next-stage">다음 단계</button>` : ""}<button class="primary-button" type="button" id="next-blank">다음 말씀</button></div>` : ""}
          </form>` : ""}
      </section>`;

    viewRoot.insertAdjacentHTML("beforeend", recordingPanelTemplate());

    document.querySelectorAll("[data-memory-level]").forEach((button) => {
      button.addEventListener("click", () => {
        memorizationLevel = Number(button.dataset.memoryLevel);
        question.answered = false;
        question.selectedId = null;
        question.recallStatus = null;
        question.recallAnswer = "";
        renderBlank();
      });
    });
    document.querySelector("#memory-read-done")?.addEventListener("click", () => {
      markLearned(question.word);
      memorizationLevel = 2;
      renderBlank();
    });

    document.querySelectorAll("[data-blank-answer]").forEach((button) => {
      button.addEventListener("click", () => {
        if (question.answered) return;
        question.selectedId = Number(button.dataset.blankAnswer);
        question.answered = true;
        const correct = question.selectedId === question.word.id;
        recordAnswer(correct, question.word);
        announce(correct ? "정답입니다. 말씀을 완성했습니다." : `오답입니다. 정답은 ${question.word.term}입니다.`);
        renderBlank();
      });
    });
    document.querySelectorAll("#memory-next-stage").forEach((button) => button.addEventListener("click", () => {
      memorizationLevel = Math.min(5, memorizationLevel + 1);
      question.answered = false;
      question.selectedId = null;
      question.recallStatus = null;
      question.recallAnswer = "";
      renderBlank();
    }));
    document.querySelector("#previous-memory-stage")?.addEventListener("click", () => {
      memorizationLevel = Math.max(1, memorizationLevel - 1);
      question.recallStatus = null;
      renderBlank();
    });
    document.querySelector("#memory-recall-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("#memory-recall-answer");
      question.recallAnswer = input.value;
      const correct = normalizePracticeText(input.value) === normalizePracticeText(question.word.verse);
      question.recallStatus = correct ? "correct" : "wrong";
      recordAnswer(correct, question.word);
      announce(correct ? "성경구절 전체를 정확히 암송했습니다." : "쓴 구절이 말씀과 조금 다릅니다.");
      renderBlank();
    });
    document.querySelector("#next-blank")?.addEventListener("click", () => {
      blankQuestion = createBlankQuestion();
      memorizationLevel = 1;
      renderBlank();
    });
    bindRecordingControls();
  }

  function createSyllableState() {
    const previous = syllableState?.word?.id;
    const word = randomWord((item) => [...item.term.replaceAll(" ", "")].length > 1, previous);
    const letters = [...word.term.replaceAll(" ", "")];
    let tiles = shuffle(letters.map((character, index) => ({ character, id: index })));
    if (tiles.map((tile) => tile.character).join("") === letters.join("")) {
      tiles = [...tiles.slice(1), tiles[0]];
    }
    return { word, tiles, selected: [], completed: false, wrong: false, hintShown: false };
  }

  function puzzleLevelTabs() {
    return `
      <div class="puzzle-level-tabs" role="tablist" aria-label="음절 퍼즐 단계 선택">
        <button type="button" role="tab" data-syllable-level="1" aria-selected="${syllableLevel === 1}" class="puzzle-level-tab${syllableLevel === 1 ? " is-active" : ""}">
          <strong>1단계</strong><span>순서 맞추기</span>
        </button>
        <button type="button" role="tab" data-syllable-level="2" aria-selected="${syllableLevel === 2}" class="puzzle-level-tab${syllableLevel === 2 ? " is-active" : ""}">
          <strong>2단계</strong><span>교차 낱말퀴즈</span>
        </button>
      </div>`;
  }

  function bindPuzzleLevelTabs() {
    document.querySelectorAll("[data-syllable-level]").forEach((button) => {
      button.addEventListener("click", () => {
        syllableLevel = Number(button.dataset.syllableLevel);
        renderSyllable();
      });
    });
  }

  function renderSyllableLevelOne() {
    syllableState ||= createSyllableState();
    const state = syllableState;
    const answerLength = [...state.word.term.replaceAll(" ", "")].length;
    const selectedTiles = state.selected.map((id) => state.tiles.find((tile) => tile.id === id));
    const slots = Array.from({ length: answerLength }, (_, index) => selectedTiles[index]?.character ?? "");

    viewRoot.innerHTML = `
      ${headerTemplate("게임 3", "음절 퍼즐", "1단계에서 순서를 익히고, 2단계에서 교차하는 성경 단어를 완성해 보세요.", true)}
      ${puzzleLevelTabs()}
      <section class="quiz-card" aria-labelledby="syllable-question">
        <span class="quiz-kicker">1단계 · 순서 맞추기</span>
        <h2 class="syllable-clue" id="syllable-question">흩어진 음절로 성경 단어를 완성하세요.</h2>
        <span class="syllable-reference">말씀 위치 · ${escapeHtml(state.word.reference)}</span>
        <div class="puzzle-hint-zone">
          <button class="hint-button" type="button" id="syllable-hint" aria-expanded="${state.hintShown}">
            <span aria-hidden="true">?</span> ${state.hintShown ? "뜻 힌트 숨기기" : "뜻 힌트 보기"}
          </button>
          ${state.hintShown ? `<p class="hint-panel"><strong>뜻 힌트</strong>${escapeHtml(state.word.definition)}</p>` : ""}
        </div>
        <div class="answer-slots" aria-label="선택한 글자">
          ${slots.map((character) => `<span class="answer-slot ${character ? "" : "is-empty"}">${escapeHtml(character || "_")}</span>`).join("")}
        </div>
        <div class="tile-bank" aria-label="고를 글자">
          ${state.tiles.map((tile) => `<button class="syllable-tile" type="button" data-tile="${tile.id}" ${state.selected.includes(tile.id) || state.completed ? "disabled" : ""}>${escapeHtml(tile.character)}</button>`).join("")}
        </div>
        <div class="syllable-actions">
          <button class="ghost-button" type="button" id="undo-tile" ${state.selected.length && !state.completed ? "" : "disabled"}>한 글자 취소</button>
          <button class="ghost-button" type="button" id="reset-tiles" ${state.selected.length && !state.completed ? "" : "disabled"}>다시 섞기</button>
        </div>
        <div class="feedback-row">
          <p class="feedback-message ${state.wrong ? "is-wrong" : ""}">
            ${state.completed
              ? `<strong>‘${escapeHtml(state.word.term)}’ 완성!</strong> ${escapeHtml(state.word.verse)}`
              : state.wrong
                ? `<strong>순서가 달라요.</strong> 한 글자 취소하고 다시 맞춰 보세요.`
                : "첫 글자부터 차례로 눌러 보세요."}
          </p>
          ${state.completed ? `<button class="primary-button" type="button" id="next-syllable">다음 퍼즐</button>` : ""}
        </div>
      </section>`;

    bindPuzzleLevelTabs();
    document.querySelector("#syllable-hint").addEventListener("click", () => {
      if (!state.hintShown) recordHint(state.word);
      state.hintShown = !state.hintShown;
      renderSyllable();
    });
    document.querySelectorAll("[data-tile]").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.completed) return;
        state.selected.push(Number(button.dataset.tile));
        state.wrong = false;
        if (state.selected.length === answerLength) {
          const answer = state.selected.map((id) => state.tiles.find((tile) => tile.id === id).character).join("");
          const correct = answer === state.word.term.replaceAll(" ", "");
          if (correct) {
            state.completed = true;
            recordAnswer(true, state.word);
            announce(`정답입니다. ${state.word.term}을 완성했습니다.`);
          } else {
            state.wrong = true;
            recordAnswer(false, state.word);
            announce("글자 순서가 맞지 않습니다.");
          }
        }
        renderSyllable();
      });
    });
    document.querySelector("#undo-tile")?.addEventListener("click", () => {
      state.selected.pop();
      state.wrong = false;
      renderSyllable();
    });
    document.querySelector("#reset-tiles")?.addEventListener("click", () => {
      state.selected = [];
      state.wrong = false;
      state.tiles = shuffle(state.tiles);
      renderSyllable();
    });
    document.querySelector("#next-syllable")?.addEventListener("click", () => {
      syllableState = createSyllableState();
      renderSyllable();
    });
  }

  function createShapePuzzleState() {
    const candidates = [];
    const pool = words
      .map((word) => ({ word, letters: [...word.term.replaceAll(" ", "")] }))
      .filter((item) => item.letters.length >= 2 && item.letters.length <= 4);

    for (let firstIndex = 0; firstIndex < pool.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < pool.length; secondIndex += 1) {
        const horizontal = pool[firstIndex];
        const vertical = pool[secondIndex];
        horizontal.letters.forEach((character, horizontalIndex) => {
          vertical.letters.forEach((verticalCharacter, verticalIndex) => {
            if (character !== verticalCharacter) return;
            const horizontalInside = horizontalIndex > 0 && horizontalIndex < horizontal.letters.length - 1;
            const verticalInside = verticalIndex > 0 && verticalIndex < vertical.letters.length - 1;
            const shape = horizontalInside && verticalInside
              ? "십자가"
              : horizontalInside || verticalInside
                ? "T자"
                : "모서리";
            candidates.push({ horizontal, vertical, horizontalIndex, verticalIndex, shape });
          });
        });
      }
    }

    const shapeOrder = ["십자가", "T자", "모서리"];
    const previousShape = shapePuzzleState?.shape;
    const wantedShape = previousShape
      ? shapeOrder[(shapeOrder.indexOf(previousShape) + 1) % shapeOrder.length]
      : "십자가";
    const preferred = candidates.filter((candidate) => candidate.shape === wantedShape);
    const previousKey = shapePuzzleState?.key;
    const available = (preferred.length ? preferred : candidates).filter((candidate) => {
      const key = `${candidate.horizontal.word.id}-${candidate.vertical.word.id}-${candidate.horizontalIndex}-${candidate.verticalIndex}`;
      return key !== previousKey;
    });
    const candidate = (available.length ? available : candidates)[Math.floor(Math.random() * (available.length || candidates.length))];
    const cellsByKey = new Map();

    function addCell(x, y, character, direction) {
      const key = `${x},${y}`;
      if (cellsByKey.has(key)) {
        cellsByKey.get(key).directions.push(direction);
        return;
      }
      cellsByKey.set(key, { key, x, y, character, directions: [direction] });
    }

    candidate.horizontal.letters.forEach((character, index) => {
      addCell(index, candidate.verticalIndex, character, "가로");
    });
    candidate.vertical.letters.forEach((character, index) => {
      addCell(candidate.horizontalIndex, index, character, "세로");
    });

    const cells = [...cellsByKey.values()].sort((first, second) => first.y - second.y || first.x - second.x);
    const tiles = shuffle(cells.map((cell, index) => ({ id: index, character: cell.character })));
    const key = `${candidate.horizontal.word.id}-${candidate.vertical.word.id}-${candidate.horizontalIndex}-${candidate.verticalIndex}`;

    return {
      key,
      shape: candidate.shape,
      horizontal: candidate.horizontal.word,
      vertical: candidate.vertical.word,
      width: candidate.horizontal.letters.length,
      height: candidate.vertical.letters.length,
      cells,
      tiles,
      placements: {},
      selectedCell: cells[0].key,
      hints: { horizontal: false, vertical: false },
      completed: false,
      wrong: false,
    };
  }

  function shapeCellCharacter(state, cellKey) {
    const tileId = state.placements[cellKey];
    return tileId === undefined ? "" : state.tiles.find((tile) => tile.id === tileId)?.character || "";
  }

  function renderShapePuzzle() {
    shapePuzzleState ||= createShapePuzzleState();
    const state = shapePuzzleState;
    const usedTileIds = Object.values(state.placements);
    const allFilled = state.cells.every((cell) => state.placements[cell.key] !== undefined);
    const clueItems = [
      { key: "horizontal", label: "가로 1", word: state.horizontal },
      { key: "vertical", label: "세로 2", word: state.vertical },
    ];

    viewRoot.innerHTML = `
      ${headerTemplate("게임 3", "음절 퍼즐", "1단계에서 순서를 익히고, 2단계에서 교차하는 성경 단어를 완성해 보세요.", true)}
      ${puzzleLevelTabs()}
      <section class="quiz-card shape-puzzle-card" aria-labelledby="shape-puzzle-title">
        <div class="shape-puzzle-topline">
          <div>
            <span class="quiz-kicker">2단계 · 모양 낱말판</span>
            <h2 class="shape-puzzle-title" id="shape-puzzle-title">두 단어가 만나는 ${escapeHtml(state.shape)} 모양</h2>
          </div>
          <span class="shape-badge">${escapeHtml(state.shape)}</span>
        </div>
        <p class="shape-instructions">빈칸을 선택한 뒤 알맞은 음절을 누르세요. 채운 칸을 다시 누르면 글자를 뺄 수 있어요.</p>
        <div class="shape-puzzle-layout">
          <div class="shape-board-wrap">
            <div class="shape-grid" style="--shape-columns:${state.width};--shape-rows:${state.height}" aria-label="${escapeHtml(state.shape)} 모양 낱말판">
              ${state.cells.map((cell) => {
                const character = shapeCellCharacter(state, cell.key);
                const wrong = state.wrong && character !== cell.character;
                const classes = [
                  "shape-cell",
                  cell.directions.length > 1 ? "is-intersection" : "",
                  state.selectedCell === cell.key && !state.completed ? "is-selected" : "",
                  wrong ? "is-wrong" : "",
                  character ? "is-filled" : "",
                ].filter(Boolean).join(" ");
                return `<button class="${classes}" type="button" data-shape-cell="${cell.key}" style="grid-column:${cell.x + 1};grid-row:${cell.y + 1}" ${state.completed ? "disabled" : ""} aria-label="${cell.directions.join("와 ")} 낱말 칸${character ? `, ${escapeHtml(character)}` : ", 빈칸"}">${escapeHtml(character || "")}</button>`;
              }).join("")}
            </div>
          </div>
          <div class="shape-clue-list">
            ${clueItems.map((item) => `
              <article class="shape-clue-card">
                <div class="shape-clue-heading">
                  <strong>${item.label}</strong>
                  <span>${escapeHtml(item.word.reference)}</span>
                </div>
                <button class="hint-button" type="button" data-shape-hint="${item.key}" aria-expanded="${state.hints[item.key]}">
                  <span aria-hidden="true">?</span> ${state.hints[item.key] ? "뜻 힌트 숨기기" : "뜻 힌트 보기"}
                </button>
                ${state.hints[item.key] ? `<p class="hint-panel shape-hint-panel"><strong>${item.label} 뜻</strong>${escapeHtml(item.word.definition)}</p>` : ""}
              </article>`).join("")}
          </div>
        </div>
        <div class="shape-tile-section">
          <span class="shape-tile-label">사용할 음절</span>
          <div class="tile-bank shape-tile-bank" aria-label="고를 음절">
            ${state.tiles.map((tile) => `<button class="syllable-tile" type="button" data-shape-tile="${tile.id}" ${usedTileIds.includes(tile.id) || state.completed ? "disabled" : ""}>${escapeHtml(tile.character)}</button>`).join("")}
          </div>
        </div>
        <div class="shape-actions">
          ${state.completed
            ? `<button class="primary-button" type="button" id="next-shape-puzzle">다음 모양</button>`
            : `<button class="ghost-button" type="button" id="reset-shape-puzzle" ${usedTileIds.length ? "" : "disabled"}>처음부터</button>
               <button class="primary-button" type="button" id="check-shape-puzzle" ${allFilled ? "" : "disabled"}>정답 확인</button>`}
        </div>
        <p class="shape-feedback ${state.wrong ? "is-wrong" : state.completed ? "is-correct" : ""}" role="status" aria-live="polite">
          ${state.completed
            ? `<strong>완성했어요!</strong> 가로 ‘${escapeHtml(state.horizontal.term)}’, 세로 ‘${escapeHtml(state.vertical.term)}’입니다.`
            : state.wrong
              ? `<strong>몇 칸이 달라요.</strong> 붉게 표시된 칸을 눌러 다시 골라 보세요.`
              : "두 단어가 공유하는 음절은 한 칸에서 만나요."}
        </p>
      </section>`;

    bindPuzzleLevelTabs();
    document.querySelectorAll("[data-shape-hint]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.shapeHint;
        if (!state.hints[key]) recordHint(key === "horizontal" ? state.horizontal : state.vertical);
        state.hints[key] = !state.hints[key];
        renderSyllable();
      });
    });
    document.querySelectorAll("[data-shape-cell]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.shapeCell;
        if (state.placements[key] !== undefined) delete state.placements[key];
        state.selectedCell = key;
        state.wrong = false;
        renderSyllable();
      });
    });
    document.querySelectorAll("[data-shape-tile]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetKey = state.selectedCell && state.placements[state.selectedCell] === undefined
          ? state.selectedCell
          : state.cells.find((cell) => state.placements[cell.key] === undefined)?.key;
        if (!targetKey) return;
        state.placements[targetKey] = Number(button.dataset.shapeTile);
        state.selectedCell = state.cells.find((cell) => state.placements[cell.key] === undefined)?.key || null;
        state.wrong = false;
        renderSyllable();
      });
    });
    document.querySelector("#reset-shape-puzzle")?.addEventListener("click", () => {
      state.placements = {};
      state.selectedCell = state.cells[0].key;
      state.tiles = shuffle(state.tiles);
      state.wrong = false;
      renderSyllable();
    });
    document.querySelector("#check-shape-puzzle")?.addEventListener("click", () => {
      const correct = state.cells.every((cell) => shapeCellCharacter(state, cell.key) === cell.character);
      recordAnswer(correct, [state.horizontal, state.vertical]);
      state.completed = correct;
      state.wrong = !correct;
      announce(correct ? `정답입니다. ${state.horizontal.term}과 ${state.vertical.term}을 완성했습니다.` : "몇 칸의 음절이 맞지 않습니다.");
      renderSyllable();
    });
    document.querySelector("#next-shape-puzzle")?.addEventListener("click", () => {
      shapePuzzleState = createShapePuzzleState();
      renderSyllable();
    });
  }

  function tryCrosswordPlacement(word, direction, crossingCell, crossingIndex, grid) {
    const letters = [...word.term.replaceAll(" ", "")];
    const dx = direction === "가로" ? 1 : 0;
    const dy = direction === "세로" ? 1 : 0;
    const startX = crossingCell.x - crossingIndex * dx;
    const startY = crossingCell.y - crossingIndex * dy;
    const beforeKey = `${startX - dx},${startY - dy}`;
    const afterKey = `${startX + letters.length * dx},${startY + letters.length * dy}`;
    if (grid.has(beforeKey) || grid.has(afterKey)) return null;

    let crossings = 0;
    const positions = [];
    for (let index = 0; index < letters.length; index += 1) {
      const x = startX + index * dx;
      const y = startY + index * dy;
      const key = `${x},${y}`;
      const existing = grid.get(key);
      if (existing) {
        if (existing.character !== letters[index] || existing.directions.includes(direction)) return null;
        crossings += 1;
      } else {
        const neighbors = direction === "가로"
          ? [`${x},${y - 1}`, `${x},${y + 1}`]
          : [`${x - 1},${y}`, `${x + 1},${y}`];
        if (neighbors.some((neighbor) => grid.has(neighbor))) return null;
      }
      positions.push({ x, y, key, character: letters[index] });
    }
    if (!crossings) return null;

    const allCells = [...grid.values(), ...positions.filter((position) => !grid.has(position.key))];
    const xs = allCells.map((cell) => cell.x);
    const ys = allCells.map((cell) => cell.y);
    const width = Math.max(...xs) - Math.min(...xs) + 1;
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    if (width > 9 || height > 9) return null;
    return {
      word,
      direction,
      startX,
      startY,
      positions,
      crossings,
      newCells: positions.filter((position) => !grid.has(position.key)).length,
      area: width * height,
    };
  }

  function addCrosswordEntry(placement, grid, entries) {
    placement.positions.forEach((position) => {
      const existing = grid.get(position.key);
      if (existing) {
        existing.directions.push(placement.direction);
        existing.wordIds.push(placement.word.id);
      } else {
        grid.set(position.key, {
          ...position,
          directions: [placement.direction],
          wordIds: [placement.word.id],
        });
      }
    });
    entries.push({
      word: placement.word,
      direction: placement.direction,
      startX: placement.startX,
      startY: placement.startY,
      positions: placement.positions,
    });
  }

  function createCrosswordState() {
    const priorityWords = [...dueWords(), ...weakWords(), ...shuffle(words)];
    const pool = priorityWords
      .filter((word, index, items) => items.findIndex((item) => item.id === word.id) === index)
      .filter((word) => {
        const length = [...word.term.replaceAll(" ", "")].length;
        return length >= 2 && length <= 4;
      });
    let best = null;

    for (let attempt = 0; attempt < 90; attempt += 1) {
      const candidates = shuffle(pool).sort((first, second) => {
        const firstLength = [...first.term.replaceAll(" ", "")].length;
        const secondLength = [...second.term.replaceAll(" ", "")].length;
        return secondLength - firstLength;
      });
      const grid = new Map();
      const entries = [];
      const seed = candidates[0];
      const seedLetters = [...seed.term.replaceAll(" ", "")];
      addCrosswordEntry({
        word: seed,
        direction: "가로",
        startX: 0,
        startY: 0,
        positions: seedLetters.map((character, index) => ({ x: index, y: 0, key: `${index},0`, character })),
      }, grid, entries);

      while (entries.length < 5) {
        const placedIds = new Set(entries.map((entry) => entry.word.id));
        const options = [];
        candidates.filter((word) => !placedIds.has(word.id)).slice(0, 45).forEach((word) => {
          const letters = [...word.term.replaceAll(" ", "")];
          grid.forEach((cell) => {
            letters.forEach((character, index) => {
              if (character !== cell.character) return;
              ["가로", "세로"].filter((direction) => !cell.directions.includes(direction)).forEach((direction) => {
                const placement = tryCrosswordPlacement(word, direction, cell, index, grid);
                if (placement) options.push(placement);
              });
            });
          });
        });
        if (!options.length) break;
        options.sort((first, second) => second.newCells - first.newCells || first.crossings - second.crossings || first.area - second.area || Math.random() - .5);
        const choice = options[Math.floor(Math.random() * Math.min(6, options.length))];
        addCrosswordEntry(choice, grid, entries);
      }

      if (!best || entries.length > best.entries.length || (entries.length === best.entries.length && grid.size > best.grid.size)) {
        best = { entries, grid };
      }
      if (entries.length === 5 && grid.size >= 12) break;
    }

    const cells = [...best.grid.values()];
    const minX = Math.min(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    const normalizedCells = cells.map((cell) => ({ ...cell, x: cell.x - minX, y: cell.y - minY, key: `${cell.x - minX},${cell.y - minY}`, startNumbers: [] }));
    const cellMap = new Map(normalizedCells.map((cell) => [cell.key, cell]));
    const normalizedEntries = best.entries.map((entry) => ({
      ...entry,
      startX: entry.startX - minX,
      startY: entry.startY - minY,
      positions: entry.positions.map((position) => ({ ...position, x: position.x - minX, y: position.y - minY, key: `${position.x - minX},${position.y - minY}` })),
    })).sort((first, second) => first.startY - second.startY || first.startX - second.startX || first.direction.localeCompare(second.direction, "ko"));

    normalizedEntries.forEach((entry, index) => {
      entry.number = index + 1;
      cellMap.get(`${entry.startX},${entry.startY}`)?.startNumbers.push(entry.number);
    });
    const width = Math.max(...normalizedCells.map((cell) => cell.x)) + 1;
    const height = Math.max(...normalizedCells.map((cell) => cell.y)) + 1;
    const tiles = shuffle(normalizedCells.map((cell, index) => ({ id: index, character: cell.character })));
    const guideEntry = normalizedEntries.reduce((bestEntry, entry) => {
      const score = entry.positions.filter((position) => cellMap.get(position.key)?.directions.length > 1).length * 10 + entry.positions.length;
      const bestScore = bestEntry.positions.filter((position) => cellMap.get(position.key)?.directions.length > 1).length * 10 + bestEntry.positions.length;
      return score > bestScore ? entry : bestEntry;
    }, normalizedEntries[0]);
    const guideCellKeys = [...new Set(guideEntry.positions.map((position) => position.key))];
    const initialPlacements = {};
    const guideTileIds = new Set();
    guideCellKeys.forEach((key) => {
      const character = cellMap.get(key)?.character;
      const tile = tiles.find((item) => item.character === character && !guideTileIds.has(item.id));
      if (!tile) return;
      initialPlacements[key] = tile.id;
      guideTileIds.add(tile.id);
    });
    const firstEmptyCell = normalizedCells
      .sort((first, second) => first.y - second.y || first.x - second.x)
      .find((cell) => initialPlacements[cell.key] === undefined);

    return {
      entries: normalizedEntries,
      cells: normalizedCells,
      width,
      height,
      tiles,
      placements: { ...initialPlacements },
      initialPlacements,
      guideWordId: guideEntry.word.id,
      guideCellKeys,
      selectedCell: firstEmptyCell?.key || null,
      hints: {},
      wrongCells: [],
      completed: false,
    };
  }

  function crosswordCellCharacter(state, cellKey) {
    const tileId = state.placements[cellKey];
    return tileId === undefined ? "" : state.tiles.find((tile) => tile.id === tileId)?.character || "";
  }

  function crosswordVerseHint(word) {
    return word.verse.split(word.term).map(escapeHtml).join('<span class="crossword-verse-blank">＿＿</span>');
  }

  function renderCrosswordPuzzle() {
    if (!shapePuzzleState?.entries) shapePuzzleState = createCrosswordState();
    const state = shapePuzzleState;
    const usedTileIds = Object.values(state.placements);
    const userPlacedCount = Object.keys(state.placements).filter((key) => state.initialPlacements[key] === undefined).length;
    const allFilled = state.cells.every((cell) => state.placements[cell.key] !== undefined);
    const boardSquares = [];
    const cellsByKey = new Map(state.cells.map((cell) => [cell.key, cell]));

    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const key = `${x},${y}`;
        const cell = cellsByKey.get(key);
        if (!cell) {
          boardSquares.push(`<span class="crossword-block" style="grid-column:${x + 1};grid-row:${y + 1}" aria-hidden="true"></span>`);
          continue;
        }
        const character = crosswordCellCharacter(state, key);
        const classes = [
          "crossword-cell",
          state.selectedCell === key && !state.completed ? "is-selected" : "",
          state.wrongCells.includes(key) ? "is-wrong" : "",
          cell.directions.length > 1 ? "is-intersection" : "",
          state.guideCellKeys.includes(key) ? "is-guide" : "",
          character ? "is-filled" : "",
        ].filter(Boolean).join(" ");
        boardSquares.push(`<button class="${classes}" type="button" data-crossword-cell="${key}" style="grid-column:${x + 1};grid-row:${y + 1}" ${state.completed || state.guideCellKeys.includes(key) ? "disabled" : ""} aria-label="${state.guideCellKeys.includes(key) ? "길잡이 낱말, " : ""}${cell.startNumbers.length ? `${cell.startNumbers.join("번과 ")}번 시작, ` : ""}${character || "빈칸"}">${cell.startNumbers.length ? `<small>${cell.startNumbers.join("·")}</small>` : ""}<span>${escapeHtml(character)}</span></button>`);
      }
    }

    viewRoot.innerHTML = `
      ${headerTemplate("게임 3", "음절 퍼즐", "1단계에서 순서를 익히고, 2단계에서 설명을 읽어 여러 성경 단어를 교차 완성해 보세요.", true)}
      ${puzzleLevelTabs()}
      <section class="quiz-card crossword-card" aria-labelledby="crossword-title">
        <div class="crossword-topline">
          <div><span class="quiz-kicker">2단계 · 말씀 낱말퀴즈</span><h2 id="crossword-title">설명을 읽고 교차 낱말판을 채워 보세요</h2></div>
          <span class="shape-badge">${state.entries.length}개 단어</span>
        </div>
        <p class="shape-instructions">가운데에 미리 채워진 길잡이 낱말을 힌트 삼아, 빈칸을 누른 뒤 음절을 골라 넣으세요.</p>
        <div class="crossword-layout">
          <div class="crossword-board-wrap">
            <div class="crossword-grid" style="--crossword-columns:${state.width};--crossword-rows:${state.height}" aria-label="설명형 성경 낱말판">
              ${boardSquares.join("")}
            </div>
          </div>
          <section class="crossword-tile-section" aria-label="사용할 음절">
            <span>빈칸에 넣을 음절</span>
            <div class="tile-bank crossword-tile-bank">
              ${state.tiles.map((tile) => `<button class="syllable-tile" type="button" data-crossword-tile="${tile.id}" ${usedTileIds.includes(tile.id) || state.completed ? "disabled" : ""}>${escapeHtml(tile.character)}</button>`).join("")}
            </div>
          </section>
          <div class="crossword-clues" aria-label="낱말 설명">
            ${state.entries.map((entry) => `
              <article class="crossword-clue${state.completed ? " is-solved" : ""}${entry.word.id === state.guideWordId ? " is-guide" : ""}">
                <div class="crossword-clue-heading"><strong>${entry.direction} ${entry.number}${entry.word.id === state.guideWordId ? `<em>길잡이</em>` : ""}</strong><span>${escapeHtml(entry.word.reference)}</span></div>
                <p>${escapeHtml(entry.word.definition)}</p>
                <button class="hint-button" type="button" data-crossword-hint="${entry.word.id}" aria-expanded="${Boolean(state.hints[entry.word.id])}"><span aria-hidden="true">?</span> ${state.hints[entry.word.id] ? "말씀 힌트 숨기기" : "말씀 힌트 보기"}</button>
                ${state.hints[entry.word.id] ? `<div class="hint-panel crossword-hint"><strong>말씀 속 힌트</strong><span>${crosswordVerseHint(entry.word)}</span></div>` : ""}
                ${state.completed ? `<div class="crossword-answer">정답 · ${escapeHtml(entry.word.term)}</div>` : ""}
              </article>`).join("")}
          </div>
        </div>
        <div class="shape-actions">
          ${state.completed
            ? `<button class="primary-button" type="button" id="next-crossword">다음 낱말판</button>`
            : `<button class="ghost-button" type="button" id="reset-crossword" ${userPlacedCount ? "" : "disabled"}>처음부터</button><button class="primary-button" type="button" id="check-crossword" ${allFilled ? "" : "disabled"}>정답 확인</button>`}
        </div>
        <p class="shape-feedback ${state.wrongCells.length ? "is-wrong" : state.completed ? "is-correct" : ""}" role="status" aria-live="polite">
          ${state.completed ? `<strong>낱말판을 완성했어요!</strong> 설명과 정답을 하나씩 다시 읽어 보세요.` : state.wrongCells.length ? `<strong>몇 칸이 달라요.</strong> 붉게 표시된 칸을 고쳐 보세요.` : "교차하는 칸에는 두 단어가 같은 음절을 함께 사용합니다."}
        </p>
      </section>`;

    bindPuzzleLevelTabs();
    document.querySelectorAll("[data-crossword-hint]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.crosswordHint);
        const entry = state.entries.find((item) => item.word.id === id);
        if (!state.hints[id]) recordHint(entry?.word);
        state.hints[id] = !state.hints[id];
        renderSyllable();
      });
    });
    document.querySelectorAll("[data-crossword-cell]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.crosswordCell;
        if (state.guideCellKeys.includes(key)) return;
        if (state.placements[key] !== undefined) delete state.placements[key];
        state.selectedCell = key;
        state.wrongCells = [];
        renderSyllable();
      });
    });
    document.querySelectorAll("[data-crossword-tile]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetKey = state.selectedCell && state.placements[state.selectedCell] === undefined
          ? state.selectedCell
          : state.cells.find((cell) => state.placements[cell.key] === undefined)?.key;
        if (!targetKey) return;
        state.placements[targetKey] = Number(button.dataset.crosswordTile);
        state.selectedCell = state.cells.find((cell) => state.placements[cell.key] === undefined)?.key || null;
        state.wrongCells = [];
        renderSyllable();
      });
    });
    document.querySelector("#reset-crossword")?.addEventListener("click", () => {
      state.placements = { ...state.initialPlacements };
      state.selectedCell = state.cells.find((cell) => state.placements[cell.key] === undefined)?.key || null;
      state.wrongCells = [];
      renderSyllable();
    });
    document.querySelector("#check-crossword")?.addEventListener("click", () => {
      state.wrongCells = state.cells.filter((cell) => crosswordCellCharacter(state, cell.key) !== cell.character).map((cell) => cell.key);
      const correct = state.wrongCells.length === 0;
      const wrongWordIds = new Set(state.wrongCells.flatMap((key) => cellsByKey.get(key)?.wordIds || []));
      recordAnswer(correct, correct ? state.entries.map((entry) => entry.word) : state.entries.filter((entry) => wrongWordIds.has(entry.word.id)).map((entry) => entry.word));
      state.completed = correct;
      announce(correct ? "설명형 말씀 낱말판을 완성했습니다." : "몇 칸의 음절이 맞지 않습니다.");
      renderSyllable();
    });
    document.querySelector("#next-crossword")?.addEventListener("click", () => {
      shapePuzzleState = createCrosswordState();
      renderSyllable();
    });
  }

  function renderSyllable() {
    if (syllableLevel === 2) renderCrosswordPuzzle();
    else renderSyllableLevelOne();
  }

  function renderProgress() {
    const learnedWords = words.filter((word) => progress.learned.includes(word.id));
    const percentage = Math.round((learnedWords.length / words.length) * 100);
    const accuracy = progress.attempts ? Math.round((progress.correct / progress.attempts) * 100) : 0;
    const categories = [...new Set(words.map((word) => word.category))];
    const reviewWords = dueWords();
    const needsPractice = weakWords().slice(0, 6);
    const weekIds = new Set();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      (progress.daily[localDateKey(date)] || []).forEach((id) => weekIds.add(id));
    }
    const weekWords = words.filter((word) => weekIds.has(word.id));

    viewRoot.innerHTML = `
      ${headerTemplate("학습 기록", "한 걸음씩 이어 온 말씀", "이 기기에서 공부한 단어와 퍼즐 기록을 모아 보여 드려요.")}
      <section class="progress-card progress-hero">
        <div class="progress-ring" style="--percent:${percentage}"><strong>${percentage}%</strong></div>
        <div>
          <h2>${learnedWords.length ? `${learnedWords.length}개 단어를 익혔어요` : "오늘 한 말씀부터 시작해 보세요"}</h2>
          <p>${displayStreak() ? "배운 말씀을 짧게 다시 만날수록 오래 기억할 수 있어요." : "쉬었다 돌아와도 괜찮아요. 오늘의 한 절이 새로운 시작입니다."}</p>
        </div>
      </section>
      <div class="stat-grid">
        <div class="stat-card"><span>연속 학습</span><strong>${displayStreak()}일</strong></div>
        <div class="stat-card"><span>퍼즐 정답률</span><strong>${accuracy}%</strong></div>
        <div class="stat-card"><span>맞힌 문제</span><strong>${progress.correct}개</strong></div>
      </div>

      <h2 class="section-title">오늘 돌아볼 말씀</h2>
      <section class="progress-card review-summary">
        <div><strong>${reviewWords.length ? `${reviewWords.length}개가 복습을 기다려요` : "오늘 복습은 가볍게 끝났어요"}</strong><p>${reviewWords.length ? "잊기 쉬운 시점에 다시 만나도록 1·3·7·14·30일 간격으로 골랐어요." : "새 단어를 배우거나, 마음에 남은 말씀을 다시 읽어 보세요."}</p></div>
        <button class="secondary-button" type="button" id="start-due-review">${reviewWords.length ? "맞춤 복습 시작" : "오늘의 말씀 보기"}</button>
        ${reviewWords.length ? `<div class="learned-words review-word-list">${reviewWords.slice(0, 8).map((word) => `<span class="learned-word">${escapeHtml(word.term)}</span>`).join("")}</div>` : ""}
      </section>

      <div class="progress-insight-grid">
        <section class="progress-card progress-insight">
          <h2>조금 더 익힐 단어</h2>
          <p>틀렸거나 힌트를 자주 본 단어를 먼저 보여 드려요.</p>
          ${needsPractice.length ? `<div class="learned-words">${needsPractice.map((word) => `<span class="learned-word">${escapeHtml(word.term)}</span>`).join("")}</div>` : `<p class="empty-note">문제를 풀면 맞춤 목록이 생겨요.</p>`}
        </section>
        <section class="progress-card progress-insight">
          <h2>이번 주 마음에 새긴 말씀</h2>
          <p>${weekWords.length ? `${weekWords.length}개 단어와 연결된 말씀을 만났어요.` : "이번 주 첫 말씀을 천천히 만나 보세요."}</p>
          ${weekWords.length ? `<div class="learned-words">${weekWords.slice(0, 8).map((word) => `<span class="learned-word">${escapeHtml(word.term)}</span>`).join("")}</div>` : ""}
        </section>
      </div>

      <h2 class="section-title">분야별 학습</h2>
      <section class="progress-card category-progress">
        ${categories.map((category) => {
          const categoryWords = words.filter((word) => word.category === category);
          const count = categoryWords.filter((word) => progress.learned.includes(word.id)).length;
          const percent = Math.round((count / categoryWords.length) * 100);
          return `<div class="category-row"><span>${escapeHtml(category)}</span><div class="progress-track"><span style="width:${percent}%"></span></div><strong>${count}/${categoryWords.length}</strong></div>`;
        }).join("")}
      </section>

      <h2 class="section-title">내가 익힌 단어</h2>
      <section class="progress-card">
        ${learnedWords.length
          ? `<div class="learned-words">${learnedWords.map((word) => `<span class="learned-word">${escapeHtml(word.term)}</span>`).join("")}</div>`
          : `<p class="empty-note">아직 기록된 단어가 없습니다.</p>`}
        <div class="danger-zone"><button class="ghost-button" type="button" id="reset-progress">학습 기록 초기화</button></div>
      </section>`;

    document.querySelector("#start-due-review")?.addEventListener("click", () => {
      activeJourneyKey = "daily";
      dailyWords = personalizedDailyWords();
      learnIndex = 0;
      navigate("learn");
    });

    document.querySelector("#reset-progress").addEventListener("click", () => {
      if (!window.confirm("이 기기에 저장된 학습 기록을 모두 지울까요?")) return;
      progress = defaultProgress();
      saveProgress();
      meaningQuestion = null;
      blankQuestion = null;
      syllableState = null;
      shapePuzzleState = null;
      syllableLevel = 1;
      showToast("학습 기록을 초기화했습니다.");
      renderProgress();
    });
  }

  function renderError() {
    loadingCard.hidden = true;
    viewRoot.hidden = false;
    viewRoot.innerHTML = `
      <section class="error-card" role="alert">
        <span class="loading-symbol" aria-hidden="true">!</span>
        <strong>단어 자료를 불러오지 못했어요</strong>
        <span>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</span>
        <button class="primary-button" type="button" id="retry-load">다시 시도</button>
      </section>`;
    document.querySelector("#retry-load").addEventListener("click", initialise);
  }

  async function initialise() {
    try {
      const response = await fetch("./data/words.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
      dataset = await response.json();
      words = dataset.words;
      dailyWords = personalizedDailyWords();
      const firstIncomplete = dailyWords.findIndex((word) => !progress.learned.includes(word.id));
      learnIndex = firstIncomplete >= 0 ? firstIncomplete : 0;
      loadingCard.hidden = true;
      viewRoot.hidden = false;
      updateSidebar();
      navigate(activeView, false);
      registerWebMcpTools();
    } catch (error) {
      console.error(error);
      renderError();
    }
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool || registerWebMcpTools.registered) return;
    registerWebMcpTools.registered = true;
    const lifecycle = new AbortController();

    const tools = [
      {
        name: "get_learning_progress",
        title: "학습 기록 보기",
        description: "현재 기기에 저장된 말씀잇기 단어 학습과 퍼즐 기록을 읽습니다.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return {
            learnedWords: progress.learned.length,
            totalWords: words.length,
            correctAnswers: progress.correct,
            attempts: progress.attempts,
            streakDays: displayStreak(),
          };
        },
      },
      {
        name: "start_word_activity",
        title: "말씀 활동 시작",
        description: "단어 학습이나 뜻, 빈칸, 음절 퍼즐 화면을 엽니다.",
        inputSchema: {
          type: "object",
          properties: { mode: { type: "string", enum: ["learn", "meaning", "blank", "syllable"] } },
          required: ["mode"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || !["learn", "meaning", "blank", "syllable"].includes(input.mode)) throw new Error("지원하지 않는 활동입니다.");
          navigate(input.mode);
          return { opened: input.mode, title: VIEW_TITLES[input.mode] };
        },
      },
      {
        name: "mark_word_learned",
        title: "단어 학습 완료",
        description: "말씀잇기의 성경 단어 하나를 오늘 학습한 것으로 기록합니다.",
        inputSchema: {
          type: "object",
          properties: { term: { type: "string", minLength: 1 } },
          required: ["term"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const word = words.find((item) => item.term === input?.term);
          if (!word) throw new Error("말씀잇기 단어 목록에 없는 단어입니다.");
          markLearned(word);
          navigate("progress");
          return { term: word.term, learned: true, learnedWords: progress.learned.length };
        },
      },
    ];

    tools.forEach((tool) => {
      try {
        Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(console.warn);
      } catch (error) {
        console.warn("WebMCP tool registration failed", error);
      }
    });
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.view));
  });
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.go));
  });

  window.addEventListener("hashchange", () => {
    const nextView = readHash();
    if (nextView !== activeView) navigate(nextView, false);
  });

  const aboutDialog = document.querySelector("#about-dialog");
  document.querySelector("#about-button").addEventListener("click", () => aboutDialog.showModal());

  const fontSizeButton = document.querySelector("#font-size-button");
  const largeTextEnabled = localStorage.getItem("malsseum-itgi-large-text") === "true";
  document.body.classList.toggle("large-text", largeTextEnabled);
  fontSizeButton.setAttribute("aria-pressed", String(largeTextEnabled));
  fontSizeButton.addEventListener("click", () => {
    const enabled = !document.body.classList.contains("large-text");
    document.body.classList.toggle("large-text", enabled);
    fontSizeButton.setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("malsseum-itgi-large-text", String(enabled));
    showToast(enabled ? "글자를 크게 표시합니다." : "글자를 기본 크기로 표시합니다.");
  });

  const connectionPill = document.querySelector("#connection-pill");
  const connectionLabel = document.querySelector("#connection-label");
  function updateConnection() {
    connectionPill.classList.toggle("is-offline", !navigator.onLine);
    connectionLabel.textContent = navigator.onLine ? "온라인" : "오프라인";
  }
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
  updateConnection();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    document.querySelector("#install-button").hidden = false;
  });
  document.querySelector("#install-button").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    document.querySelector("#install-button").hidden = true;
  });
  window.addEventListener("appinstalled", () => showToast("말씀잇기를 설치했습니다."));

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.warn));
  }

  initialise();
})();
