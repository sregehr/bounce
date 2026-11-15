import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { aiAllowance } from "./entitlements";

// Cover art from a description, made by an image model through OpenRouter. The key stays on
// the server (OPENROUTER_API_KEY); the app only ever calls `cover`.

const MODEL = () => process.env.AI_IMAGE_MODEL || "google/gemini-2.5-flash-image";
const kind = v.union(v.literal("backdrop"), v.literal("restyle"));

/** What the app is told when a cover cannot be made. `code` lets it react; `message` is shown as is. */
const refuse = (code: "SIGN_IN" | "LIMIT" | "SETUP" | "FAILED", message: string) => new ConvexError({ code, message });

/** Checks the allowance and counts the image against it, before any money is spent. */
export const reserve = internalMutation({
  args: { userId: v.id("users"), kind, prompt: v.string(), model: v.string() },
  returns: v.id("aiImages"),
  handler: async (ctx, { userId, kind, prompt, model }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw refuse("SIGN_IN", "Sign in to make covers with AI.");
    if (aiAllowance(user).left === 0) throw refuse("LIMIT", "You have used your free AI covers.");
    await ctx.db.patch(userId, { aiUsed: (user.aiUsed ?? 0) + 1 });
    return await ctx.db.insert("aiImages", { userId, kind, prompt, model, status: "pending" });
  },
});

/** Records how a reserved image turned out. One that failed is handed back to the allowance. */
export const settle = internalMutation({
  args: { id: v.id("aiImages"), ok: v.boolean(), costUsd: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, ok, costUsd }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "pending") return null;
    await ctx.db.patch(id, { status: ok ? "made" : "failed", costUsd });
    if (!ok) {
      const user = await ctx.db.get(row.userId);
      if (user) await ctx.db.patch(row.userId, { aiUsed: Math.max(0, (user.aiUsed ?? 0) - 1) });
    }
    return null;
  },
});

/** Who is calling, looked up from a query because that is where the session can be read. */
export const caller = internalQuery({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => await getAuthUserId(ctx),
});

export const allowance = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user ? aiAllowance(user).left : 0;
  },
});

const ASK = {
  backdrop: (scene: string) =>
    `A background for a music single's cover art: ${scene}. Portrait orientation. No people, no faces, no text, no logos, no borders. ` +
    `Cinematic light and depth, with the lower middle of the frame left uncluttered so a performer can be placed there afterwards.`,
  restyle: (scene: string) =>
    `Turn this photo into cover art for a music single. Keep the person exactly who they are: the same face, skin tone, hair, build and expression. ` +
    `Place them in this setting, lit to match it: ${scene}. Portrait orientation, head and shoulders to waist, no text, no logos, no borders.`,
};

type Reply = { data?: { b64_json?: string; media_type?: string }[]; usage?: { cost?: number }; error?: { message?: string } };

export const cover = action({
  args: {
    kind,
    /** The scene, in the user's words. */
    prompt: v.string(),
    /** For a restyle: the photo of the artist, as a data URL. */
    photo: v.optional(v.string()),
  },
  returns: v.object({ image: v.string(), mediaType: v.string(), left: v.union(v.number(), v.null()) }),
  handler: async (ctx, args): Promise<{ image: string; mediaType: string; left: number | null }> => {
    const userId: Id<"users"> | null = await ctx.runQuery(internal.ai.caller, {});
    if (!userId) throw refuse("SIGN_IN", "Sign in to make covers with AI.");
    const scene = args.prompt.replace(/\s+/g, " ").trim().slice(0, 300);
    if (scene.length < 3) throw refuse("FAILED", "Describe the scene in a few words first.");
    if (args.kind === "restyle" && !args.photo?.startsWith("data:image/")) throw refuse("FAILED", "Add a photo of the artist first.");
    if ((args.photo?.length ?? 0) > 6_000_000) throw refuse("FAILED", "That photo is too large to send.");
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw refuse("SETUP", "AI covers are not set up on this server yet.");

    const model = MODEL();
    const id: Id<"aiImages"> = await ctx.runMutation(internal.ai.reserve, { userId, kind: args.kind, prompt: scene, model });
    const fail = async (message: string) => {
      await ctx.runMutation(internal.ai.settle, { id, ok: false });
      return refuse("FAILED", message);
    };

    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Bounce" },
        body: JSON.stringify({
          model,
          prompt: ASK[args.kind](scene),
          aspect_ratio: "4:5",
          ...(args.kind === "restyle" ? { input_references: [{ type: "image_url", image_url: { url: args.photo } }] } : null),
        }),
      });
    } catch {
      throw await fail("The image service could not be reached. Try again in a moment.");
    }
    const reply = (await response.json().catch(() => ({}))) as Reply;
    const made = reply.data?.[0];
    if (!response.ok || !made?.b64_json) {
      console.error("OpenRouter image request failed", response.status, reply.error?.message);
      throw await fail(
        response.status === 401 || response.status === 402
          ? "AI covers are unavailable right now. Nothing was used from your allowance."
          : response.status === 429
            ? "The image service is busy. Try again in a moment."
            : "That one did not come out. Try describing the scene another way.",
      );
    }
    await ctx.runMutation(internal.ai.settle, { id, ok: true, costUsd: reply.usage?.cost });
    const left: number | null = await ctx.runQuery(internal.ai.allowance, { userId });
    return { image: made.b64_json, mediaType: made.media_type ?? "image/png", left };
  },
});
