import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// These endpoints, and the ones in takes.ts, are the early prototype behind the /spike screen.
// They have no owner and take uploads from anyone, so they answer only where ALLOW_SPIKE is set
// to 1 on the server, which a shared deployment should not do.
export function spikeOnly() {
  if (process.env.ALLOW_SPIKE !== "1") throw new Error("The prototype library is switched off on this server.");
}

/** A short-lived address the app uploads an audio file to. */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    spikeOnly();
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    audio: v.id("_storage"),
    durationSec: v.number(),
    sampleRate: v.number(),
    channels: v.number(),
    bitDepth: v.number(),
    source: v.union(v.literal("capture"), v.literal("import")),
  },
  returns: v.id("beats"),
  handler: async (ctx, args) => {
    spikeOnly();
    return await ctx.db.insert("beats", args);
  },
});

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("beats"),
      _creationTime: v.number(),
      name: v.string(),
      durationSec: v.number(),
      sampleRate: v.number(),
      channels: v.number(),
      bitDepth: v.number(),
      bpm: v.optional(v.number()),
      key: v.optional(v.string()),
      takeCount: v.number(),
      audioUrl: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const beats = await ctx.db.query("beats").order("desc").take(50);
    return await Promise.all(
      beats.map(async (beat) => {
        const takes = await ctx.db
          .query("takes")
          .withIndex("by_beat", (q) => q.eq("beatId", beat._id))
          .take(100);
        return {
          _id: beat._id,
          _creationTime: beat._creationTime,
          name: beat.name,
          durationSec: beat.durationSec,
          sampleRate: beat.sampleRate,
          channels: beat.channels,
          bitDepth: beat.bitDepth,
          bpm: beat.bpm,
          key: beat.key,
          takeCount: takes.length,
          audioUrl: await ctx.storage.getUrl(beat.audio),
        };
      }),
    );
  },
});

/** Deletes a beat, its takes and their audio files. */
export const remove = mutation({
  args: { beatId: v.id("beats") },
  returns: v.null(),
  handler: async (ctx, { beatId }) => {
    spikeOnly();
    const beat = await ctx.db.get(beatId);
    if (!beat) return null;
    const takes = await ctx.db
      .query("takes")
      .withIndex("by_beat", (q) => q.eq("beatId", beatId))
      .collect();
    for (const take of takes) {
      await ctx.storage.delete(take.audio);
      await ctx.db.delete(take._id);
    }
    await ctx.storage.delete(beat.audio);
    await ctx.db.delete(beatId);
    return null;
  },
});
