import { spawn } from "node:child_process";

/** Executa ffmpeg/ffprobe sem shell, com timeout. */
export function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} falhou (${signal ?? code}): ${err.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
}

export interface ProbeInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export async function probe(path: string): Promise<ProbeInfo> {
  const json = JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], 30_000));
  const streams: Array<Record<string, string | number>> = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  const anyVisual = v ?? streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const fpsStr = v?.avg_frame_rate as string | undefined;
  const [n, d] = (fpsStr ?? "0/1").split("/").map(Number);
  return {
    hasVideo: !!v,
    hasAudio: !!a,
    durationSec: json.format?.duration ? Number(json.format.duration) : null,
    width: anyVisual ? Number(anyVisual.width) : null,
    height: anyVisual ? Number(anyVisual.height) : null,
    fps: v && d ? Math.round((n! / d) * 1000) / 1000 : null,
  };
}
