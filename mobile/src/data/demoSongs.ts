// The demo songs: the original soundtrack of Get a Life, bundled in `public/demo`.
// Provenance and usage terms are recorded in that project (assets/original-soundtrack).

export const DEMO_GROUPS = ["Hip-hop", "Trap", "Funk and boogie", "House", "Synth-pop"] as const;

export type DemoSong = {
  /** Also the file name: `/demo/<id>.m4a`. */
  id: string;
  title: string;
  group: (typeof DEMO_GROUPS)[number];
  style: string;
  /** The tempo the song was written at; the detected tempo is checked against it. */
  bpm: number;
  seconds: number;
};

export const DEMO_SONGS: DemoSong[] = [
  { id: "small-steps-big-city", title: "Small Steps, Big City", group: "Hip-hop", style: "West Coast hip-hop", bpm: 94, seconds: 45 },
  { id: "sunday-test-drive", title: "Sunday Test Drive", group: "Hip-hop", style: "West Coast cruising", bpm: 96, seconds: 45 },
  { id: "coffee-after-rain", title: "Coffee After Rain", group: "Hip-hop", style: "Warm West Coast", bpm: 92, seconds: 45 },
  { id: "open-court-afternoon", title: "Open Court Afternoon", group: "Hip-hop", style: "Street-court hip-hop", bpm: 98, seconds: 45 },
  { id: "stories-on-the-shelf", title: "Stories on the Shelf", group: "Hip-hop", style: "Dusty West Coast", bpm: 90, seconds: 45 },
  { id: "courtyard-lanterns", title: "Courtyard Lanterns", group: "Hip-hop", style: "Laid-back West Coast", bpm: 88, seconds: 45 },
  { id: "window-light", title: "Window Light", group: "Hip-hop", style: "West Coast keys", bpm: 88, seconds: 45 },
  { id: "coastline-detour", title: "Coastline Detour", group: "Hip-hop", style: "G-funk", bpm: 98, seconds: 120 },
  { id: "golden-hour-shortcut", title: "Golden Hour Shortcut", group: "Hip-hop", style: "West Coast boogie", bpm: 102, seconds: 120 },
  { id: "good-things-around-the-corner", title: "Good Things Around the Corner", group: "Hip-hop", style: "Soulful cruising groove", bpm: 94, seconds: 60 },
  { id: "little-wins-club-loose-groove", title: "Little Wins Club", group: "Hip-hop", style: "Crooked drums, soul chops", bpm: 92, seconds: 60 },
  { id: "sidewalk-satellites-loose-groove", title: "Sidewalk Satellites", group: "Hip-hop", style: "Dusty jazz chops", bpm: 90, seconds: 60 },
  { id: "pocket-circuit-loose-groove", title: "Pocket Circuit", group: "Hip-hop", style: "Lopsided drums, electric piano", bpm: 84, seconds: 60 },
  { id: "golden-hour-shuffle-loose-groove", title: "Golden Hour Shuffle", group: "Hip-hop", style: "Lazy soulful swing", bpm: 78, seconds: 60 },
  { id: "next-open-door", title: "Next Open Door", group: "Trap", style: "Modern trap", bpm: 140.11, seconds: 45 },
  { id: "pocket-sized-tomorrow", title: "Pocket-Sized Tomorrow", group: "Trap", style: "Digital trap", bpm: 140.36, seconds: 45 },
  { id: "clockwork-daydream", title: "Clockwork Daydream", group: "Trap", style: "Industrial trap", bpm: 137.91, seconds: 45 },
  { id: "quiet-dividends", title: "Quiet Dividends", group: "Trap", style: "Minimal trap", bpm: 132, seconds: 45 },
  { id: "midnight-circuit", title: "Midnight Circuit", group: "Funk and boogie", style: "Broken-beat electro-funk", bpm: 112, seconds: 120 },
  { id: "weekend-voltage", title: "Weekend Voltage", group: "Funk and boogie", style: "Broken-beat electro-funk", bpm: 116, seconds: 120 },
  { id: "rubberband-errand", title: "Rubberband Errand", group: "Funk and boogie", style: "Electro-funk", bpm: 108, seconds: 120 },
  { id: "pocket-calculator-boogie", title: "Pocket Calculator Boogie", group: "Funk and boogie", style: "Electro-boogie", bpm: 114, seconds: 120 },
  { id: "velvet-crosswalk", title: "Velvet Crosswalk", group: "Funk and boogie", style: "Syncopated electro-boogie", bpm: 110, seconds: 120 },
  { id: "make-your-move", title: "Make Your Move", group: "Funk and boogie", style: "Electro-funk", bpm: 110, seconds: 60 },
  { id: "green-light-shuffle", title: "Green Light Shuffle", group: "Funk and boogie", style: "Rubbery bass, chopped keys", bpm: 110, seconds: 60 },
  { id: "pocket-full-of-sparks", title: "Pocket Full of Sparks", group: "Funk and boogie", style: "Slap-bass electro-boogie", bpm: 114, seconds: 60 },
  { id: "sidequest-strut", title: "Sidequest Strut", group: "Funk and boogie", style: "Wonky broken beats", bpm: 106, seconds: 60 },
  { id: "day-off-frequency", title: "Day Off Frequency", group: "Funk and boogie", style: "Broken-beat funk", bpm: 118, seconds: 60 },
  { id: "sidewalk-sunshine", title: "Sidewalk Sunshine", group: "House", style: "Piano house", bpm: 122, seconds: 120 },
  { id: "afterglow-arcade", title: "Afterglow Arcade", group: "House", style: "Deep house", bpm: 118, seconds: 120 },
  { id: "loose-change-disco", title: "Loose Change Disco", group: "House", style: "Disco house", bpm: 124, seconds: 120 },
  { id: "saturday-basket", title: "Saturday Basket", group: "House", style: "90s piano house", bpm: 119.97, seconds: 45 },
  { id: "soft-focus", title: "Soft Focus", group: "House", style: "90s deep house", bpm: 119.7, seconds: 45 },
  { id: "lucky-little-finds", title: "Lucky Little Finds", group: "House", style: "Playful piano house", bpm: 127.98, seconds: 45 },
  { id: "one-more-rep", title: "One More Rep", group: "House", style: "Funky piano house", bpm: 125.92, seconds: 45 },
  { id: "keys-on-the-counter", title: "Keys on the Counter", group: "Synth-pop", style: "80s synth-pop", bpm: 117.74, seconds: 45 },
  { id: "ideas-in-the-margins", title: "Ideas in the Margins", group: "Synth-pop", style: "80s pop, digital keys", bpm: 120.13, seconds: 45 },
  { id: "lunch-rush-shuffle", title: "Lunch Rush Shuffle", group: "Synth-pop", style: "Bright 80s synth-pop", bpm: 115.92, seconds: 45 },
  { id: "a-little-more-sky", title: "A Little More Sky", group: "Synth-pop", style: "80s synth ballad", bpm: 82.14, seconds: 45 },
];
