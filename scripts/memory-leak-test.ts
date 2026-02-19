/**
 * @description Bun fetch メモリリーク検証スクリプト
 *
 * 3つのモードで実行し、RSS増加の原因を切り分ける。
 * Ctrl+C で停止するとサマリーを出力。
 *
 * 使い方:
 *   bun run scripts/memory-leak-test.ts plain     # gzipなし(ベースライン)
 *   bun run scripts/memory-leak-test.ts gzip      # gzip圧縮レスポンス
 *   bun run scripts/memory-leak-test.ts full       # gzip + ファイルI/O + state(実アプリ模倣)
 *   bun run scripts/memory-leak-test.ts            # デフォルト: full
 */
import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { heapStats } from "bun:jsc";

/**
 * @description テスト間隔(ミリ秒) - 実アプリの30秒ポーリングを模倣
 */
const INTERVAL_MS = 1000;

/**
 * @description 1サイクルあたりのfetch回数 - 実アプリ相当(getStreams + getChannels + getVod)
 */
const FETCHES_PER_CYCLE = 3;

/**
 * @description GC実行間隔(サイクル数) - 実アプリと同じ
 */
const GC_EVERY = 5;

/**
 * @description ログ出力間隔(サイクル数)
 */
const LOG_EVERY = 30;

/**
 * @description テストモード
 */
type Mode = "plain" | "gzip" | "full";

/**
 * @description Twitch API風のモックレスポンスデータ
 */
const MOCK_RESPONSE = JSON.stringify({
  data: [
    {
      id: "41375541868",
      user_id: "141981764",
      user_login: "teststreamer",
      user_name: "TestStreamer",
      game_id: "509658",
      game_name: "Just Chatting",
      type: "live",
      title: "テスト配信 - 雑談しながらゲーム",
      viewer_count: 1234,
      started_at: "2026-02-19T10:00:00Z",
      language: "ja",
      thumbnail_url:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_test-{width}x{height}.jpg",
      tag_ids: [],
      tags: ["日本語", "雑談"],
      is_mature: false,
    },
  ],
});

/**
 * @description gzip圧縮済みレスポンスボディ(事前計算)
 */
const GZIPPED_RESPONSE = gzipSync(MOCK_RESPONSE);

/**
 * @description メモリスナップショット
 * @property cycle - サイクル番号
 * @property elapsed - 経過時間(秒)
 * @property rss - RSS(MB)
 * @property heapUsed - HeapUsed(MB)
 * @property objects - 生存オブジェクト数
 * @property extra - extraMemorySize(MB)
 */
interface MemorySnapshot {
  cycle: number;
  elapsed: number;
  rss: number;
  heapUsed: number;
  objects: number;
  extra: number;
}

/**
 * @description バイト数をMBに変換
 * @param bytes - バイト数
 */
function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

/**
 * @description 秒数を mm:ss 形式にフォーマット
 * @param sec - 秒数
 */
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * @description 現在のメモリスナップショットを取得
 * @param cycle - サイクル番号
 * @param startTime - テスト開始時刻
 */
function takeSnapshot(cycle: number, startTime: number): MemorySnapshot {
  const mem = process.memoryUsage();
  const stats = heapStats();
  return {
    cycle,
    elapsed: (Date.now() - startTime) / 1000,
    rss: toMB(mem.rss),
    heapUsed: toMB(mem.heapUsed),
    objects: stats.objectCount,
    extra: toMB(stats.extraMemorySize),
  };
}

/**
 * @description スナップショットをコンソールに出力
 * @param snap - メモリスナップショット
 */
function logSnapshot(snap: MemorySnapshot): void {
  console.log(
    `  ${formatTime(snap.elapsed)} | #${String(snap.cycle).padStart(5)} | RSS: ${snap.rss.toFixed(2).padStart(7)}MB | Heap: ${snap.heapUsed.toFixed(2).padStart(7)}MB | Objects: ${String(snap.objects).padStart(6)} | Extra: ${snap.extra.toFixed(2).padStart(6)}MB`
  );
}

/**
 * @description RSSの線形回帰傾きを計算(MB/時間)
 * @param snapshots - スナップショット配列
 */
function calcSlopePerHour(snapshots: MemorySnapshot[]): number {
  const n = snapshots.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const s of snapshots) {
    const hours = s.elapsed / 3600;
    sumX += hours;
    sumY += s.rss;
    sumXY += hours * s.rss;
    sumXX += hours * hours;
  }
  return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
}

/**
 * @description サマリーを出力
 * @param snapshots - 全スナップショット
 */
function printSummary(snapshots: MemorySnapshot[]): void {
  if (snapshots.length < 2) {
    console.log("\n  データ不足(2ポイント以上必要)");
    return;
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const rssDelta = last.rss - first.rss;
  const objectsDelta = last.objects - first.objects;

  // 後半50%で傾き計算
  const stableStart = Math.floor(snapshots.length / 2);
  const stableSnapshots = snapshots.slice(stableStart);
  const slopePerHour = calcSlopePerHour(stableSnapshots);

  console.log("\n=== サマリー ===");
  console.log(`  経過時間:  ${formatTime(last.elapsed)}`);
  console.log(`  サイクル:  ${last.cycle}`);
  console.log(
    `  RSS:       ${first.rss.toFixed(2)}MB → ${last.rss.toFixed(2)}MB (${rssDelta >= 0 ? "+" : ""}${rssDelta.toFixed(2)}MB)`
  );
  console.log(
    `  Objects:   ${first.objects} → ${last.objects} (${objectsDelta >= 0 ? "+" : ""}${objectsDelta})`
  );
  console.log(
    `  RSS傾き:   ${slopePerHour >= 0 ? "+" : ""}${slopePerHour.toFixed(2)} MB/時間 (後半${stableSnapshots.length}ポイントから算出)`
  );

  if (Math.abs(slopePerHour) < 1) {
    console.log("  判定:      安定(リークなし or 極めて軽微)");
  } else if (slopePerHour > 0) {
    console.log(`  判定:      RSS増加傾向あり(${(slopePerHour * 24).toFixed(1)} MB/日 相当)`);
  }
}

// モード判定
const arg = process.argv[2] as Mode | undefined;
const mode: Mode = arg === "plain" || arg === "gzip" || arg === "full" ? arg : "full";

const MODE_LABELS: Record<Mode, string> = {
  plain: "plain JSON (gzipなし, ベースライン)",
  gzip: "gzip JSON (inflate リーク検証)",
  full: "gzip + IO + state (実アプリ模倣)",
};

// サーバー起動
const useGzip = mode === "gzip" || mode === "full";
const server = Bun.serve({
  port: 0,
  fetch() {
    if (useGzip) {
      return new Response(GZIPPED_RESPONSE, {
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      });
    }
    return new Response(MOCK_RESPONSE, {
      headers: { "Content-Type": "application/json" },
    });
  },
});

const serverUrl = `http://localhost:${server.port}`;

// full モード用: ログファイルとstate
const testLogDir = `${process.cwd()}/logs`;
const testLogFile = `${testLogDir}/memory-test.log`;
if (mode === "full") {
  if (!existsSync(testLogDir)) mkdirSync(testLogDir, { recursive: true });
  if (existsSync(testLogFile)) unlinkSync(testLogFile);
}
const stateMap = new Map<string, Record<string, unknown>>();

/**
 * @description 1サイクル分のfetchを実行
 */
async function doCycle(): Promise<void> {
  for (let f = 0; f < FETCHES_PER_CYCLE; f++) {
    const res = await fetch(serverUrl, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { data: Record<string, unknown>[] };

    if (mode === "full") {
      for (const item of data.data) {
        stateMap.set(item.user_login as string, { ...item, checkedAt: new Date().toISOString() });
      }
      appendFileSync(
        testLogFile,
        `${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message: `polled ${data.data.length}` })}\n`
      );
    }
  }
}

// ログファイル
const resultFile = `${process.cwd()}/logs/memory-test-${mode}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
if (!existsSync(`${process.cwd()}/logs`)) mkdirSync(`${process.cwd()}/logs`, { recursive: true });
appendFileSync(resultFile, "elapsed,cycle,rss_mb,heap_mb,objects,extra_mb\n");

/**
 * @description スナップショットをCSVファイルに追記
 * @param snap - メモリスナップショット
 */
function appendCsv(snap: MemorySnapshot): void {
  appendFileSync(
    resultFile,
    `${snap.elapsed.toFixed(1)},${snap.cycle},${snap.rss.toFixed(2)},${snap.heapUsed.toFixed(2)},${snap.objects},${snap.extra.toFixed(2)}\n`
  );
}

// メインループ
console.log("=== Bun fetch メモリリーク検証 ===");
console.log(`Bun ${Bun.version} | ${process.platform} ${process.arch}`);
console.log(`モード: ${MODE_LABELS[mode]}`);
console.log(`MIMALLOC_PURGE_DELAY=${process.env.MIMALLOC_PURGE_DELAY ?? "(default: 1000)"}`);
console.log(`${INTERVAL_MS}ms間隔, ${FETCHES_PER_CYCLE}fetch/cycle, GC毎${GC_EVERY}cycle`);
console.log(`ログ: ${resultFile}`);
console.log("Ctrl+C で停止 → サマリー出力\n");

const snapshots: MemorySnapshot[] = [];
const startTime = Date.now();
let cycle = 0;
let running = true;

process.on("SIGINT", () => {
  running = false;
});

// 初期スナップショット
Bun.gc(true);
await Bun.sleep(500);
const initial = takeSnapshot(0, startTime);
snapshots.push(initial);
logSnapshot(initial);
appendCsv(initial);

while (running) {
  cycle++;

  try {
    await doCycle();
  } catch (e) {
    console.error(`  cycle ${cycle} エラー:`, e);
  }

  if (cycle % GC_EVERY === 0) {
    Bun.gc(true);
  }

  if (cycle % LOG_EVERY === 0) {
    const snap = takeSnapshot(cycle, startTime);
    snapshots.push(snap);
    logSnapshot(snap);
    appendCsv(snap);
  }

  await Bun.sleep(INTERVAL_MS);
}

// 最終スナップショット
Bun.gc(true);
await Bun.sleep(500);
Bun.gc(true);
const final = takeSnapshot(cycle, startTime);
snapshots.push(final);
logSnapshot(final);
appendCsv(final);

// クリーンアップ
server.stop();
if (mode === "full" && existsSync(testLogFile)) unlinkSync(testLogFile);

printSummary(snapshots);
console.log("\nテスト完了");
