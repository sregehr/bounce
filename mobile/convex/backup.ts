import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

// A backup belongs to whoever holds the secret its device made up on first launch. The id says
// which backup; the secret proves the caller is that device. Only a hash of it is kept here.
const owner = { deviceId: v.string(), secret: v.string() };

async function hashOf(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const secretRow = (ctx: QueryCtx, deviceId: string) =>
  ctx.db
    .query("deviceSecrets")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .unique();

/** True when the secret is the one this device registered. A device nobody has registered owns nothing yet. */
async function owns(ctx: QueryCtx, deviceId: string, secret: string) {
  const row = await secretRow(ctx, deviceId);
  return !!row && row.hash === (await hashOf(secret));
}

/** Refuses anyone but the device itself. The first call from a device registers its secret. */
async function requireOwner(ctx: MutationCtx, deviceId: string, secret: string) {
  if (deviceId.length < 16 || deviceId.length > 128 || secret.length < 32 || secret.length > 128) throw new Error("Not allowed.");
  const hash = await hashOf(secret);
  const row = await secretRow(ctx, deviceId);
  if (!row) await ctx.db.insert("deviceSecrets", { deviceId, hash });
  else if (row.hash !== hash) throw new Error("Not allowed.");
}

/** A short-lived address the app uploads one file to. */
export const uploadUrl = mutation({
  args: owner,
  returns: v.string(),
  handler: async (ctx, { deviceId, secret }) => {
    await requireOwner(ctx, deviceId, secret);
    return await ctx.storage.generateUploadUrl();
  },
});

/** The files already backed up for a device, so the app only sends what is missing. */
export const fileKeys = query({
  args: owner,
  returns: v.array(v.string()),
  handler: async (ctx, { deviceId, secret }) => {
    if (!(await owns(ctx, deviceId, secret))) return [];
    const rows = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId))
      .take(2000);
    return rows.map((r) => r.key);
  },
});

export const saveFile = mutation({
  args: { ...owner, key: v.string(), storageId: v.id("_storage"), size: v.number() },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    await requireOwner(ctx, args.deviceId, secret);
    const existing = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", args.deviceId).eq("key", args.key))
      .unique();
    if (existing) {
      // The same key always holds the same file, so the second copy is not needed.
      await ctx.storage.delete(args.storageId);
      return null;
    }
    await ctx.db.insert("backupFiles", args);
    return null;
  },
});

export const saveProject = mutation({
  args: { ...owner, localId: v.string(), name: v.string(), updatedAt: v.number(), data: v.string() },
  returns: v.null(),
  handler: async (ctx, { secret, ...args }) => {
    await requireOwner(ctx, args.deviceId, secret);
    const existing = await ctx.db
      .query("backupProjects")
      .withIndex("by_device_local", (q) => q.eq("deviceId", args.deviceId).eq("localId", args.localId))
      .unique();
    if (existing) await ctx.db.replace(existing._id, args);
    else await ctx.db.insert("backupProjects", args);
    return null;
  },
});

/** Removes a project and any of the listed files that nothing else on the device still uses. */
export const removeProject = mutation({
  args: { ...owner, localId: v.string(), fileKeys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { deviceId, secret, localId, fileKeys }) => {
    await requireOwner(ctx, deviceId, secret);
    const project = await ctx.db
      .query("backupProjects")
      .withIndex("by_device_local", (q) => q.eq("deviceId", deviceId).eq("localId", localId))
      .unique();
    if (project) await ctx.db.delete(project._id);
    for (const key of fileKeys.slice(0, 200)) {
      const file = await ctx.db
        .query("backupFiles")
        .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId).eq("key", key))
        .unique();
      if (!file) continue;
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
    }
    return null;
  },
});

export const summary = query({
  args: owner,
  returns: v.object({ projects: v.number(), files: v.number(), bytes: v.number() }),
  handler: async (ctx, { deviceId, secret }) => {
    if (!(await owns(ctx, deviceId, secret))) return { projects: 0, files: 0, bytes: 0 };
    const projects = await ctx.db
      .query("backupProjects")
      .withIndex("by_device_local", (q) => q.eq("deviceId", deviceId))
      .take(1000);
    const files = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId))
      .take(2000);
    return { projects: projects.length, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
  },
});

/** Links this device's backup to whoever is signed in on it. */
export const claim = mutation({
  args: owner,
  returns: v.null(),
  handler: async (ctx, { deviceId, secret }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    await requireOwner(ctx, deviceId, secret);
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .unique();
    // A device stays with the first account that claimed it.
    if (!existing) await ctx.db.insert("devices", { deviceId, userId });
    return null;
  },
});

/**
 * Deletes a device's whole backup, for "Delete everything on this device". It works through a
 * batch at a time and returns true once nothing is left, so the app calls it until it does.
 */
export const erase = mutation({
  args: owner,
  returns: v.boolean(),
  handler: async (ctx, { deviceId, secret }) => {
    // Someone who never backed up has nothing here, and must not register by asking to erase.
    if (!(await owns(ctx, deviceId, secret))) {
      if (await secretRow(ctx, deviceId)) throw new Error("Not allowed.");
      return true;
    }
    const files = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId))
      .take(100);
    for (const file of files) {
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
    }
    const projects = await ctx.db
      .query("backupProjects")
      .withIndex("by_device_local", (q) => q.eq("deviceId", deviceId))
      .take(100);
    for (const project of projects) await ctx.db.delete(project._id);
    if (files.length === 100 || projects.length === 100) return false;
    const link = await ctx.db
      .query("devices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .unique();
    if (link) await ctx.db.delete(link._id);
    const row = await secretRow(ctx, deviceId);
    if (row) await ctx.db.delete(row._id);
    return true;
  },
});

/**
 * Everything in a device's backup, for bringing it onto another device: each project as the app
 * stores it, and a short-lived address for each of its files. Only the device's own secret opens it.
 */
export const restore = query({
  args: owner,
  returns: v.union(
    v.null(),
    v.object({
      projects: v.array(v.object({ localId: v.string(), data: v.string() })),
      files: v.array(v.object({ key: v.string(), url: v.union(v.string(), v.null()), size: v.number() })),
    }),
  ),
  handler: async (ctx, { deviceId, secret }) => {
    if (!(await owns(ctx, deviceId, secret))) return null;
    const projects = await ctx.db
      .query("backupProjects")
      .withIndex("by_device_local", (q) => q.eq("deviceId", deviceId))
      .take(1000);
    const files = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId))
      .take(2000);
    return {
      projects: projects.map((p) => ({ localId: p.localId, data: p.data })),
      files: await Promise.all(files.map(async (f) => ({ key: f.key, url: await ctx.storage.getUrl(f.storageId), size: f.size }))),
    };
  },
});
