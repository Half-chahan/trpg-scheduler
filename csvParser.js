// csvParser.js

/**
 * CSV テキストを解析して日程データを作成する
 * 期待する形式:
 * - どこかに「日程,参加者1,参加者2,...」という行がある
 * - その下に「3/1(日),◯,×,...」のような行が続く
 * - 「コメント」などの行は無視
 */
export function parseScheduleCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error("CSV が空です。");
  }

  // 「日程」という文字が先頭のヘッダ行を探す
  let headerIndex = -1;
  let headerCells = null;

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const first = (cells[0] || "").trim();
    if (first === "日程") {
      headerIndex = i;
      headerCells = cells;
      break;
    }
  }

  if (headerIndex === -1 || !headerCells) {
    throw new Error('「日程」というヘッダ行が見つかりませんでした。');
  }

  // 参加者名を抽出（1列目以降で、空でないセル）
  const participants = [];
  for (let col = 1; col < headerCells.length; col++) {
    const name = (headerCells[col] || "").trim();
    if (!name) continue;
    if (name.indexOf("コメント") !== -1) continue;
    participants.push(name);
  }

  if (participants.length === 0) {
    throw new Error("参加者名が抽出できませんでした。");
  }

  const days = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const first = (cells[0] || "").trim();

    if (!first) continue;
    if (first.indexOf("コメント") !== -1) {
      // コメント行以降は無視
      continue;
    }

    const rawDate = first; // 例: 3/1(日)
    const { isWeekend, dayType } = analyzeDateCell(rawDate);
    const { month, day } = parseMonthDay(rawDate);
    const dateKey = createDateKeyFromParts(month, day);

    // 参加者ごとの記号
    const availability = {};
    participants.forEach((pName, idx) => {
      const sym = normalizeSymbol((cells[idx + 1] || "").trim());
      availability[pName] = sym;
    });

    days.push({
      rawDate,
      isWeekend,     // 元々の曜日ベース (土日)
      dayType,       // "平日" or "休日"
      dateKey,       // 月*100 + 日
      month,         // 数字の月
      day,           // 数字の日
      availability,
    });
  }

  if (days.length === 0) {
    throw new Error("日程データ行が見つかりませんでした。");
  }

  return {
    participants,
    days,
  };
}

/**
 * シンプルな CSV 行の split（引用符を使わない前提）
 */
function splitCsvLine(line) {
  return line.split(",");
}

/**
 * 記号の正規化
 * - ◯ / ○ -> "○"
 * - △ -> "△"
 * - それ以外 / 空 -> "×"
 */
function normalizeSymbol(sym) {
  if (sym === "◯" || sym === "○") return "○";
  if (sym === "△") return "△";
  return "×";
}

/**
 * 「3/1(日)」などから「平日 or 休日（元の曜日）」を判定
 */
function analyzeDateCell(raw) {
  const m = raw.match(/[（(]([日月火水木金土])[）)]/);
  const dow = m ? m[1] : null;

  if (dow === "土" || dow === "日") {
    return { isWeekend: true, dayType: "休日" };
  }
  return { isWeekend: false, dayType: "平日" };
}

/**
 * "3/1(日)" などから { month, day } を取り出す
 */
function parseMonthDay(raw) {
  const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { month: null, day: null };
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  if (Number.isNaN(month) || Number.isNaN(day)) {
    return { month: null, day: null };
  }
  return { month, day };
}

/**
 * 月と日からソート用キーを作る
 */
function createDateKeyFromParts(month, day) {
  if (month == null || day == null) return Number.MAX_SAFE_INTEGER;
  return month * 100 + day;
}
