import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";

// An upload only counts once something points at it: a backup, a listening link, a beat or a take.
// The app registers a file seconds after sending it, so one that is still unclaimed after an hour
// was abandoned, or was sent by someone who never meant to register it.
const GRACE_MS = 60 * 60 * 1000;
/** How far back each hourly run looks. Longer than the gap between runs, so a missed run is caught by the next. */
const WINDOW_MS = 8 * 60 * 60 * 1000;
const BATCH = 100;

/** True when any table still points at this file. A new table that keeps files must be added here. */
async function claimed(ctx: QueryCtx, id: Id<"_storage">) {
  if (await ctx.db.query("backupFiles").withIndex("by_storage", (q) => q.eq("storageId", id)).first()) return true;
  if (await ctx.db.query("shares").withIndex("by_audio", (q) => q.eq("audio", id)).first()) return true;
  if (await ctx.db.query("beats").withIndex("by_audio", (q) => q.eq("audio", id)).first()) return true;
  if (await ctx.db.query("takes").withIndex("by_audio", (q) => q.eq("audio", id)).first()) return true;
  return false;
}

/**
 * Deletes uploads that nothing claimed. Runs every hour over the last few hours; `all` goes
 * through every file ever stored, and `dryRun` only counts. A long run carries on in further calls,
 * and the last of them logs the totals. Returns what has been counted so far.
 */
export const sweep = internalMutation({
  args: { after: v.optional(v.number()), all: v.optional(v.boolean()), dryRun: v.optional(v.boolean()), graceMs: v.optional(v.number()), checked: v.optional(v.number()), removed: v.optional(v.number()) },
  returns: v.object({ checked: v.number(), removed: v.number(), more: v.boolean() }),
  handler: async (ctx, { after, all, dryRun, graceMs, checked = 0, removed = 0 }) => {
    const until = Date.now() - (graceMs ?? GRACE_MS);
    const from = after ?? (all ? 0 : until - WINDOW_MS);
    const files = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) => q.gt("_creationTime", from).lt("_creationTime", until))
      .take(BATCH);
    for (const file of files) {
      checked++;
      if (await claimed(ctx, file._id)) continue;
      removed++;
      if (!dryRun) await ctx.storage.delete(file._id);
    }
    if (files.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.sweep, { after: files[files.length - 1]._creationTime, all, dryRun, graceMs, checked, removed });
      return { checked, removed, more: true };
    }
    if (removed || all) console.log(`Unclaimed uploads: ${dryRun ? "would remove" : "removed"} ${removed} of ${checked} checked.`);
    return { checked, removed, more: false };
  },
});
