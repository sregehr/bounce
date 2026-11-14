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

  // Backup of the app's local library. Until there are accounts, a random id made on each
  // device stands in for the owner; anyone holding that id can read that device's backup.
  backupProjects: defineTable({
    deviceId: v.string(),
    localId: v.string(),
    name: v.string(),
    updatedAt: v.number(),
    /** The project as the app stores it, as JSON. */
    data: v.string(),
  }).index("by_device_local", ["deviceId", "localId"]),

  backupFiles: defineTable({
    deviceId: v.string(),
    key: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
  }).index("by_device_key", ["deviceId", "key"]),

  takes: defineTable({
    beatId: v.id("beats"),
    audio: v.id("_storage"),
    durationSec: v.number(),
    // How far the take is shifted against the beat on playback, from the device's latency test.
    compensationMs: v.number(),
  }).index("by_beat", ["beatId"]),
});
