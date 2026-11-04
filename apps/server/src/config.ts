import dotenv from "dotenv";
import path from "node:path";
dotenv.config({
  path: [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ],
  quiet: true,
});
export const config = {
  dataDir: path.resolve(process.env.DATA_DIR || "../../data"),
  allowLocal: process.env.ALLOW_LOCAL_TARGETS === "true",
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3100),
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
};
export const limits = {
  html: 12 * 1024 * 1024,
  image: 15 * 1024 * 1024,
  timeout: 25_000,
  redirects: 5,
  images: 300,
};
