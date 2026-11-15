import { getAuthUserId } from "@convex-dev/auth/server";
import { vAppleProfile } from "@convex-dev/auth/methods/apple/server";
import { vGoogleProfile } from "@convex-dev/auth/methods/google/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { aiAllowance } from "./entitlements";

const google = v.object({ name: v.literal("google"), profile: vGoogleProfile });
const apple = v.object({ name: v.literal("apple"), profile: vAppleProfile });

type Profile = { email?: string; emailVerified: boolean; name?: string; picture?: string };

/**
 * One person, one account: somebody who signs in with Google one day and Apple the next gets
 * the same user, as long as the provider vouches for the email. An unverified email never
 * joins an existing account.
 */
async function create(ctx: MutationCtx, profile: Profile): Promise<Id<"users">> {
  const email = profile.emailVerified ? profile.email?.toLowerCase() : undefined;
  if (email) {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) return existing._id;
  }
  return await ctx.db.insert("users", { email, name: profile.name, image: profile.picture });
}

/** Fills in whatever the account is still missing. Apple only sends the name the first time. */
async function refresh(ctx: MutationCtx, userId: Id<"users">, profile: Profile) {
  const user = await ctx.db.get(userId);
  if (!user) return;
  const patch: { name?: string; image?: string } = {};
  if (!user.name && profile.name) patch.name = profile.name;
  if (!user.image && profile.picture) patch.image = profile.picture;
  if (Object.keys(patch).length) await ctx.db.patch(userId, patch);
}

export const createFromGoogle = internalMutation({
  args: { method: google },
  returns: v.id("users"),
  handler: (ctx, { method }) => create(ctx, method.profile),
});

export const createFromApple = internalMutation({
  args: { method: apple },
  returns: v.id("users"),
  handler: (ctx, { method }) => create(ctx, method.profile),
});

export const signedInWithGoogle = internalMutation({
  args: { method: google, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { method, userId }) => {
    await refresh(ctx, userId, method.profile);
    return null;
  },
});

export const signedInWithApple = internalMutation({
  args: { method: apple, userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { method, userId }) => {
    await refresh(ctx, userId, method.profile);
    return null;
  },
});

/** The signed-in person and what they may still use, or null when nobody is signed in. */
export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      image: v.union(v.string(), v.null()),
      pro: v.boolean(),
      /** AI images left on the free allowance; null when there is no limit. */
      aiLeft: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId && (await ctx.db.get(userId));
    if (!user) return null;
    const allowance = aiAllowance(user);
    return { name: user.name ?? null, email: user.email ?? null, image: user.image ?? null, pro: allowance.pro, aiLeft: allowance.left };
  },
});

const ready = (...values: (string | undefined)[]) => values.every((value) => !!value && value !== "unset");

/** Which ways of signing in this server has been given credentials for. */
export const methods = query({
  args: {},
  returns: v.object({ google: v.boolean(), apple: v.boolean() }),
  handler: async () => ({
    google: ready(process.env.AUTH_GOOGLE_CLIENT_ID, process.env.AUTH_GOOGLE_CLIENT_SECRET),
    apple: ready(process.env.AUTH_APPLE_CLIENT_ID, process.env.AUTH_APPLE_TEAM_ID, process.env.AUTH_APPLE_KEY_ID, process.env.AUTH_APPLE_PRIVATE_KEY),
  }),
});
