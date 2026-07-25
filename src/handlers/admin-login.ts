import { Composer, InputFile } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getAdmin, getTest, listAttempts, listTests, saveAdmin, saveTest } from "../domain/repository.js";
import type { BilingualText, MockTest, Question } from "../domain/types.js";
import { now } from "../time.js";

registerMainMenuItem({ label: "Admin panel", data: "admin:login", order: 90 });

type AdminSession = {
  adminStep?: "set-password" | "login" | "upload" | "reset-password";
  adminAuthenticated?: boolean;
};
const sessionOf = (ctx: Ctx) => ctx.session as AdminSession;
const composer = new Composer<Ctx>();

function forceReply(placeholder: string) {
  return { force_reply: true as const, input_field_placeholder: placeholder, selective: true };
}
function textPair(value: unknown, fallbackHindi?: unknown): BilingualText | undefined {
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    if (typeof source.en === "string" && typeof source.hi === "string" && source.en.trim() && source.hi.trim()) return { en: source.en.trim(), hi: source.hi.trim() };
  }
  if (typeof value === "string" && typeof fallbackHindi === "string" && value.trim() && fallbackHindi.trim()) return { en: value.trim(), hi: fallbackHindi.trim() };
  return undefined;
}
function answerIndex(value: unknown, key: "correctAnswer" | "correct_answer" | "answer"): number | undefined {
  if (typeof value === "string" && /^[A-Da-d]$/.test(value)) return value.toUpperCase().charCodeAt(0) - 65;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (key === "correctAnswer" && value >= 0 && value < 4) return value;
  if (value >= 1 && value <= 4) return value - 1;
  return undefined;
}
function validateTest(input: unknown): { test?: MockTest; error?: string } {
  if (!input || typeof input !== "object") return { error: "The JSON must be an object with test details." };
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const totalTime = raw.totalTime ?? raw.total_time;
  const rawQuestions = raw.questions;
  if (!name) return { error: "Add a test name and try again." };
  if (typeof totalTime !== "number" || !Number.isFinite(totalTime) || totalTime < 1 || totalTime > 300) return { error: "Set totalTime to a number of minutes between 1 and 300." };
  if (!Array.isArray(rawQuestions) || rawQuestions.length !== 100) return { error: "A full SSC CGL mock must contain exactly 100 questions." };
  const questions: Question[] = [];
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const entry = rawQuestions[index];
    if (!entry || typeof entry !== "object") return { error: `Question ${index + 1} is not valid.` };
    const q = entry as Record<string, unknown>;
    const section = typeof q.section === "string" ? q.section.trim() : "";
    const question = textPair(q.question, q.question_hi) ?? textPair(q.question_en, q.question_hi);
    const explanation = textPair(q.explanation, q.explanation_hi) ?? textPair(q.explanation_en, q.explanation_hi);
    const rawOptions = q.options;
    const correctKey = q.correctAnswer !== undefined ? "correctAnswer" : q.correct_answer !== undefined ? "correct_answer" : "answer";
    const correctAnswer = answerIndex(q[correctKey], correctKey);
    if (!section || !question || !explanation || !Array.isArray(rawOptions) || rawOptions.length !== 4 || correctAnswer === undefined) {
      return { error: `Question ${index + 1} needs a section, bilingual question, four bilingual options, a correct answer, and bilingual explanation.` };
    }
    const options = rawOptions.map((option) => textPair(option));
    if (options.some((option) => !option)) return { error: `Each option in question ${index + 1} needs English and Hindi text.` };
    const bilingual = [question, explanation, ...(options as BilingualText[])];
    if (bilingual.some((value) => value.en.length > 900 || value.hi.length > 900) || (options as BilingualText[]).some((value) => value.en.length + value.hi.length > 48)) {
      return { error: `Question ${index + 1} is too long for a Telegram message or answer button.` };
    }
    questions.push({ id: typeof q.id === "string" && q.id ? q.id : `q${index + 1}`, section, question, options: options as BilingualText[], correctAnswer, explanation });
  }
  const sections = [...new Set(questions.map((question) => question.section))];
  if (sections.length !== 4) return { error: "A full SSC CGL mock must use exactly four sections." };
  return { test: { id: `test-${now().getTime()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "mock"}`, name, sections, totalTime, questions } };
}
async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function showPanel(ctx: Ctx, edit = false): Promise<void> {
  const text = "Manage mock tests and results.";
  const markup = inlineKeyboard([
    [inlineButton("Upload test JSON", "admin:upload")],
    [inlineButton("View attempts", "admin:attempts")],
    [inlineButton("Export CSV", "admin:export")],
    [inlineButton("Reset password", "admin:reset")],
    [inlineButton("Back to menu", "menu:main")],
  ]);
  if (edit) await ctx.editMessageText(text, { reply_markup: markup });
  else await ctx.reply(text, { reply_markup: markup });
}
function isAdmin(ctx: Ctx): boolean {
  return sessionOf(ctx).adminAuthenticated === true;
}

composer.callbackQuery("admin:login", async (ctx) => {
  await ctx.answerCallbackQuery();
  const credentials = await getAdmin();
  if (!credentials) {
    sessionOf(ctx).adminStep = "set-password";
    await ctx.reply("Set the initial admin password. Use at least 8 characters.", { reply_markup: forceReply("Type a new admin password") });
    return;
  }
  sessionOf(ctx).adminStep = "login";
  await ctx.reply("Enter the admin password.", { reply_markup: forceReply("Type the admin password") });
});

composer.callbackQuery("admin:upload", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return void (await ctx.reply("Admin access is required. Open Admin panel and enter the password."));
  sessionOf(ctx).adminStep = "upload";
  await ctx.reply("Send the test JSON as a message or a .json document. It must contain 100 bilingual questions across four sections.", { reply_markup: forceReply("Paste test JSON") });
});

composer.callbackQuery("admin:attempts", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return void (await ctx.reply("Admin access is required. Open Admin panel and enter the password."));
  const attempts = await listAttempts();
  if (attempts.length === 0) return void (await ctx.editMessageText("No test attempts yet — results will appear here after candidates submit a test.", { reply_markup: inlineKeyboard([[inlineButton("Back to admin", "admin:panel")]]) }));
  const submitted = attempts.filter((attempt) => attempt.submittedAt);
  await ctx.editMessageText(`${submitted.length} submitted attempt${submitted.length === 1 ? "" : "s"}. Export CSV for the full result list.`, { reply_markup: inlineKeyboard([[inlineButton("Export CSV", "admin:export")], [inlineButton("Back to admin", "admin:panel")]]) });
});

composer.callbackQuery("admin:export", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return void (await ctx.reply("Admin access is required. Open Admin panel and enter the password."));
  const attempts = (await listAttempts()).filter((attempt) => attempt.submittedAt);
  if (attempts.length === 0) return void (await ctx.reply("No submitted attempts yet — there is nothing to export."));
  const rows = ["user_id,test_id,started_at,submitted_at,score"];
  for (const attempt of attempts) rows.push([attempt.userId, attempt.testId, attempt.startedAt, attempt.submittedAt ?? "", attempt.score ?? ""].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(rows.join("\n")), "ssc-cgl-results.csv"), { caption: "Your results export is ready." });
});

composer.callbackQuery("admin:reset", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return void (await ctx.reply("Admin access is required. Open Admin panel and enter the password."));
  sessionOf(ctx).adminStep = "reset-password";
  await ctx.reply("Enter a new admin password. Use at least 8 characters.", { reply_markup: forceReply("Type a new admin password") });
});

composer.callbackQuery("admin:panel", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!isAdmin(ctx)) return void (await ctx.reply("Admin access is required. Open Admin panel and enter the password."));
  await showPanel(ctx, true);
});

async function acceptUpload(ctx: Ctx, content: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    await ctx.reply("That JSON could not be read. Check the format and send it again.");
    return;
  }
  const result = validateTest(parsed);
  if (!result.test) {
    await ctx.reply(`${result.error} Fix it and send the JSON again.`);
    return;
  }
  await saveTest(result.test);
  sessionOf(ctx).adminStep = undefined;
  await ctx.reply(`${result.test.name} is ready with ${result.test.questions.length} questions in ${result.test.sections.length} sections.`, { reply_markup: inlineKeyboard([[inlineButton("Back to admin", "admin:panel")]]) });
}

composer.on("message:text", async (ctx, next) => {
  const flow = sessionOf(ctx);
  const value = ctx.message.text;
  if (!flow.adminStep) return next();
  if (flow.adminStep === "upload") return acceptUpload(ctx, value);
  if (value.length < 8 || value.length > 200) return void (await ctx.reply("Use a password between 8 and 200 characters."));
  const hashed = await hashPassword(value);
  if (flow.adminStep === "set-password" || flow.adminStep === "reset-password") {
    const wasReset = flow.adminStep === "reset-password";
    await saveAdmin({ passwordHash: hashed });
    flow.adminAuthenticated = true;
    flow.adminStep = undefined;
    await ctx.reply(wasReset ? "Your admin password has been updated." : "Your admin password is set.");
    await showPanel(ctx);
    return;
  }
  const credentials = await getAdmin();
  if (!credentials || credentials.passwordHash !== hashed) return void (await ctx.reply("That password is not correct. Try again."));
  flow.adminAuthenticated = true;
  flow.adminStep = undefined;
  await showPanel(ctx);
});

composer.on("message:document", async (ctx, next) => {
  if (sessionOf(ctx).adminStep !== "upload") return next();
  const document = ctx.message.document;
  if (!document.file_name?.toLowerCase().endsWith(".json") || (document.file_size ?? 0) > 2_000_000) {
    await ctx.reply("Send a JSON file smaller than 2 MB, or paste the JSON as a message.");
    return;
  }
  try {
    const file = await ctx.getFile();
    const workerToken = (ctx as unknown as { env?: { BOT_TOKEN?: string } }).env?.BOT_TOKEN;
    const token = workerToken ?? (typeof process === "undefined" ? undefined : process.env.BOT_TOKEN);
    if (!token || !file.file_path) {
      await ctx.reply("Couldn't read that file here. Paste the JSON as a message instead.");
      return;
    }
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) throw new Error("file download failed");
    await acceptUpload(ctx, await response.text());
  } catch {
    await ctx.reply("Couldn't read that file. Paste the JSON as a message or try the file again.");
  }
});

export default composer;
