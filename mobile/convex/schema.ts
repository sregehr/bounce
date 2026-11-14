import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// There is no owner on these tables yet: accounts come next, and every table gets
// an owner field and index before this is deployed anywhere shared.
export default defineSchema({
  beats: defineTable({
    name: v.string(),
    audio: v.id("_storage"),
    durationSec: v.number(),
    sampleRate: v.number(),
    channels: v.number(),
    bitDepth: v.number(),
    source: v.union(v.literal("capture"), v.literal("import")),
    // Filled in by tempo and key detection, which does not exist yet.
    bpm: v.optional(v.number()),
    key: v.optional(v.string()),
  }),

  takes: defineTable({
    beatId: v.id("beats"),
    audio: v.id("_storage"),
    durationSec: v.number(),
    // How far the take is shifted against the beat on playback, from the device's latency test.
    compensationMs: v.number(),
  }).index("by_beat", ["beatId"]),
});
