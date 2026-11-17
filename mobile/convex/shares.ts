import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { LIMITS, owner, owns, requireOwner, storedFile } from "./backup";

const MAX_NOTES = 300;

function newToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("");
}

/**
 * Puts a song up behind a listening link, or replaces the audio behind the link it already has,
 * so a link that was sent keeps working after a new mix. Returns the link's token, or an empty
 * string when the audio is too big or the device already has as many links as it may.
 */
export const create = mutation({
  args: { ...owner, localId: v.string(), title: v.string(), artist: v.string(), audio: v.id("_storage"), durationSec: v.number(), peaks: v.array(v.number()) },
  returns: v.string(),
  handler: async (ctx, { secret, ...args }) => {
    await requireOwner(ctx, args.deviceId, secret);
    // Only audio of a sensible size goes behind a link; anything else is thrown away.
    const stored = await storedFile(ctx, args.audio);
    if (!stored) throw new Error("That upload was not found.");
    if (stored.size > LIMITS.share() || !(stored.contentType ?? "").startsWith("audio/")) {
      await ctx.storage.delete(args.audio);
      return "";
    }
    const song = { ...args, title: args.title.slice(0, 80), artist: args.artist.slice(0, 80), peaks: args.peaks.slice(0, 160).map((p) => Math.max(0, Math.min(1, p))) };
    const existing = await ctx.db
      .query("shares")
      .withIndex("by_device_local", (q) => q.eq("deviceId", args.deviceId).eq("localId", args.localId))
      .unique();
    if (existing) {
      if (existing.audio !== song.audio) await ctx.storage.delete(existing.audio);
      await ctx.db.patch(existing._id, song);
      return existing.token;
    }
    const mine = await ctx.db
      .query("shares")
      .withIndex("by_device_local", (q) => q.eq("deviceId", args.deviceId))
      .take(LIMITS.shares);
    if (mine.length >= LIMITS.shares) {
      await ctx.storage.delete(args.audio);
      return "";
    }
    const token = newToken();
    await ctx.db.insert("shares", { ...song, token });
    return token;
  },
});

/** Takes a listening link down, with its audio and notes. */
export const remove = mutation({
  args: { ...owner, localId: v.string() },
  returns: v.null(),
  handler: async (ctx, { deviceId, secret, localId }) => {
    await requireOwner(ctx, deviceId, secret);
    const share = await ctx.db
      .query("shares")
      .withIndex("by_device_local", (q) => q.eq("deviceId", deviceId).eq("localId", localId))
      .unique();
    if (!share) return null;
    const notes = await ctx.db
      .query("shareNotes")
      .withIndex("by_share", (q) => q.eq("shareId", share._id))
      .take(MAX_NOTES);
    for (const note of notes) await ctx.db.delete(note._id);
    await ctx.storage.delete(share.audio);
    await ctx.db.delete(share._id);
    return null;
  },
});

/** The notes people have left on a song's listening link, for the device that shared it. */
export const notes = query({
  args: { ...owner, localId: v.string() },
  returns: v.union(v.null(), v.object({ token: v.string(), notes: v.array(v.object({ atSec: v.number(), name: v.string(), text: v.string(), at: v.number() })) })),
  handler: async (ctx, { deviceId, secret, localId }) => {
    if (!(await owns(ctx, deviceId, secret))) return null;
    const share = await ctx.db
      .query("shares")
      .withIndex("by_device_local", (q) => q.eq("deviceId", deviceId).eq("localId", localId))
      .unique();
    if (!share) return null;
    const rows = await ctx.db
      .query("shareNotes")
      .withIndex("by_share", (q) => q.eq("shareId", share._id))
      .take(MAX_NOTES);
    return { token: share.token, notes: rows.map((n) => ({ atSec: n.atSec, name: n.name, text: n.text, at: n._creationTime })).sort((a, b) => a.atSec - b.atSec) };
  },
});

// ---------- Behind the page at /s/<token> ----------

/** What the listening page shows for a link. The token is the only thing that opens it. */
export const page = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const share = await ctx.db
      .query("shares")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!share) return null;
    const rows = await ctx.db
      .query("shareNotes")
      .withIndex("by_share", (q) => q.eq("shareId", share._id))
      .take(MAX_NOTES);
    return {
      title: share.title,
      artist: share.artist,
      durationSec: share.durationSec,
      peaks: share.peaks,
      audioUrl: await ctx.storage.getUrl(share.audio),
      notes: rows.map((n) => ({ atSec: n.atSec, name: n.name, text: n.text })).sort((a, b) => a.atSec - b.atSec),
    };
  },
});

/** Adds a note from the listening page. Returns false when the link is gone or full. */
export const addNote = internalMutation({
  args: { token: v.string(), atSec: v.number(), name: v.string(), text: v.string() },
  handler: async (ctx, { token, atSec, name, text }) => {
    const share = await ctx.db
      .query("shares")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    const said = text.trim().slice(0, 280);
    if (!share || !said) return false;
    const rows = await ctx.db
      .query("shareNotes")
      .withIndex("by_share", (q) => q.eq("shareId", share._id))
      .take(MAX_NOTES);
    if (rows.length >= MAX_NOTES) return false;
    await ctx.db.insert("shareNotes", { shareId: share._id, atSec: Math.max(0, Math.min(share.durationSec, Number.isFinite(atSec) ? atSec : 0)), name: name.trim().slice(0, 40) || "Someone", text: said });
    return true;
  },
});
