import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { spikeOnly } from "./beats";

export const create = mutation({
  args: {
    beatId: v.id("beats"),
    audio: v.id("_storage"),
    durationSec: v.number(),
    compensationMs: v.number(),
  },
  returns: v.id("takes"),
  handler: async (ctx, args) => {
    spikeOnly();
    if (!(await ctx.db.get(args.beatId))) {
      throw new Error("That beat no longer exists.");
    }
    return await ctx.db.insert("takes", args);
  },
});

export const listForBeat = query({
  args: { beatId: v.id("beats") },
  returns: v.array(
    v.object({
      _id: v.id("takes"),
      _creationTime: v.number(),
      durationSec: v.number(),
      compensationMs: v.number(),
      audioUrl: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { beatId }) => {
    const takes = await ctx.db
      .query("takes")
      .withIndex("by_beat", (q) => q.eq("beatId", beatId))
      .order("desc")
      .take(100);
    return await Promise.all(
      takes.map(async (take) => ({
        _id: take._id,
        _creationTime: take._creationTime,
        durationSec: take.durationSec,
        compensationMs: take.compensationMs,
        audioUrl: await ctx.storage.getUrl(take.audio),
      })),
    );
  },
});
