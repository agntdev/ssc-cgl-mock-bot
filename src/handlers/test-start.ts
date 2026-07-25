import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getAttempt, getTest, getUser, listAttemptsForUser, listTests, saveAttempt, saveUser } from "../domain/repository.js";
import type { Attempt, MockTest } from "../domain/types.js";
import { now } from "../time.js";

registerMainMenuItem({ label: "Start test", data: "test:start", order: 10 });

type TestSession = {
  testStep?: "name" | "roll";
  pendingName?: string;
  language?: "both" | "en" | "hi";
};
const sessionOf = (ctx: Ctx) => ctx.session as TestSession;
const composer = new Composer<Ctx>();

function userId(ctx: Ctx): string | undefined {
  return ctx.from ? String(ctx.from.id) : undefined;
}
function forceReply(placeholder: string) {
  return { force_reply: true as const, input_field_placeholder: placeholder, selective: true };
}
function remaining(attempt: Attempt, test: MockTest): string {
  const end = new Date(attempt.startedAt).getTime() + test.totalTime * 60_000;
  const minutes = Math.max(0, Math.ceil((end - now().getTime()) / 60_000));
  return `${minutes} min left`;
}
function questionText(test: MockTest, attempt: Attempt, language: TestSession["language"]): string {
  const index = Math.max(0, Math.min(attempt.currentQuestion, test.questions.length - 1));
  const q = test.questions[index];
  const showEnglish = language !== "hi";
  const showHindi = language !== "en";
  const prompt = [
    `Question ${index + 1}/${test.questions.length} • ${q.section} • ${remaining(attempt, test)}`,
    showEnglish ? q.question.en : "",
    showHindi ? q.question.hi : "",
  ].filter(Boolean);
  return prompt.join("\n");
}
function questionKeyboard(test: MockTest, attempt: Attempt) {
  const q = test.questions[attempt.currentQuestion];
  const selected = attempt.answers[q.id];
  const review = attempt.markedForReview.includes(q.id);
  return inlineKeyboard([
    ...q.options.map((option, index) => [inlineButton(`${selected === index ? "✓ " : ""}${String.fromCharCode(65 + index)}. ${option.en} / ${option.hi}`, `test:a:${index}`)]),
    [inlineButton("Previous", "test:prev"), inlineButton("Next", "test:next")],
    [inlineButton(review ? "Unmark review" : "Mark for review", "test:mark"), inlineButton("Change language", "test:lang")],
    [inlineButton("Submit test", "test:submit")],
  ]);
}
async function renderQuestion(ctx: Ctx, test: MockTest, attempt: Attempt, edit = true): Promise<void> {
  const text = questionText(test, attempt, sessionOf(ctx).language ?? "both");
  const opts = { reply_markup: questionKeyboard(test, attempt) };
  if (edit) await ctx.editMessageText(text, opts);
  else await ctx.reply(text, opts);
}
async function current(ctx: Ctx): Promise<{ attempt: Attempt; test: MockTest; id: string } | undefined> {
  const id = userId(ctx);
  if (!id) return undefined;
  const user = await getUser(id);
  if (!user?.currentAttempt) return undefined;
  const attempt = await getAttempt(user.currentAttempt);
  if (!attempt || attempt.submittedAt) return undefined;
  const test = await getTest(attempt.testId);
  if (!test) return undefined;
  if (now().getTime() >= new Date(attempt.startedAt).getTime() + test.totalTime * 60_000) {
    attempt.score = test.questions.reduce((total, question) => total + (attempt.answers[question.id] === question.correctAnswer ? 1 : 0), 0);
    attempt.submittedAt = now().toISOString();
    user.currentAttempt = undefined;
    await saveAttempt(attempt);
    await saveUser(user);
    await ctx.reply(`Time is up. Your test was submitted with a score of ${attempt.score}/${test.questions.length}.`);
    return undefined;
  }
  return { attempt, test, id };
}
async function chooseTest(ctx: Ctx): Promise<void> {
  const tests = await listTests();
  if (tests.length === 0) {
    await ctx.reply("No mock test is available yet. Ask your administrator to upload one.", {
      reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
    });
    return;
  }
  await ctx.reply("Choose a mock test.", {
    reply_markup: inlineKeyboard([
      ...tests.slice(0, 6).map((test) => [inlineButton(test.name, `test:pick:${test.id}`)]),
      [inlineButton("Back to menu", "menu:main")],
    ]),
  });
}

composer.callbackQuery("test:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  if (!id) return;
  const candidate = await getUser(id);
  const active = await current(ctx);
  if (active) {
    await ctx.reply("Your saved test is ready to resume.", {
      reply_markup: inlineKeyboard([[inlineButton("Resume test", "test:resume")], [inlineButton("Start another test", "test:choose")]]),
    });
    return;
  }
  if (candidate?.name && candidate.rollNumber) return chooseTest(ctx);
  sessionOf(ctx).testStep = "name";
  await ctx.reply("Enter your full name.", { reply_markup: forceReply("Type your name") });
});

composer.callbackQuery("test:choose", async (ctx) => {
  await ctx.answerCallbackQuery();
  await chooseTest(ctx);
});

composer.callbackQuery(/^test:pick:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  const test = await getTest(ctx.match[1]);
  if (!id || !test) {
    await ctx.reply("That mock test is no longer available. Choose another one.");
    return;
  }
  const attempt: Attempt = {
    id: `${id}:${test.id}:${now().getTime()}`,
    userId: id,
    testId: test.id,
    answers: {},
    markedForReview: [],
    currentQuestion: 0,
    startedAt: now().toISOString(),
  };
  const candidate = await getUser(id);
  if (!candidate) {
    await ctx.reply("Your profile is missing. Tap Start test and enter your details again.");
    return;
  }
  candidate.currentAttempt = attempt.id;
  await saveAttempt(attempt);
  await saveUser(candidate);
  await renderQuestion(ctx, test, attempt, false);
});

composer.callbackQuery("test:resume", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return void (await ctx.reply("There is no active test to resume. Tap Start test to begin."));
  await renderQuestion(ctx, state.test, state.attempt, false);
});

composer.callbackQuery(/^test:a:(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return void (await ctx.reply("There is no active test. Tap Start test to begin."));
  const option = Number(ctx.match[1]);
  if (option < 0 || option > 3) return;
  const q = state.test.questions[state.attempt.currentQuestion];
  state.attempt.answers[q.id] = option;
  await saveAttempt(state.attempt);
  await renderQuestion(ctx, state.test, state.attempt);
});

composer.callbackQuery(/^(test:prev|test:next)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return;
  state.attempt.currentQuestion = Math.max(0, Math.min(state.test.questions.length - 1,
    state.attempt.currentQuestion + (ctx.match[1] === "test:next" ? 1 : -1)));
  await saveAttempt(state.attempt);
  await renderQuestion(ctx, state.test, state.attempt);
});

composer.callbackQuery("test:mark", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return;
  const qid = state.test.questions[state.attempt.currentQuestion].id;
  state.attempt.markedForReview = state.attempt.markedForReview.includes(qid)
    ? state.attempt.markedForReview.filter((id) => id !== qid)
    : [...state.attempt.markedForReview, qid];
  await saveAttempt(state.attempt);
  await renderQuestion(ctx, state.test, state.attempt);
});

composer.callbackQuery("test:lang", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return;
  const flow = sessionOf(ctx);
  flow.language = flow.language === "both" ? "en" : flow.language === "en" ? "hi" : "both";
  await renderQuestion(ctx, state.test, state.attempt);
});

composer.callbackQuery("test:submit", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return;
  const answered = Object.keys(state.attempt.answers).length;
  await ctx.editMessageText(`${answered}/${state.test.questions.length} questions answered. Submit your test?`, {
    reply_markup: inlineKeyboard([[inlineButton("Submit", "test:confirm"), inlineButton("Continue", "test:resume")]]),
  });
});

composer.callbackQuery("test:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const state = await current(ctx);
  if (!state) return;
  const score = state.test.questions.reduce((total, question) => total + (state.attempt.answers[question.id] === question.correctAnswer ? 1 : 0), 0);
  state.attempt.score = score;
  state.attempt.submittedAt = now().toISOString();
  await saveAttempt(state.attempt);
  const candidate = await getUser(state.id);
  if (candidate) {
    candidate.currentAttempt = undefined;
    await saveUser(candidate);
  }
  await ctx.editMessageText(`Your score is ${score}/${state.test.questions.length}. Review the explanations below.`, {
    reply_markup: inlineKeyboard([[inlineButton("Review explanations", "test:review:0")], [inlineButton("Back to menu", "menu:main")]]),
  });
});

composer.callbackQuery(/^test:review:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = userId(ctx);
  const attempts = id ? await listAttemptsForUser(id) : [];
  const attempt = [...attempts].reverse().find((entry) => Boolean(entry.submittedAt));
  const test = attempt ? await getTest(attempt.testId) : undefined;
  const index = Number(ctx.match[1]);
  if (!attempt || !test || !test.questions[index]) return void (await ctx.reply("No completed test is available to review."));
  const q = test.questions[index];
  const selected = attempt.answers[q.id];
  const text = [`Question ${index + 1}/${test.questions.length}`, q.question.en, q.question.hi,
    `Correct answer: ${String.fromCharCode(65 + q.correctAnswer)}`,
    selected === undefined ? "Your answer: Not answered" : `Your answer: ${String.fromCharCode(65 + selected)}`,
    q.explanation.en, q.explanation.hi].join("\n");
  const rows = [];
  if (index > 0) rows.push([inlineButton("Previous", `test:review:${index - 1}`)]);
  if (index + 1 < test.questions.length) rows.push([inlineButton("Next", `test:review:${index + 1}`)]);
  rows.push([inlineButton("Back to menu", "menu:main")]);
  await ctx.editMessageText(text, { reply_markup: inlineKeyboard(rows) });
});

composer.on("message:text", async (ctx, next) => {
  const flow = sessionOf(ctx);
  const value = ctx.message.text.trim();
  if (flow.testStep === "name") {
    if (value.length < 2 || value.length > 80) return void (await ctx.reply("Enter a name between 2 and 80 characters."));
    flow.pendingName = value;
    flow.testStep = "roll";
    await ctx.reply("Enter your roll number.", { reply_markup: forceReply("Type your roll number") });
    return;
  }
  if (flow.testStep === "roll") {
    if (!/^[A-Za-z0-9/-]{3,40}$/.test(value)) return void (await ctx.reply("Enter a valid roll number using letters, numbers, / or -."));
    const id = userId(ctx);
    if (!id || !flow.pendingName) return;
    await saveUser({ userId: id, name: flow.pendingName, rollNumber: value, darkModePreference: false });
    flow.testStep = undefined;
    flow.pendingName = undefined;
    await chooseTest(ctx);
    return;
  }
  return next();
});

// A stale or forwarded button still deserves an immediate Telegram acknowledgement.
composer.on("callback_query:data", async (ctx) => {
  await ctx.answerCallbackQuery();
});

export default composer;
