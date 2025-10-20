const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const os = require("os");
const pLimit = require("p-limit");

// 配置参数
const config = {
  inputDir: "./input", // 输入目录（存放MP4文件）
  outputDir: "./output", // 输出目录（保存AVIF文件）
  concurrency: Math.max(os.cpus().length - 1, 1), // 根据CPU核心数自动设置并发数
  avif: {
    encoderOptions: [
      // FFmpeg 编码参数
      "-c:v libaom-av1", // 使用AV1编码器
      "-crf 60", // 质量参数（0-63，值越小质量越好）
      "-b:v 0", // 可变码率模式
      "-cpu-used 6", // 编码速度（0-8，值越大速度越快）
      "-row-mt 1", // 启用多线程行处理
      "-pix_fmt yuv420p", // 像素格式
      "-f avif", // 强制输出格式
      "-loop 0", // 无限循环（适用于动态AVIF）
      "-default_mode animated", // 动态模式
      "-threads 4", // 设置每个转换任务的线程数
    ],
  },
  webp: {
    encoderOptions: [
      // FFmpeg 编码参数
      "-c:v libwebp", // 使用WebP编码器
      "-q:v 90", // 质量参数（0-100，值越大质量越好）
      "-lossless 0", // 禁用无损模式
      "-loop 0", // 无限循环（适用于动态WebP）
      "-threads 4", // 设置每个转换任务的线程数
      "-preset picture", // 使用预设优化压缩，picture 适用于照片
      "-compression_level 6", // 压缩级别（0-9，值越大压缩越好但速度越慢）
      "-an", // 去除音频流，减少文件大小
      "-vf fps=10,scale=-1:270", // 调整分辨率，高度为 360，宽度按比例缩放
    ],
  },
};

// 创建并行队列
const limit = pLimit(config.concurrency);

// 异步化文件操作
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// 转换单个文件的异步函数
async function convertFile(file, type) {
  const inputPath = path.join(config.inputDir, file);
  const outputName = path.basename(file, ".mp4") + "." + type;
  const outputPath = path.join(config.outputDir, outputName);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(config[type].encoderOptions)
      .output(outputPath)
      .on("start", (cmd) => {
        console.log(
          `[${file}] 启动转换 | 线程数: ${
            config[type].encoderOptions
              .find((o) => o.startsWith("-threads"))
              ?.split(" ")[1] || "自动"
          }`
        );
      })
      .on("progress", (progress) => {
        console.log(
          `[${file}] 帧: ${progress.frames} | 时长: ${
            progress.timemark
          } | 进度: ${Math.floor(progress.percent)}%`
        );
      })
      .on("end", () => {
        stat(outputPath).then((stats) => {
          console.log(
            `[${file}] 转换完成 | 大小: ${(stats.size / 1024 / 1024).toFixed(
              2
            )} MB`
          );
          resolve();
        });
      })
      .on("error", reject)
      .run();
  });
}

// 主执行函数
async function main(type = "avif") {
  // 创建输出目录
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  try {
    const files = await readdir(config.inputDir);
    const mp4Files = files.filter(
      (file) => path.extname(file).toLowerCase() === ".mp4"
    );

    console.log(
      `找到 ${mp4Files.length} 个MP4文件 | 并发数: ${config.concurrency}`
    );

    // 创建并行任务队列
    const tasks = mp4Files.map((file) => limit(() => convertFile(file, type)));

    await Promise.all(tasks);
    console.log("全部转换任务已完成");
  } catch (err) {
    console.error("发生错误:", err);
    process.exit(1);
  }
}

main("webp");
