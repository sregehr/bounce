import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** A short-lived address the app uploads one file to. */
export const uploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** The files already backed up for a device, so the app only sends what is missing. */
export const fileKeys = query({
  args: { deviceId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { deviceId }) => {
    const rows = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId))
      .take(2000);
    return rows.map((r) => r.key);
  },
});

export const saveFile = mutation({
  args: { deviceId: v.string(), key: v.string(), storageId: v.id("_storage"), size: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
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
  args: { deviceId: v.string(), localId: v.string(), name: v.string(), updatedAt: v.number(), data: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
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
  args: { deviceId: v.string(), localId: v.string(), fileKeys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { deviceId, localId, fileKeys }) => {
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
  args: { deviceId: v.string() },
  returns: v.object({ projects: v.number(), files: v.number(), bytes: v.number() }),
  handler: async (ctx, { deviceId }) => {
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
