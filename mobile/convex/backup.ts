import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

// A backup belongs to whoever holds the secret its device made up on first launch. The id says
// which backup; the secret proves the caller is that device. Only a hash of it is kept here.
export const owner = { deviceId: v.string(), secret: v.string() };

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
export async function owns(ctx: QueryCtx, deviceId: string, secret: string) {
  const row = await secretRow(ctx, deviceId);
  return !!row && row.hash === (await hashOf(secret));
}

/** Refuses anyone but the device itself. The first call from a device registers its secret. */
export async function requireOwner(ctx: MutationCtx, deviceId: string, secret: string) {
  if (deviceId.length < 16 || deviceId.length > 128 || secret.length < 32 || secret.length > 128) throw new Error("Not allowed.");
  const hash = await hashOf(secret);
  const row = await secretRow(ctx, deviceId);
  if (!row) {
    await countNewDevice(ctx);
    await ctx.db.insert("deviceSecrets", { deviceId, hash });
  } else if (row.hash !== hash) throw new Error("Not allowed.");
}

// How often. Set NEW_DEVICES_PER_HOUR or UPLOADS_PER_HOUR on the server to change them.
const HOUR = 60 * 60 * 1000;
const perHour = (name: string, fallback: number) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

/**
 * Each new device gets its own allowance, so the number that may register in an hour is capped
 * across everyone. The server cannot tell callers apart any other way: it sees no address.
 */
async function countNewDevice(ctx: MutationCtx) {
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_name", (q) => q.eq("name", "newDevices"))
    .unique();
  if (!row) await ctx.db.insert("rateLimits", { name: "newDevices", hourAt: now, count: 1 });
  else if (now - row.hourAt >= HOUR) await ctx.db.patch(row._id, { hourAt: now, count: 1 });
  else if (row.count >= perHour("NEW_DEVICES_PER_HOUR", 120)) throw new Error("Too many new devices just now. Backup will try again shortly.");
  else await ctx.db.patch(row._id, { count: row.count + 1 });
}

/** Caps how many upload addresses one device may ask for in an hour. */
async function countUpload(ctx: MutationCtx, deviceId: string) {
  const now = Date.now();
  const row = await secretRow(ctx, deviceId);
  if (!row) return;
  if (row.hourAt === undefined || now - row.hourAt >= HOUR) await ctx.db.patch(row._id, { hourAt: now, uploads: 1 });
  else if ((row.uploads ?? 0) >= perHour("UPLOADS_PER_HOUR", 1000)) throw new Error("Too many uploads this hour. Backup will carry on later.");
  else await ctx.db.patch(row._id, { uploads: (row.uploads ?? 0) + 1 });
}

// How much one device may keep here. Set BACKUP_MAX_MB, BACKUP_MAX_FILE_MB or SHARE_MAX_FILE_MB on the server to change them.
const MB = 1024 * 1024;
const megabytes = (name: string, fallback: number) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback) * MB;
export const LIMITS = {
  /** The whole backup of one device. */
  bytes: () => megabytes("BACKUP_MAX_MB", 4096),
  /** One file in a backup: a long beat as a 24-bit WAV fits. */
  file: () => megabytes("BACKUP_MAX_FILE_MB", 300),
  /** The audio behind one listening link. */
  share: () => megabytes("SHARE_MAX_FILE_MB", 150),
  files: 2000,
  projects: 1000,
  shares: 100,
  /** The picture behind one listening link. The app sends it scaled down, so this is generous. */
  cover: 8 * 1024 * 1024,
};

/** The true size of an uploaded file, as the server stored it; what the app says it sent is not trusted. */
export async function storedFile(ctx: QueryCtx, storageId: Id<"_storage">) {
  return await ctx.db.system.get(storageId);
}

/** What a device's backup holds. Devices from before the count was kept are added up once. */
async function usage(ctx: QueryCtx, deviceId: string) {
  const row = await secretRow(ctx, deviceId);
  if (row && row.bytes !== undefined && row.files !== undefined) return { bytes: row.bytes, files: row.files };
  const files = await ctx.db
    .query("backupFiles")
    .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId))
    .take(LIMITS.files);
  return { bytes: files.reduce((n, f) => n + f.size, 0), files: files.length };
}

async function setUsage(ctx: MutationCtx, deviceId: string, next: { bytes: number; files: number }) {
  const row = await secretRow(ctx, deviceId);
  if (row) await ctx.db.patch(row._id, { bytes: Math.max(0, next.bytes), files: Math.max(0, next.files) });
}

/** How full this device's backup is and what it may hold, so the app can stop before sending a file that would be refused. */
export const room = query({
  args: owner,
  returns: v.object({ bytes: v.number(), maxBytes: v.number(), maxFile: v.number(), files: v.number(), maxFiles: v.number() }),
  handler: async (ctx, { deviceId, secret }) => {
    const used = (await owns(ctx, deviceId, secret)) ? await usage(ctx, deviceId) : { bytes: 0, files: 0 };
    return { ...used, maxBytes: LIMITS.bytes(), maxFile: LIMITS.file(), maxFiles: LIMITS.files };
  },
});

/** A short-lived address the app uploads one file to. */
export const uploadUrl = mutation({
  args: owner,
  returns: v.string(),
  handler: async (ctx, { deviceId, secret }) => {
    await requireOwner(ctx, deviceId, secret);
    await countUpload(ctx, deviceId);
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

/**
 * Records an uploaded file in the backup. A file that is too big, or that the backup has no room
 * for, is thrown away and the answer says which, so the app can tell the user instead of trying again.
 */
export const saveFile = mutation({
  args: { ...owner, key: v.string(), storageId: v.id("_storage"), size: v.number() },
  returns: v.union(v.literal("saved"), v.literal("too_big"), v.literal("full")),
  handler: async (ctx, { secret, deviceId, key, storageId }) => {
    await requireOwner(ctx, deviceId, secret);
    const stored = await storedFile(ctx, storageId);
    if (!stored) throw new Error("That upload was not found.");
    const refuse = async (why: "too_big" | "full") => {
      await ctx.storage.delete(storageId);
      return why;
    };
    if (key.length > 200 || stored.size > LIMITS.file()) return await refuse("too_big");
    const existing = await ctx.db
      .query("backupFiles")
      .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId).eq("key", key))
      .unique();
    if (existing) {
      // The same key always holds the same file, so the second copy is not needed.
      await ctx.storage.delete(storageId);
      return "saved" as const;
    }
    const used = await usage(ctx, deviceId);
    if (used.bytes + stored.size > LIMITS.bytes() || used.files >= LIMITS.files) return await refuse("full");
    await ctx.db.insert("backupFiles", { deviceId, key, storageId, size: stored.size });
    await setUsage(ctx, deviceId, { bytes: used.bytes + stored.size, files: used.files + 1 });
    return "saved" as const;
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
    else {
      const all = await ctx.db
        .query("backupProjects")
        .withIndex("by_device_local", (q) => q.eq("deviceId", args.deviceId))
        .take(LIMITS.projects);
      if (all.length >= LIMITS.projects) throw new Error("This backup holds as many songs as it can.");
      await ctx.db.insert("backupProjects", args);
    }
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
    const used = await usage(ctx, deviceId);
    for (const key of fileKeys.slice(0, 200)) {
      const file = await ctx.db
        .query("backupFiles")
        .withIndex("by_device_key", (q) => q.eq("deviceId", deviceId).eq("key", key))
        .unique();
      if (!file) continue;
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
      used.bytes -= file.size;
      used.files -= 1;
    }
    await setUsage(ctx, deviceId, used);
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
    const used = await usage(ctx, deviceId);
    for (const file of files) {
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
      used.bytes -= file.size;
      used.files -= 1;
    }
    await setUsage(ctx, deviceId, used);
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
