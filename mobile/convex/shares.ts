import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { LIMITS, owner, owns, requireOwner, storedFile } from "./backup";

const MAX_NOTES = 300;

/** How long a new link's code is. Links made before it was shortened have 36 characters and still open. */
const TOKEN_LENGTH = 12;

/** A code nobody could guess, short enough to read out: twelve of a to z and 0 to 9, about 62 bits. */
function newToken() {
  let token = "";
  while (token.length < TOKEN_LENGTH) {
    const bytes = new Uint8Array(TOKEN_LENGTH * 2);
    crypto.getRandomValues(bytes);
    // 252 is the largest multiple of 36 a byte can hold; anything above it would favour the first few characters.
    for (const b of bytes) if (b < 252 && token.length < TOKEN_LENGTH) token += (b % 36).toString(36);
  }
  return token;
}

/**
 * Puts a song up behind a listening link, or replaces the audio behind the link it already has,
 * so a link that was sent keeps working after a new mix. Returns the link's token, or an empty
 * string when the audio is too big or the device already has as many links as it may.
 */
export const create = mutation({
  args: { ...owner, localId: v.string(), title: v.string(), artist: v.string(), producer: v.optional(v.string()), audio: v.id("_storage"), durationSec: v.number(), peaks: v.array(v.number()), cover: v.optional(v.id("_storage")) },
  returns: v.string(),
  handler: async (ctx, { secret, cover: sent, ...args }) => {
    await requireOwner(ctx, args.deviceId, secret);
    // The picture is only kept when it is one, of a sensible size; the link is made without it otherwise.
    const picture = sent ? await storedFile(ctx, sent) : null;
    const cover = sent && picture && picture.size <= LIMITS.cover && /^image\/(jpeg|png|webp)$/.test(picture.contentType ?? "") ? sent : undefined;
    if (sent && picture && !cover) await ctx.storage.delete(sent);
    // Only audio of a sensible size goes behind a link; anything else is thrown away.
    const stored = await storedFile(ctx, args.audio);
    if (!stored) throw new Error("That upload was not found.");
    if (stored.size > LIMITS.share() || !(stored.contentType ?? "").startsWith("audio/")) {
      await ctx.storage.delete(args.audio);
      if (cover) await ctx.storage.delete(cover);
      return "";
    }
    const song = { ...args, title: args.title.slice(0, 80), artist: args.artist.slice(0, 80), producer: args.producer?.trim().slice(0, 80) || undefined, peaks: args.peaks.slice(0, 160).map((p) => Math.max(0, Math.min(1, p))) };
    const existing = await ctx.db
      .query("shares")
      .withIndex("by_device_local", (q) => q.eq("deviceId", args.deviceId).eq("localId", args.localId))
      .unique();
    if (existing) {
      if (existing.audio !== song.audio) await ctx.storage.delete(existing.audio);
      // The link shows the song as it is now: a new cover replaces the old one, and a song with none loses it.
      if (existing.cover && existing.cover !== cover) await ctx.storage.delete(existing.cover);
      await ctx.db.patch(existing._id, { ...song, cover });
      return existing.token;
    }
    const mine = await ctx.db
      .query("shares")
      .withIndex("by_device_local", (q) => q.eq("deviceId", args.deviceId))
      .take(LIMITS.shares);
    if (mine.length >= LIMITS.shares) {
      await ctx.storage.delete(args.audio);
      if (cover) await ctx.storage.delete(cover);
      return "";
    }
    const token = newToken();
    await ctx.db.insert("shares", { ...song, cover, token });
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
    if (share.cover) await ctx.storage.delete(share.cover);
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
      producer: share.producer ?? null,
      durationSec: share.durationSec,
      peaks: share.peaks,
      audioUrl: await ctx.storage.getUrl(share.audio),
      coverUrl: share.cover ? await ctx.storage.getUrl(share.cover) : null,
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
