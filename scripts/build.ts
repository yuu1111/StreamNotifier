import { $ } from "bun";
import { mkdir, cp } from "node:fs/promises";

/**
 * @description ビルド対象プラットフォーム
 */
const TARGETS = {
  win: "bun-windows-x64",
  linux: "bun-linux-x64",
  mac: "bun-darwin-x64",
} as const;

/**
 * @description 実行ファイル名
 */
const OUTPUT_NAMES = {
  win: "stream-notifier.exe",
  linux: "stream-notifier",
  mac: "stream-notifier",
} as const;

type Platform = keyof typeof TARGETS;

async function build(platform: Platform): Promise<void> {
  const target = TARGETS[platform];
  const outputName = OUTPUT_NAMES[platform];
  const outDir = `dist/${platform}`;

  console.log(`\n📦 Building for ${platform}...`);

  await mkdir(outDir, { recursive: true });

  await $`bun build --compile --target=${target} src/index.ts --outfile ${outDir}/${outputName}`;

  // config.example.jsonをコピー
  await cp("config.example.json", `${outDir}/config.example.json`);

  console.log(`✅ ${platform}: ${outDir}/${outputName}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  console.log("🚀 Stream Notifier Build Script\n");

  if (args.length === 0 || args[0] === "all") {
    // 全プラットフォームビルド
    for (const platform of Object.keys(TARGETS) as Platform[]) {
      await build(platform);
    }
  } else {
    // 指定プラットフォームのみ
    const platform = args[0] as Platform;
    if (!(platform in TARGETS)) {
      console.error(`❌ Unknown platform: ${platform}`);
      console.error(`   Available: ${Object.keys(TARGETS).join(", ")}`);
      process.exit(1);
    }
    await build(platform);
  }

  console.log("\n🎉 Build complete!");
}

main().catch((error) => {
  console.error("❌ Build failed:", error);
  process.exit(1);
});
