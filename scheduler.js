// scheduler.js

// 日程候補探索の「安全弁」用ステップ上限
// これ以上バックトラックを回したら、探索を打ち切る
const DEFAULT_SEARCH_STEP_LIMIT = 150000;

/**
 * 1 日あたりの時間枠
 * isWeekend が true の日を 15 時間、それ以外を 3 時間として扱う
 */
function dayCapacity(day) {
  return day.isWeekend ? 15 : 3;
}

/**
 * ある日付で、指定メンバー全員が ×（または △ 禁止時の △）でないかどうか
 * allowDelta が false の場合、△ も × 扱いにする
 * 戻り値: { ok: boolean, usesDelta: boolean }
 */
function checkAvailabilityForGroup(day, memberNames, allowDelta) {
  let usesDelta = false;
  for (const name of memberNames) {
    const sym = day.availability[name] || "×";
    if (sym === "×") {
      return { ok: false, usesDelta: false };
    }
    if (sym === "△") {
      if (!allowDelta) {
        // △ を許可しないなら × 扱い
        return { ok: false, usesDelta: false };
      }
      usesDelta = true;
    }
  }
  return { ok: true, usesDelta };
}

/**
 * 複数日程にまたがる場合のチェック
 */
function checkAvailabilityForGroupMulti(days, memberNames, allowDelta) {
  let usesDelta = false;
  for (const day of days) {
    const res = checkAvailabilityForGroup(day, memberNames, allowDelta);
    if (!res.ok) {
      return { ok: false, usesDelta: false };
    }
    if (res.usesDelta) {
      usesDelta = true;
    }
  }
  return { ok: true, usesDelta };
}

/**
 * 組み合わせ生成（配列 arr から k 個選ぶ）
 */
function combinations(arr, k) {
  const result = [];
  const n = arr.length;
  if (k <= 0 || k > n) return result;

  function backtrack(start, chosen) {
    if (chosen.length === k) {
      result.push(chosen.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(arr[i]);
      backtrack(i + 1, chosen);
      chosen.pop();
    }
  }

  backtrack(0, []);
  return result;
}

/**
 * 所要時間を満たす「日程の集合」を作る
 * - days: 全日程（isWeekend などは already adjusted）
 * - requiredHours: 必要時間
 * - searchLimit: 探索ステップ上限（バックトラックの呼び出し回数的なもの）
 *
 * 返り値:
 * {
 *   daySets: [{ days: [day, ...], isContinuousSpan: boolean }, ...],
 *   aborted: boolean  // true の場合、探索途中で打ち切り
 * }
 *
 * 方針:
 *  - 日付順にソートされた配列を使う
 *  - 各 start 位置から「その日以降すべて」を window にして、
 *    その window 内で requiredHours を満たす部分集合を全列挙
 *    （飛び飛びの組合せも含む。日曜 + 次の日曜など）
 *  - 同じ日付集合は 1 回だけ保持（seen で重複排除）
 *  - さらに最後に「厳密な部分集合が存在するもの」を冗長として削る
 *  - 探索ステップが searchLimit を超えたら aborted = true
 */
function buildCandidateDaySets(days, requiredHours, searchLimit) {
  const sorted = days.slice().sort((a, b) => a.dateKey - b.dateKey);
  const rawResult = [];
  const seen = new Set();
  const n = sorted.length;

  const limit =
    typeof searchLimit === "number" && searchLimit > 0
      ? searchLimit
      : DEFAULT_SEARCH_STEP_LIMIT;

  let aborted = false;
  let steps = 0;

  for (let start = 0; start < n && !aborted; start++) {
    const window = sorted.slice(start); // start 以降を全部使う
    const wLen = window.length;
    if (wLen === 0) continue;

    const caps = window.map(dayCapacity);
    const suffix = new Array(wLen + 1);
    suffix[wLen] = 0;
    for (let k = wLen - 1; k >= 0; k--) {
      suffix[k] = suffix[k + 1] + caps[k];
    }

    function backtrack(pos, chosenIdx, capSoFar) {
      if (aborted) return;

      // 探索ステップカウント
      steps++;
      if (steps > limit) {
        aborted = true;
        return;
      }

      // capSoFar が条件を満たしたら、その集合を記録して終了
      if (capSoFar >= requiredHours) {
        if (chosenIdx.length === 0) return;
        const keyArray = chosenIdx.map((idx) => window[idx].dateKey);
        const key = keyArray.join("-");
        if (seen.has(key)) return;
        seen.add(key);

        const chosenDays = chosenIdx.map((idx) => window[idx]);

        // インデックスが連番なら連続スパンとみなす
        let isContinuous = true;
        for (let t = 1; t < chosenIdx.length; t++) {
          if (chosenIdx[t] !== chosenIdx[t - 1] + 1) {
            isContinuous = false;
            break;
          }
        }

        rawResult.push({
          days: chosenDays,
          isContinuousSpan: isContinuous,
          keyArray, // 後段で冗長判定に使う
        });
        return;
      }

      if (pos >= wLen) return;
      if (capSoFar + suffix[pos] < requiredHours) return; // 残り全部足しても足りない

      // この日を使う
      chosenIdx.push(pos);
      backtrack(pos + 1, chosenIdx, capSoFar + caps[pos]);
      chosenIdx.pop();
      if (aborted) return;

      // この日を使わない
      backtrack(pos + 1, chosenIdx, capSoFar);
    }

    backtrack(0, [], 0);
  }

  // --- 冗長な集合を削る ---
  // 「ある候補 A の日付集合の厳密な部分集合 B が存在する」場合、
  // A は B より冗長なので削除する。
  const final = [];
  const m = rawResult.length;

  function isStrictSubset(small, big) {
    if (small.length >= big.length) return false;
    let i = 0;
    let j = 0;
    while (i < small.length && j < big.length) {
      if (small[i] === big[j]) {
        i++;
        j++;
      } else if (small[i] > big[j]) {
        j++;
      } else {
        // small[i] < big[j] なら small は subset になり得ない
        return false;
      }
    }
    return i === small.length;
  }

  for (let i = 0; i < m; i++) {
    let dominated = false;
    const keyI = rawResult[i].keyArray;
    for (let j = 0; j < m; j++) {
      if (i === j) continue;
      const keyJ = rawResult[j].keyArray;
      if (isStrictSubset(keyJ, keyI)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      // keyArray はここで捨てる（外部には出さない）
      final.push({
        days: rawResult[i].days,
        isContinuousSpan: rawResult[i].isContinuousSpan,
      });
    }
  }

  return { daySets: final, aborted };
}

/**
 * HO なしの場合の候補計算
 * - kpNames: KP 名の配列
 * - plCandidates: PL 候補（KP を除いた参加者）
 * - plCount: 何人 PL が参加するか
 * - requiredHours: 必要時間
 * - maxResults: 最大件数（Infinity なら上限なし）
 * - allowDelta: △ を許可するかどうか（false のとき △ は × 扱い）
 * - searchLimit: 探索ステップ上限（省略時は DEFAULT_SEARCH_STEP_LIMIT）
 *
 * 戻り値: { results, aborted }
 *  - aborted: 日程候補生成段階で探索を打ち切った場合 true
 */
export function computeNonHoResults({
  days,
  kpNames,
  plCandidates,
  plCount,
  requiredHours,
  maxResults,
  allowDelta,
  searchLimit,
}) {
  const results = [];
  const limit =
    typeof maxResults === "number" && maxResults > 0
      ? maxResults
      : Infinity;

  const { daySets, aborted: abortedByDaySets } = buildCandidateDaySets(
    days,
    requiredHours,
    searchLimit
  );
  let aborted = abortedByDaySets;

  const plCombos = combinations(plCandidates, plCount);

  for (const set of daySets) {
    if (results.length >= limit) break;

    const spanDays = set.days;

    // KP が全日程で OK か
    const kpCheck = checkAvailabilityForGroupMulti(
      spanDays,
      kpNames,
      allowDelta
    );
    if (!kpCheck.ok) continue;

    for (const plGroup of plCombos) {
      if (results.length >= limit) break;

      const allMembers = kpNames.concat(plGroup);
      const groupCheck = checkAvailabilityForGroupMulti(
        spanDays,
        allMembers,
        allowDelta
      );
      if (!groupCheck.ok) continue;

      const usesDelta = kpCheck.usesDelta || groupCheck.usesDelta;

      results.push({
        mode: "nonHo",
        days: spanDays.slice(),
        usesDelta,
        kpNames: kpNames.slice(),
        plGroup: plGroup.slice(),
        isContinuousSpan: set.isContinuousSpan,
      });
    }
  }

  return { results, aborted };
}

/**
 * HO 制の場合の候補計算
 * - hoList: [{ label: "HO1", candidates: [name1, name2, ...] }, ...]
 *   ※ label は「HO」 + ユーザ入力文字列で作る想定
 *   ※ 各 HO の担当者は全日程で同じ PL になる前提
 * - requiredHours: 必要時間
 * - maxResults: 最大件数（Infinity なら上限なし）
 * - allowDelta: △ を許可するかどうか（false のとき △ は × 扱い）
 * - searchLimit: 探索ステップ上限（省略時は DEFAULT_SEARCH_STEP_LIMIT）
 *
 * 戻り値: { results, aborted }
 *  - aborted: 日程候補生成段階で探索を打ち切った場合 true
 */
export function computeHoResults({
  days,
  kpNames,
  hoList,
  requiredHours,
  maxResults,
  allowDelta,
  searchLimit,
}) {
  const results = [];
  const limit =
    typeof maxResults === "number" && maxResults > 0
      ? maxResults
      : Infinity;

  const { daySets, aborted: abortedByDaySets } = buildCandidateDaySets(
    days,
    requiredHours,
    searchLimit
  );
  let aborted = abortedByDaySets;

  for (const set of daySets) {
    if (results.length >= limit) break;
    if (aborted) break;

    const spanDays = set.days;

    // KP が全日程で参加可能か
    const kpCheck = checkAvailabilityForGroupMulti(
      spanDays,
      kpNames,
      allowDelta
    );
    if (!kpCheck.ok) continue;

    // 各 HO ごとに、全日程で OK な PL 候補を抽出
    const candidatesPerHo = hoList.map((ho) =>
      ho.candidates.filter((name) =>
        spanDays.every((day) => {
          const sym = day.availability[name] || "×";
          if (sym === "×") return false;
          if (sym === "△" && !allowDelta) return false;
          return true; // ○ か（allowDelta=true の）△
        })
      )
    );

    // どこかの HO が候補ゼロならこのスパンは無理
    if (candidatesPerHo.some((c) => c.length === 0)) continue;

    const used = new Set();
    const assignment = new Array(hoList.length);

    function backtrack(index) {
      if (results.length >= limit) return;
      if (aborted) return;

      if (index >= hoList.length) {
        // 割り当て完成 → 全メンバーでチェック
        const allMembers = kpNames.slice();
        for (let i = 0; i < hoList.length; i++) {
          allMembers.push(assignment[i]);
        }

        const groupCheck = checkAvailabilityForGroupMulti(
          spanDays,
          allMembers,
          allowDelta
        );
        if (!groupCheck.ok) return;

        const usesDelta = kpCheck.usesDelta || groupCheck.usesDelta;

        const hoAssignments = {};
        for (let i = 0; i < hoList.length; i++) {
          hoAssignments[hoList[i].label] = assignment[i];
        }

        results.push({
          mode: "ho",
          days: spanDays.slice(),
          usesDelta,
          kpNames: kpNames.slice(),
          hoAssignments,
          isContinuousSpan: set.isContinuousSpan,
        });
        return;
      }

      for (const candidate of candidatesPerHo[index]) {
        if (results.length >= limit) return;
        if (aborted) return;
        if (used.has(candidate)) continue;
        used.add(candidate);
        assignment[index] = candidate;
        backtrack(index + 1);
        used.delete(candidate);
      }
    }

    backtrack(0);
  }

  return { results, aborted };
}

/**
 * 並べ替え
 * sortMode: "holidayFirst" | "weekdayFirst" | "mixed"
 *
 * 優先度:
 *  1. △ を含まない
 *  2. その中で「連続スパン」を先に表示 (isContinuousSpan = true)
 *  3. 休日優先 / 平日優先 / 混合ロジック
 *  4. スパンの短さ（なるべく近い日程に固める）
 *  5. 日数の少なさ
 *  6. 開始日の早さ
 */
export function sortResults(results, sortMode) {
  const sorted = results.slice();

  function summarize(r) {
    const days = r.days;
    const totalDays = days.length;
    let numWeekend = 0;
    let numWeekday = 0;
    for (const d of days) {
      if (d.isWeekend) numWeekend++;
      else numWeekday++;
    }
    const weekendRatio = totalDays ? numWeekend / totalDays : 0;
    const firstKey = totalDays ? days[0].dateKey : 0;
    const lastKey = totalDays ? days[totalDays - 1].dateKey : 0;
    const span = lastKey - firstKey;
    return { totalDays, numWeekend, numWeekday, weekendRatio, firstKey, lastKey, span };
  }

  sorted.sort((a, b) => {
    // 1. △ の有無（ないほうが先）
    if (a.usesDelta !== b.usesDelta) {
      return (a.usesDelta ? 1 : 0) - (b.usesDelta ? 1 : 0);
    }

    // 2. 連続スパンかどうか（連続 > 非連続）
    const aCont = a.isContinuousSpan ? 0 : 1;
    const bCont = b.isContinuousSpan ? 0 : 1;
    if (aCont !== bCont) {
      return aCont - bCont;
    }

    const sa = summarize(a);
    const sb = summarize(b);

    // 3. 平日/休日優先
    if (sortMode === "holidayFirst") {
      if (sa.weekendRatio !== sb.weekendRatio) {
        return sb.weekendRatio - sa.weekendRatio; // 休日比率が高いほうを先に
      }
    } else if (sortMode === "weekdayFirst") {
      if (sa.weekendRatio !== sb.weekendRatio) {
        return sa.weekendRatio - sb.weekendRatio; // 休日比率が低い（=平日が多い）ほうを先に
      }
    } else if (sortMode === "mixed") {
      // 休日と平日のバランスが 0.5 に近いものを優先
      const da = Math.abs(sa.weekendRatio - 0.5);
      const db = Math.abs(sb.weekendRatio - 0.5);
      if (da !== db) {
        return da - db;
      }
    }

    // 4. スパンの短さ（なるべく近い日程に固める）
    if (sa.span !== sb.span) {
      return sa.span - sb.span;
    }

    // 5. 日数の少なさ
    if (sa.totalDays !== sb.totalDays) {
      return sa.totalDays - sb.totalDays;
    }

    // 6. 開始日の早さ
    if (sa.firstKey !== sb.firstKey) {
      return sa.firstKey - sb.firstKey;
    }

    return 0;
  });

  return sorted;
}
