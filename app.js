// app.js
import { parseScheduleCsv } from "./csvParser.js";
import { computeNonHoResults, computeHoResults, sortResults } from "./scheduler.js";

const state = {
  csvParsed: null,     // { participants, days } （複数 CSV をマージした結果）
  isHo: null,          // true / false
  plCount: null,       // HO なし時のみ
  kpNames: [],         // 選択された KP
  plCandidates: [],    // HO なし時の PL 候補
  hoList: [],          // HO 制時 [{ label, suffix, candidates }]
  requiredHours: null,
  weekdayHours: 3,
  weekendHours: 15,
  rawResults: [],
  sortMode: "holidayFirst",
  allowDelta: true,    // △ を候補に含めるかどうか
  searchAborted: false // 探索ステップ上限により途中打ち切りされたか
};

// DOM 要素取得
const screens = {
  upload: document.getElementById("screen-upload"),
  hoQuestion: document.getElementById("screen-ho-question"),
  plCount: document.getElementById("screen-pl-count"),
  selectKp: document.getElementById("screen-select-kp"),
  selectPl: document.getElementById("screen-select-pl"),
  selectHo: document.getElementById("screen-select-ho"),
  duration: document.getElementById("screen-duration"),
  results: document.getElementById("screen-results"),
};

const csvInput = document.getElementById("csvInput");
const uploadMessage = document.getElementById("uploadMessage");

const btnHoYes = document.getElementById("btnHoYes");
const btnHoNo = document.getElementById("btnHoNo");

const plCountInput = document.getElementById("plCountInput");
const btnPlCountNext = document.getElementById("btnPlCountNext");
const plCountDisplay = document.getElementById("plCountDisplay");

const kpList = document.getElementById("kpList");
const btnKpNext = document.getElementById("btnKpNext");

const plList = document.getElementById("plList");
const btnPlNext = document.getElementById("btnPlNext");

const hoContainer = document.getElementById("hoContainer");
const btnAddHo = document.getElementById("btnAddHo");
const btnHoNext = document.getElementById("btnHoNext");

const durationInput = document.getElementById("durationInput");
const weekdayHoursInput = document.getElementById("weekdayHoursInput");
const weekendHoursInput = document.getElementById("weekendHoursInput");
const manualHolidaysInput = document.getElementById("manualHolidaysInput");
const maxResultsSelect = document.getElementById("maxResultsSelect");
const deltaIncludeRadio = document.getElementById("deltaInclude");
const deltaExcludeRadio = document.getElementById("deltaExclude");
const btnRunSearch = document.getElementById("btnRunSearch");

const sortModeSelect = document.getElementById("sortModeSelect");
const resultArea = document.getElementById("resultArea");
const resultCount = document.getElementById("resultCount");
const btnRestart = document.getElementById("btnRestart");

// 共通：画面切り替え
function showScreen(name) {
  Object.values(screens).forEach((sec) => sec.classList.remove("active"));
  const target = screens[name];
  if (target) {
    target.classList.add("active");
  }
}

// 初期化
function resetState() {
  state.csvParsed = null;
  state.isHo = null;
  state.plCount = null;
  state.kpNames = [];
  state.plCandidates = [];
  state.hoList = [];
  state.requiredHours = null;
  state.weekdayHours = 3;
  state.weekendHours = 15;
  state.rawResults = [];
  state.sortMode = "holidayFirst";
  state.allowDelta = true;
  state.searchAborted = false;

  uploadMessage.textContent = "";
  uploadMessage.style.color = "#c00";
  plCountInput.value = "";
  kpList.innerHTML = "";
  plList.innerHTML = "";
  hoContainer.innerHTML = "";
  durationInput.value = "";
  if (weekdayHoursInput) {
    weekdayHoursInput.value = "3";
  }
  if (weekendHoursInput) {
    weekendHoursInput.value = "15";
  }
  manualHolidaysInput.value = "";
  if (maxResultsSelect) {
    maxResultsSelect.value = "500";
  }
  if (deltaIncludeRadio && deltaExcludeRadio) {
    deltaIncludeRadio.checked = true;
    deltaExcludeRadio.checked = false;
  }
  resultArea.innerHTML = "";
  resultCount.textContent = "";
  sortModeSelect.value = "holidayFirst";

  showScreen("upload");
}

// ファイルをテキストで読む Promise
// Excel の「CSV(コンマ区切り)」= Shift_JIS を想定して "shift_jis" で読む
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`${file.name} の読み込みに失敗しました。`));
    reader.readAsText(file, "shift_jis");
  });
}

// 複数の parse 結果をマージする
function mergeParsedList(parsedList) {
  const participantSet = new Set();
  parsedList.forEach((p) => {
    p.participants.forEach((name) => participantSet.add(name));
  });

  const participants = Array.from(participantSet);
  const days = [];

  parsedList.forEach((p) => {
    p.days.forEach((d) => {
      const availability = {};
      participants.forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(d.availability, name)) {
          availability[name] = d.availability[name];
        } else {
          availability[name] = "×";
        }
      });
      days.push({
        rawDate: d.rawDate,
        isWeekend: d.isWeekend,
        dayType: d.dayType,
        dateKey: d.dateKey,
        month: d.month,
        day: d.day,
        availability,
      });
    });
  });

  // 日付順にソート（同日の重複があればそのまま並ぶ）
  days.sort((a, b) => a.dateKey - b.dateKey);

  return { participants, days };
}

// CSV アップロード（複数ファイル対応）
csvInput.addEventListener("change", async () => {
  const files = Array.from(csvInput.files || []);
  if (!files.length) return;

  uploadMessage.style.color = "#0066aa";
  uploadMessage.textContent = "読み込み中...";

  try {
    const texts = await Promise.all(files.map((f) => readFileAsText(f)));
    const parsedList = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const file = files[i];
      try {
        const parsed = parseScheduleCsv(text);
        parsedList.push(parsed);
      } catch (err) {
        throw new Error(`${file.name} の解析に失敗しました: ${err.message}`);
      }
    }

    const merged = mergeParsedList(parsedList);
    state.csvParsed = merged;

    uploadMessage.style.color = "#0066aa";
    uploadMessage.textContent =
      `読み込み成功：ファイル ${files.length} 件、参加者 ${merged.participants.length} 名、日程 ${merged.days.length} 日`;

    // 次の画面へ
    setTimeout(() => {
      showScreen("hoQuestion");
    }, 300);
  } catch (err) {
    console.error(err);
    uploadMessage.style.color = "#c00";
    uploadMessage.textContent = err.message || "CSV の読み込みに失敗しました。";
  }
});

// HO 質問
btnHoYes.addEventListener("click", () => {
  state.isHo = true;
  setupKpSelection();
  showScreen("selectKp");
});

btnHoNo.addEventListener("click", () => {
  state.isHo = false;
  showScreen("plCount");
});

// PL 数入力（HO なし）
btnPlCountNext.addEventListener("click", () => {
  const value = parseInt(plCountInput.value, 10);
  const participants = state.csvParsed?.participants || [];
  if (Number.isNaN(value) || value <= 0) {
    alert("1 以上の PL 数を入力してください。");
    return;
  }
  if (value >= participants.length) {
    alert("PL 数は参加者総数より少なくしてください。（KP を含めるため）");
    return;
  }

  state.plCount = value;
  plCountDisplay.textContent = `${value} 人`;
  setupKpSelection();
  showScreen("selectKp");
});

// KP 選択画面のセットアップ
function setupKpSelection() {
  kpList.innerHTML = "";
  const participants = state.csvParsed?.participants || [];
  if (!participants.length) return;

  participants.forEach((name, index) => {
    const id = `kp_${index}`;
    const div = document.createElement("div");
    div.className = "name-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.value = name;

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = name;

    div.appendChild(checkbox);
    div.appendChild(label);
    kpList.appendChild(div);
  });
}

// KP 選択決定
btnKpNext.addEventListener("click", () => {
  const checked = Array.from(
    kpList.querySelectorAll("input[type=checkbox]:checked")
  ).map((el) => el.value);

  if (checked.length === 0) {
    alert("KP を少なくとも 1 名選択してください。");
    return;
  }
  state.kpNames = checked;

  const participants = state.csvParsed.participants;
  const others = participants.filter((p) => !state.kpNames.includes(p));

  if (!state.isHo) {
    // HO なし → PL 候補選択
    if (others.length === 0) {
      alert("KP 以外の参加者がいないため PL を選べません。");
      return;
    }
    state.plCandidates = others;
    setupPlSelection();
    showScreen("selectPl");
  } else {
    // HO 制 → HO 設定画面
    setupHoInitial(others);
    showScreen("selectHo");
  }
});

// PL 選択画面
function setupPlSelection() {
  plList.innerHTML = "";
  state.plCandidates.forEach((name, index) => {
    const id = `pl_${index}`;
    const div = document.createElement("div");
    div.className = "name-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.value = name;

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = name;

    div.appendChild(checkbox);
    div.appendChild(label);
    plList.appendChild(div);
  });
}

// PL 候補決定
btnPlNext.addEventListener("click", () => {
  const selected = Array.from(
    plList.querySelectorAll("input[type=checkbox]:checked")
  ).map((el) => el.value);

  if (selected.length === 0) {
    alert("PL 候補を少なくとも 1 名選択してください。");
    return;
  }
  if (selected.length < state.plCount) {
    alert("PL 候補が PL 数より少ないため、組み合わせが作れません。");
    return;
  }

  // 実際の plCandidates は選択された人に絞る
  state.plCandidates = selected;

  showScreen("duration");
});

// HO 初期設定（HO1）
function setupHoInitial(others) {
  state.hoList = [];
  hoContainer.innerHTML = "";
  if (!others.length) {
    alert("KP 以外の参加者がいないため HO を設定できません。");
    return;
  }
  addHoBlock(1, others);
}

// HO ブロックの追加
function addHoBlock(index, candidatesSource) {
  const suffixDefault = String(index);

  const ho = {
    label: `HO${suffixDefault}`,  // 実際に使うラベル
    suffix: suffixDefault,        // 入力欄に表示する部分
    candidates: [],               // この HO に割り当て可能な PL 候補（チェック後に更新）
  };
  state.hoList.push(ho);

  const block = document.createElement("div");
  block.className = "ho-block";
  block.dataset.hoIndex = String(state.hoList.length - 1);

  const header = document.createElement("div");
  header.className = "ho-header";

  const prefixSpan = document.createElement("span");
  prefixSpan.className = "ho-label-prefix";
  prefixSpan.textContent = "HO";

  const suffixInput = document.createElement("input");
  suffixInput.type = "text";
  suffixInput.className = "ho-name-input";
  suffixInput.value = suffixDefault;

  suffixInput.addEventListener("input", () => {
    ho.suffix = suffixInput.value || suffixDefault;
    ho.label = "HO" + ho.suffix;
  });

  header.appendChild(prefixSpan);
  header.appendChild(suffixInput);

  const candidateList = document.createElement("div");
  candidateList.className = "name-list";

  candidatesSource.forEach((name, idx) => {
    const id = `ho_${index}_${idx}`;
    const row = document.createElement("div");
    row.className = "name-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.value = name;

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = name;

    row.appendChild(checkbox);
    row.appendChild(label);
    candidateList.appendChild(row);
  });

  block.appendChild(header);
  block.appendChild(candidateList);
  hoContainer.appendChild(block);
}

// HO 追加ボタンクリック
btnAddHo.addEventListener("click", () => {
  const participants = state.csvParsed?.participants || [];
  const others = participants.filter((p) => !state.kpNames.includes(p));
  const nextIndex = state.hoList.length + 1;
  addHoBlock(nextIndex, others);
});

// HO 候補決定 → 所要時間画面へ
btnHoNext.addEventListener("click", () => {
  const blocks = Array.from(hoContainer.querySelectorAll(".ho-block"));
  if (blocks.length === 0) {
    alert("少なくとも 1 つの HO を追加してください。");
    return;
  }

  for (const block of blocks) {
    const idx = parseInt(block.dataset.hoIndex, 10);
    const ho = state.hoList[idx];
    const selected = Array.from(
      block.querySelectorAll("input[type=checkbox]:checked")
    ).map((el) => el.value);

    if (selected.length === 0) {
      alert(ho.label + " に 1 人以上の候補を選択してください。");
      return;
    }

    ho.candidates = selected.slice();
  }

  showScreen("duration");
});

// 手動祝日のパース
function parseManualHolidays(text) {
  const result = [];
  if (!text) return result;

  const parts = text.split(/[、,\s]+/);
  for (const part of parts) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) continue;
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (Number.isNaN(month) || Number.isNaN(day)) continue;
    result.push({ month, day });
  }
  return result;
}

// 所要時間 → 検索実行
btnRunSearch.addEventListener("click", () => {
  const hours = parseInt(durationInput.value, 10);
  if (Number.isNaN(hours) || hours <= 0) {
    alert("1 以上の所要時間を入力してください。");
    return;
  }

  const weekdayHours = parseInt(weekdayHoursInput?.value, 10);
  if (Number.isNaN(weekdayHours) || weekdayHours <= 0) {
    alert("1 以上の平日時間を入力してください。");
    return;
  }

  const weekendHours = parseInt(weekendHoursInput?.value, 10);
  if (Number.isNaN(weekendHours) || weekendHours <= 0) {
    alert("1 以上の休日時間を入力してください。");
    return;
  }

  if (!state.csvParsed) {
    alert("先に CSV を読み込んでください。");
    return;
  }

  state.requiredHours = hours;
  state.weekdayHours = weekdayHours;
  state.weekendHours = weekendHours;
  state.searchAborted = false;

  // △ の扱い
  const allowDelta =
    deltaIncludeRadio && deltaIncludeRadio.checked ? true : false;
  state.allowDelta = allowDelta;

  // 最大件数の取得
  let maxResults;
  const limitValue = maxResultsSelect?.value || "500";
  if (limitValue === "none") {
    maxResults = Infinity;
  } else {
    const parsed = parseInt(limitValue, 10);
    maxResults = Number.isNaN(parsed) || parsed <= 0 ? Infinity : parsed;
  }

  const manualHolidayList = parseManualHolidays(
    manualHolidaysInput.value || ""
  );

  const originalDays = state.csvParsed.days;

  // 2,3,8,9 月 & 手動祝日を休日扱いにした「有効な isWeekend/dayType」を付与した日データを作成
  const days = originalDays.map((d) => {
    const isLongVacation =
      d.month === 2 || d.month === 3 || d.month === 8 || d.month === 9;
    const isManualHoliday = manualHolidayList.some(
      (h) => h.month === d.month && h.day === d.day
    );

    const effectiveIsWeekend = d.isWeekend || isLongVacation || isManualHoliday;
    const effectiveDayType = effectiveIsWeekend ? "休日" : "平日";

    return {
      ...d,
      isWeekend: effectiveIsWeekend,
      dayType: effectiveDayType,
    };
  });

  // 探索ステップ上限（現状は内部デフォルト任せ。必要ならここから値を渡してもよい）
  const searchLimit = undefined;

  let computeResult;
  if (!state.isHo) {
    computeResult = computeNonHoResults({
      days,
      kpNames: state.kpNames,
      plCandidates: state.plCandidates,
      plCount: state.plCount,
      requiredHours: state.requiredHours,
      weekdayHours: state.weekdayHours,
      weekendHours: state.weekendHours,
      maxResults,
      allowDelta,
      searchLimit,
    });
  } else {
    computeResult = computeHoResults({
      days,
      kpNames: state.kpNames,
      hoList: state.hoList,
      requiredHours: state.requiredHours,
      weekdayHours: state.weekdayHours,
      weekendHours: state.weekendHours,
      maxResults,
      allowDelta,
      searchLimit,
    });
  }

  state.rawResults = computeResult.results;
  state.searchAborted = computeResult.aborted;

  renderResults(maxResults);
  showScreen("results");
});

// 並べ替え変更
sortModeSelect.addEventListener("change", () => {
  state.sortMode = sortModeSelect.value;
  renderResults();
});

// 結果描画
function renderResults(maxResultsForDisplay) {
  const results = sortResults(state.rawResults, state.sortMode);
  resultArea.innerHTML = "";

  if (!results.length) {
    let msg = "条件に合致する日程は見つかりませんでした。";
    if (state.searchAborted) {
      msg += "\n（探索ステップが上限に達したため、途中で打ち切っています）";
    }
    resultArea.textContent = msg;
    resultCount.textContent = "";
    return;
  }

  let baseText = `${results.length} 件の候補`;
  if (
    typeof maxResultsForDisplay === "number" &&
    isFinite(maxResultsForDisplay) &&
    results.length >= maxResultsForDisplay
  ) {
    baseText += `（上限 ${maxResultsForDisplay} 件まで表示）`;
  }
  if (state.searchAborted) {
    baseText += "／探索途中で打ち切り";
  }
  resultCount.textContent = baseText;

  const table = document.createElement("table");
  table.className = "result-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["日付", "種別", "メンバー構成", "メモ"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const r of results) {
    const tr = document.createElement("tr");

    // 日付列：範囲ではなく全日程を列挙
    const tdDate = document.createElement("td");
    const dateLines = r.days.map((d) => d.rawDate);
    tdDate.textContent = dateLines.join("\n"); // 1 日ごとに改行
    tr.appendChild(tdDate);

    // 種別（休日 / 平日 / 混合）
    const tdType = document.createElement("td");
    let numWeekend = 0;
    let numWeekday = 0;
    r.days.forEach((d) => {
      if (d.isWeekend) numWeekend++;
      else numWeekday++;
    });

    let typeLabel = "";
    let badgeClass = "";
    if (numWeekend > 0 && numWeekday === 0) {
      typeLabel = "休日のみ";
      badgeClass = "holiday";
    } else if (numWeekend === 0 && numWeekday > 0) {
      typeLabel = "平日のみ";
      badgeClass = "weekday";
    } else {
      typeLabel = "休日 + 平日";
      badgeClass = "holiday";
    }

    const badge = document.createElement("span");
    badge.className = "badge " + badgeClass;
    badge.textContent = typeLabel;
    tdType.appendChild(badge);

    const detail = document.createElement("div");
    detail.textContent = `（休日 ${numWeekend} 日 / 平日 ${numWeekday} 日）`;
    tdType.appendChild(detail);

    tr.appendChild(tdType);

    // メンバー構成
    const tdMembers = document.createElement("td");
    const kpText = `KP: ${r.kpNames.join("、")}`;
    let bodyText = kpText;

    if (r.mode === "nonHo") {
      const plText = `PL: ${r.plGroup.join("、")}`;
      bodyText += "\n" + plText;
    } else if (r.mode === "ho") {
      const hoLines = Object.entries(r.hoAssignments).map(
        ([label, name]) => `${label}: ${name}`
      );
      bodyText += "\n" + hoLines.join("\n");
    }

    bodyText += `\n日数: ${r.days.length} 日`;

    if (r.isContinuousSpan === false) {
      bodyText += "\n（間に日程の空きあり）";
    }

    tdMembers.textContent = bodyText;
    tr.appendChild(tdMembers);

    // メモ（△ 含むかなど）
    const tdMemo = document.createElement("td");
    if (r.usesDelta) {
      const deltaBadge = document.createElement("span");
      deltaBadge.className = "badge delta";
      deltaBadge.textContent = "△ を含む候補";
      tdMemo.appendChild(deltaBadge);
    } else {
      tdMemo.textContent = "全員 ◯";
    }
    tr.appendChild(tdMemo);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  resultArea.appendChild(table);
}

// 最初から
btnRestart.addEventListener("click", () => {
  resetState();
  csvInput.value = ""; // ファイル入力もクリア
});

// ページロード時に初期化
resetState();
