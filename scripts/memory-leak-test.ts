/**
 * @description Bun fetch メモリリーク検証スクリプト v2
 *
 * 3パターンを比較してRSS増加の原因を切り分ける:
 *   A: plain JSON (ベースライン)
 *   B: gzip圧縮JSON (inflateEndリーク検証)
 *   C: gzip + appendFileSync + state管理 (実アプリ模倣)
 *
 * 使い方: bun run scripts/memory-leak-test.ts [iterations]
 *   例: bun run scripts/memory-leak-test.ts 600
 */
import { gzipSync } from "node:zlib";
import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { heapStats } from "bun:jsc";

const ITERATIONS = Number(process.argv[2]) || 600;
const INTERVAL_MS = 200;
const LOG_EVERY = 50;
const FETCHES_PER_CYCLE = 3;
const GC_EVERY = 5;

/**
 * @description Twitch API風のモックレスポンスデータ
 */
const MOCK_STREAMS = JSON.stringify({
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
const GZIPPED_STREAMS = gzipSync(MOCK_STREAMS);

/**
 * @description メモリスナップショット
 * @property iteration - イテレーション番号
 * @property rss - RSS(MB)
 * @property heapUsed - HeapUsed(MB)
 * @property objects - 生存オブジェクト数
 * @property extra - extraMemorySize(MB)
 */
interface MemorySnapshot {
  iteration: number;
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
 * @description 現在のメモリスナップショットを取得
 * @param iteration - 現在のイテレーション番号
 */
function takeSnapshot(iteration: number): MemorySnapshot {
  const mem = process.memoryUsage();
  const stats = heapStats();
  return {
    iteration,
    rss: toMB(mem.rss),
    heapUsed: toMB(mem.heapUsed),
    objects: stats.objectCount,
    extra: toMB(stats.extraMemorySize),
  };
}

/**
 * @description スナップショットをコンソールに出力
 * @param label - テストラベル
 * @param snap - メモリスナップショット
 */
function logSnapshot(label: string, snap: MemorySnapshot): void {
  console.log(
    `  [${label}] #${String(snap.iteration).padStart(4)} | RSS: ${snap.rss.toFixed(2).padStart(7)}MB | Heap: ${snap.heapUsed.toFixed(2).padStart(7)}MB | Objects: ${String(snap.objects).padStart(6)} | Extra: ${snap.extra.toFixed(2).padStart(6)}MB`
  );
}

/**
 * @description テスト結果のサマリーを出力
 * @param label - テストラベル
 * @param snapshots - 全スナップショット
 */
function printSummary(label: string, snapshots: MemorySnapshot[]): void {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const rssDelta = last.rss - first.rss;
  const objectsDelta = last.objects - first.objects;

  // 安定区間(後半50%)の平均RSSと傾きを計算
  const stableStart = Math.floor(snapshots.length / 2);
  const stableSnapshots = snapshots.slice(stableStart);
  const avgRss =
    stableSnapshots.reduce((sum, s) => sum + s.rss, 0) / stableSnapshots.length;

  // 線形回帰で傾き(MB/100iterations)を算出
  const slope = calcSlope(stableSnapshots);

  console.log(`\n  ${label}:`);
  console.log(
    `    RSS:     ${first.rss.toFixed(2)}MB → ${last.rss.toFixed(2)}MB (${rssDelta >= 0 ? "+" : ""}${rssDelta.toFixed(2)}MB)`
  );
  console.log(`    Objects: ${first.objects} → ${last.objects} (${objectsDelta >= 0 ? "+" : ""}${objectsDelta})`);
  console.log(`    後半平均RSS: ${avgRss.toFixed(2)}MB, 傾き: ${slope >= 0 ? "+" : ""}${slope.toFixed(3)}MB/100iter`);
}

/**
 * @description RSSの線形回帰傾きを計算(MB/100iterations)
 * @param snapshots - スナップショット配列
 */
function calcSlope(snapshots: MemorySnapshot[]): number {
  const n = snapshots.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const s of snapshots) {
    sumX += s.iteration;
    sumY += s.rss;
    sumXY += s.iteration * s.rss;
    sumXX += s.iteration * s.iteration;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  return slope * 100;
}

/**
 * @description fetchテストを実行
 * @param label - テストラベル
 * @param fetchFn - 1回のfetch処理
 */
async function runTest(
  label: string,
  fetchFn: () => Promise<void>
): Promise<MemorySnapshot[]> {
  const snapshots: MemorySnapshot[] = [];
  const estMinutes = ((ITERATIONS * INTERVAL_MS) / 60000).toFixed(1);

  console.log(`\n--- ${label} (${ITERATIONS}回, ${FETCHES_PER_CYCLE}fetch/cycle, ~${estMinutes}分) ---`);

  Bun.gc(true);
  await Bun.sleep(500);
  const initial = takeSnapshot(0);
  snapshots.push(initial);
  logSnapshot(label, initial);

  for (let i = 1; i <= ITERATIONS; i++) {
    for (let f = 0; f < FETCHES_PER_CYCLE; f++) {
      await fetchFn();
    }

    if (i % GC_EVERY === 0) {
      Bun.gc(true);
    }

    if (i % LOG_EVERY === 0) {
      const snap = takeSnapshot(i);
      snapshots.push(snap);
      logSnapshot(label, snap);
    }

    await Bun.sleep(INTERVAL_MS);
  }

  Bun.gc(true);
  await Bun.sleep(1000);
  Bun.gc(true);
  const final = takeSnapshot(ITERATIONS);
  snapshots.push(final);
  logSnapshot(label, final);

  return snapshots;
}

// テスト開始
const totalEstMinutes = ((ITERATIONS * INTERVAL_MS * 3) / 60000 + 0.5).toFixed(1);
console.log("=== Bun fetch メモリリーク検証 v2 ===");
console.log(`Bun ${Bun.version} | ${process.platform} ${process.arch}`);
console.log(`${ITERATIONS}回 x ${FETCHES_PER_CYCLE}fetch x 3テスト, ${INTERVAL_MS}ms間隔`);
console.log(`推定所要時間: ~${totalEstMinutes}分\n`);

// Test A: plain JSON (gzipなし)
const plainServer = Bun.serve({
  port: 0,
  fetch() {
    return new Response(MOCK_STREAMS, {
      headers: { "Content-Type": "application/json" },
    });
  },
});

const plainSnapshots = await runTest("A: plain JSON", async () => {
  const res = await fetch(`http://localhost:${plainServer.port}`, {
    signal: AbortSignal.timeout(5000),
  });
  await res.json();
});

plainServer.stop();
Bun.gc(true);
await Bun.sleep(3000);
Bun.gc(true);

// Test B: gzip圧縮JSON
const gzipServer = Bun.serve({
  port: 0,
  fetch() {
    return new Response(GZIPPED_STREAMS, {
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
    });
  },
});

const gzipSnapshots = await runTest("B: gzip JSON", async () => {
  const res = await fetch(`http://localhost:${gzipServer.port}`, {
    signal: AbortSignal.timeout(5000),
  });
  await res.json();
});

gzipServer.stop();
Bun.gc(true);
await Bun.sleep(3000);
Bun.gc(true);

// Test C: gzip + appendFileSync + state管理 (実アプリ模倣)
const fullServer = Bun.serve({
  port: 0,
  fetch() {
    return new Response(GZIPPED_STREAMS, {
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
    });
  },
});

const testLogDir = `${process.cwd()}/logs`;
const testLogFile = `${testLogDir}/memory-test.log`;
if (!existsSync(testLogDir)) mkdirSync(testLogDir, { recursive: true });
if (existsSync(testLogFile)) unlinkSync(testLogFile);

const stateMap = new Map<string, Record<string, unknown>>();

const fullSnapshots = await runTest("C: gzip+IO+state", async () => {
  const res = await fetch(`http://localhost:${fullServer.port}`, {
    signal: AbortSignal.timeout(5000),
  });
  const data = (await res.json()) as { data: Record<string, unknown>[] };

  // State管理(実アプリと同じパターン)
  for (const item of data.data) {
    const login = item.user_login as string;
    stateMap.set(login, { ...item, checkedAt: new Date().toISOString() });
  }

  // ログ出力(実アプリと同じappendFileSync)
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    message: `polled ${data.data.length} streams`,
  });
  appendFileSync(testLogFile, `${logEntry}\n`);
});

fullServer.stop();

// 結果比較
console.log("\n=== 結果比較 ===");
printSummary("A: plain JSON     ", plainSnapshots);
printSummary("B: gzip JSON      ", gzipSnapshots);
printSummary("C: gzip+IO+state  ", fullSnapshots);

const slopeA = calcSlope(plainSnapshots.slice(Math.floor(plainSnapshots.length / 2)));
const slopeB = calcSlope(gzipSnapshots.slice(Math.floor(gzipSnapshots.length / 2)));
const slopeC = calcSlope(fullSnapshots.slice(Math.floor(fullSnapshots.length / 2)));

console.log("\n  判定:");
if (slopeB > slopeA + 0.05) {
  console.log("  → gzip圧縮でRSS増加率が上昇。inflateEnd未解放リークの可能性。");
}
if (slopeC > slopeB + 0.05) {
  console.log("  → ファイルI/O + state管理でさらに増加。appendFileSyncまたはMap操作が寄与。");
}
if (slopeA > 0.1 || slopeB > 0.1 || slopeC > 0.1) {
  console.log("  → 安定区間でもRSS増加傾向あり。Bun/mimallocの構造的問題の可能性。");
} else if (Math.abs(slopeA) < 0.05 && Math.abs(slopeB) < 0.05 && Math.abs(slopeC) < 0.05) {
  console.log("  → 全テストで安定。このイテレーション数では再現せず。iterations増加を推奨。");
}

// テストログ削除
if (existsSync(testLogFile)) unlinkSync(testLogFile);

console.log("\nテスト完了");
