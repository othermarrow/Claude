# Bytebeat: history, theory and classic expressions

> Access note (researcher): the network egress proxy blocked **every primary web source** for this topic: countercomplex.blogspot.com, viznut.fi, arxiv.org / ar5iv, pouet.net, en.wikipedia.org, dollchan.net, cdm.link, matrixsynth.com, fnordig.de, ossia.io, nathan.ho.name, sangarshanan.com. GitHub was reachable, so the main verifiable primary data is:
> - the **dollchan Bytebeat Composer** repo (SthephanShinkufag/bytebeat-composer), whose song library `data/library/classic.gz` stores, for each formula, an author, a date, a sample rate and source URLs that point back to viznut's formula list, the pouet.net thread and viznut's YouTube videos ([repo](https://github.com/SthephanShinkufag/bytebeat-composer); library file [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz), latest commit Aug 2026), and
> - **greggman's HTML5 Bytebeat** repo ([repo](https://github.com/greggman/html5bytebeat)).
>
> Claims marked "(search snippet)" come from web-search result summaries of the named page. I could not open those pages myself, so treat their exact wording as unverified. Numeric claims marked "(computed)" are my own arithmetic, checked with a small Python script. They follow from the definitions and have no outside source.

## History and key sources

### Takeaway
Bytebeat was started in September–October 2011 by Ville-Matias Heikkilä (viznut), a Finnish demoscener. He posted YouTube videos of very short C programs whose output, piped to the sound card as raw 8-bit PCM at 8 kHz, sounded like music. Blog posts followed on 2 Oct and 28 Oct 2011, a long pouet.net thread collected community formulas, and he wrote an arXiv paper (1112.1368, Dec 2011). Later tools such as greggman's HTML5 Bytebeat and the dollchan Bytebeat Composer moved the practice into the browser and added "signed bytebeat", "floatbeat" and "funcbeat" modes.

### Cited Findings
- viznut published the YouTube video "Experimental music from very short C programs" on **26 Sep 2011**. A third video in the series was uploaded on **9 Oct 2011**. (search snippets) — [MatrixSynth, 10 Oct 2011](https://www.matrixsynth.com/2011/10/experimental-music-from-very-short-c.html); [HN thread](https://news.ycombinator.com/item?id=3063359)
- On **2 Oct 2011** viznut published "Algorithmic symphonies from one line of code — how and why?" on his blog countercomplex. (search snippet) — [countercomplex](http://countercomplex.blogspot.com/2011/10/algorithmic-symphonies-from-one-line-of.html); [cdm.link](https://cdm.link/entire-musical-compositions-made-from-just-one-line-of-code-are-glitchy-but-musical/)
- The canonical example program is `main(t){for(t=0;;t++)putchar(t*(((t>>12)|(t>>8))&(63&(t>>4))));}`. You compile it and pipe its output to the sound card (e.g. `./a.out | aplay`). (search snippet) — [cdm.link](https://cdm.link/?p=20898)
- viznut said he was inspired by 4mat's 23-byte C-64 demo "Wallflower" and by his own 16-byte VIC-20 experiment. Soon others were trying formulas and building tools to test them. (search snippet) — [mediacommons "Could I Hear That on YouCode?"](https://mediacommons.org/imr/node/1751)
- Follow-up blog post: "Some deep analysis of one-line music programs", countercomplex, **28 Oct 2011**. A mirror exists at viznut.fi/texts-en/bytebeat_deep_analysis.html. (search snippet) — [countercomplex](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html); [viznut.fi mirror](http://viznut.fi/texts-en/bytebeat_deep_analysis.html)
- The paper is Ville-Matias Heikkilä, "Discovering novel computer music techniques by exploring the space of short computer programs", arXiv:1112.1368, submitted **6 Dec 2011**. In summary, its abstract says:
  - very short programs, "sometimes consisting of as few as three arithmetic operations in an infinite loop", produce music-like data when output as raw PCM audio;
  - dozens of people in online communities explored this space;
  - the collected expressions use binary and modular arithmetic in ways not documented before.
  (search snippet of abstract) — [arXiv 1112.1368](https://arxiv.org/abs/1112.1368)
- MIT Technology Review covered it as "The Emerging Art of Algorithmic Music" on 8 Dec 2011. (search result title/URL only) — [Technology Review](https://www.technologyreview.com/2011/12/08/189276/the-emerging-art-of-algorithmic-music/amp/)
- **The pouet.net thread** is topic **8357**. The dollchan library cites comments from page 2 to page 21, dated 28 Sep 2011 to 25 Feb 2012 (examples below), e.g. `https://www.pouet.net/topic.php?which=8357&page=4#c388477` — [dollchan classic library](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz). I could not open the thread, so its exact title is unconfirmed.
- viznut kept a formula list at `http://viznut.fi/demos/unix/bytebeat_formulas.txt`. The dollchan library cites it as the source of many classic formulas. — [dollchan classic library](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- The library's two main viznut YouTube references are `youtu.be/GtQdIYUtAHg` (formulas dated 2011-09-18) and `youtu.be/qlrs2Vorw2Y` (formulas dated 2011-09-30). `youtu.be/tCRPUv8V22o` is cited for a formula dated 2011-10-10. — [dollchan classic library](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- **greggman's HTML5 Bytebeat**: "*t* is an 8000hz timer that counts up". Modes are "bytebeat: … byte values from 0 to 255" and "floatbeat: … float values from -1.0 to 1.0". The code also has `signedByteBeat` (-128..127). Expressions can be infix JS, postfix (RPN), "glitch" (Glitch Machine sharing format) or "function". Selectable sample rates include 8000, 11000, 22050, 44100 and 48000. — [html5bytebeat README](https://github.com/greggman/html5bytebeat/blob/master/README.md); [ByteBeatNode.js](https://github.com/greggman/html5bytebeat/blob/master/src/ByteBeatNode.js)
- **dollchan Bytebeat Composer** ("Live editing algorithmic music generator with a collection of many formulas from around the internet", hosted at dollchan.net/bytebeat) has four modes: `Bytebeat`, `Signed Bytebeat`, `Floatbeat`, `Funcbeat`. Its audio processor converts each mode's output to an audio sample as follows (`v` is the raw value of the expression):

  | Mode | Conversion |
  |---|---|
  | Bytebeat | `(v & 255) / 127.5 - 1` |
  | Signed Bytebeat | `((v + 128) & 255) / 127.5 - 1` |
  | Floatbeat / Funcbeat | clamp `v` to [-1, 1] |

  The default `sampleRate` is 8000. Funcbeat calls the function with `t` in seconds (`currentSample / sampleRate`). — [README](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/README.md); [audio-processor.mjs](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/src/audio-processor.mjs)
- "Any signed bytebeat can be converted to regular bytebeat by adding + 0x80". Floatbeat came after bytebeat, which explains why both formats coexist. (search snippet) — [npm bytebeat.js](https://www.npmjs.com/package/bytebeat.js)

### Inferences
- The "classic" bytebeat contract is: integer `t` counts samples from 0; you evaluate the expression once per sample; you keep only the low 8 bits (C's `putchar` does this implicitly, JS players do it with `& 255`); and you play the result as unsigned 8-bit PCM at 8000 Hz. Both web players implement this contract.
- The 2011-09-18 dates on the earliest formulas come before the 26 Sep video upload. They probably record when formulas were found or shared, for example on IRC, not when they were published. I could not confirm this.

### Gaps
- I could not read the blog posts, the arXiv PDF or the pouet thread directly, so no verbatim quotes. The exact pouet thread title, its first-post date and the YouTube video titles are unconfirmed.
- I found no reliable source for who coined the word "bytebeat" or when.
- I could not verify independently when floatbeat first appeared.

## Operator-by-operator theory

### Takeaway
The output wraps at 256, so `t` alone is a sawtooth that rises once every 256 samples. Multiplying by N raises the pitch to N × (rate / 256), which is 31.25·N Hz at 8 kHz. Right shifts (`t>>N`) make values that change only every 2^N samples, so they act as the "sequencer clock" for rhythm and melody. `&`, `|` and `^` combine bit patterns: `&` with a constant limits the possible pitches (melodies), while `&`/`|` between signals give the timbres and "Sierpinski" harmonies. `%` makes sawtooth loops with arbitrary (non-power-of-2) periods.

### Cited Findings
- 8000 samples per second and 256 amplitude levels; formulas of the "t\* class" multiply `t` by some expression, "resulting in a sawtooth wave that changes its pitch according to that expression". (search snippet of the paper / deep-analysis post) — [arXiv 1112.1368](https://arxiv.org/pdf/1112.1368); [deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)
- Adding an AND to a t\* formula "restrict[s] the set of pitches and thus create[s] melodies". The Forty-Two Melody `t*(42&t>>10)` "has been individually discovered by several people". (search snippet) — [deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html); the dollchan library also says "Separately discovered by several people on irc" — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- AND can also force a scale. The snippet gives the example `t*(5+((t>>11)&5))` with "multipliers 4, 5, 8 and 9 … E3, G3, C4, D4". **Flag:** this cannot be right as quoted. `(t>>11)&5` ∈ {0,1,4,5}, so `5+…` gives multipliers 5, 6, 9 and 10 (computed). The snippet probably garbled the formula or the notes, so do not reuse it verbatim. (search snippet) — [deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)
- Plain t\* sawtooths alias, especially at low sample rates. Appending `&128` or `&64` turns the output into a square wave, which "usually sounds cleaner". (search snippet) — [deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)
- "Sierpinski harmonies": with expressions like `t&t>>8`, the plotted amplitudes resemble a Sierpinski triangle. (search snippet) — [arXiv 1112.1368](https://arxiv.org/pdf/1112.1368)
- In JS players, `& 255` truncates the output to a byte. JS bitwise operators first convert to 32-bit integers, so fractional multipliers work, e.g. `t*4.2` in the "Fanfare?" formula. — [audio-processor.mjs](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/src/audio-processor.mjs); [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- The dollchan library tags formulas "c" (C-compatible) or not, so JS-only behaviour such as float division (`t/3`) is a real distinction. — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)

### Inferences (worked arithmetic; computed, standard C/JS semantics)

**Why `&255` gives a sawtooth.** `t & 255` (or `t % 256`) climbs 0, 1, …, 255 and then drops to 0. That is one ramp every 256 samples, so the fundamental is rate/256 = **31.25 Hz** at 8 kHz.

**Pitch from `t*N`.** `(t*N) & 255` wraps N times as fast, so f = N · rate / 256.
- At 8 kHz: N=1 → 31.25 Hz (≈B0), 2 → 62.5 (≈B1), 4 → 125 (≈B2), 8 → 250 (≈B3), 5 → 156.25 (≈D#3), 42 → 1312.5 Hz (≈E6).
- To hit a target f: **N = 256·f / rate**. For example, A4 = 440 Hz at 8 kHz needs N ≈ 14.08. Use a non-integer N in JS, or `t*N/4` style tricks in C.
- Doubling N raises the pitch one octave. Ratios between multipliers give just intervals: 4:5 is a major third, 2:3 is a fifth.

**`t>>N`, the clock.**
- `t>>N` equals floor(t / 2^N), so it steps every 2^N samples. At 8 kHz:
  - `t>>8` steps at 31.25 Hz (fast, still audible as texture);
  - `t>>10` steps every 0.128 s, which suits note lengths;
  - `t>>12` steps every 0.512 s;
  - `t>>13` steps every 1.024 s, which suits bars and sections;
  - `t>>16` steps every 8.19 s, which suits song-level changes.
- So `t*(f(t>>11))` is a step sequencer: `t>>11` is the step index and `f` maps it to a pitch multiplier.
- A shift used directly as the signal, e.g. `t>>4`, is a much lower sawtooth: rate/(256·16) ≈ 1.95 Hz at 8 kHz, i.e. sub-audio or a slow sweep. In combinations like `t>>(something)` it gives gritty, noisy textures.
- `<<` is the opposite: it multiplies by 2^N, i.e. raises the pitch by N octaves (`t<<1` = `t*2`).

**`&` with a constant: melody and rhythm gating.**
- `x & 42` keeps bits 1, 3 and 5 (42 = 0b101010). Over x = 0…63 it takes the 8 values {0, 2, 8, 10, 32, 34, 40, 42}. It changes every 2 steps of x and repeats every 64 steps.
- So for `t*(42&t>>10)`:
  - each note lasts 2048 samples (0.256 s);
  - there are 32 notes per cycle;
  - the cycle is 65536 samples = **8.192 s** at 8 kHz;
  - a multiplier of 0 means silence (constant output 0).
- Small masks such as `&7` or `&3` also make short repeating cycles, which work as gates and accents.

**`&` between signals (`t & t>>8`).** The low byte of t (a sawtooth) is masked by the slowly changing high byte. The bits set in `t>>8` select which sub-bands of the ramp survive. Plotting `(y & x) == 0` gives the Sierpinski pattern, which I checked by printing it. Audibly you get a harmonically related, slowly evolving timbre.

**`|` (OR).** It adds bits: it sets bits from either operand, so the result is ≥ each input. Two pattern generators OR'd together layer textures, e.g. a melody `| t>>4` adds a slow buzzy "rhythm" layer. Inside a multiplier, `(t>>12)|(t>>8)` gives a pitch value that changes in a non-trivial order. In viznut's `t*(((t>>12)|(t>>8))&(63&(t>>4)))`, the `63&(t>>4)` part changes every 16 samples. That fast-moving mask makes timbre and arpeggio-like effects. This reading is my inference; I could not check it against the paper.

**`^` (XOR).** It flips bits, making ring-modulation-like or metallic timbres. XOR-ing two shifted sawtooths gives harsher, more symmetric textures than OR.

**`%` (modulo).**
- `t % P` is a sawtooth with any period P, so f = rate/P (e.g. `t%40` ≈ 200 Hz at 8 kHz). Use it when you need non-power-of-two loop lengths: `t%(3<<12)` gives 3/4-length bars.
- `(t>>10)%3`-style indices give 3-step or 5-step sequences.
- In JS, `%` can return negative values for negative operands; `&255` masks them back into range.

**Ternary operators.** `t&4096 ? A : B` switches between two formulas every 4096 samples (0.512 s). The 2017+ dollchan entries use this heavily for drums and sections — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz).

**Operator precedence (C and JS agree).** From tightest to loosest:
1. `* / %`
2. `+ -`
3. `<< >>`
4. relational operators
5. `&`
6. `^`
7. `|`
8. `?:`

So `t*5&t>>7` parses as `(t*5)&(t>>7)`, and `t*(42&t>>10)` as `t*(42&(t>>10))`. Precedence is the most common source of "wrong sound" mistakes when re-typing classics.

### Gaps
- I could not reproduce the paper's own taxonomy or terminology for these techniques (beyond the snippets above).
- I found no source that explains the internals of viznut's first formula. The OR/AND analysis above is my inference.

## Famous one-liners and attributions

### Takeaway
The best available attribution record is the dollchan Bytebeat Composer library. Each entry there cites the pouet thread, viznut's formula list or his videos. Several "famous" formulas belong to tejeez, miiro, xpansive, visy and rrrola, not to viznut. The 42 Melody has no single author.

### Cited Findings
All entries below come from the dollchan library ([classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)). All are at 8000 Hz. "Date" is the date the library records.

| Formula (as stored) | Name in library | Credited author | Date | Library's source links |
|---|---|---|---|---|
| `t*(((t>>12)\|(t>>8))&(63&(t>>4)))` | (unnamed; viznut's blog/video example) | **viznut** | 2011-09-18 | youtu.be/GtQdIYUtAHg?t=8; viznut formula list |
| `t&t>>8` | "minimal sierpinski harmony" | **viznut** (listed as a remix of miiro's "Sierpinski harmony") | — | viznut formula list |
| `t*5&(t>>7)\|t*3&(t*4>>10)` | "Sierpinski harmony" | **miiro** | 2011-09-30 | youtu.be/qlrs2Vorw2Y?t=2m14s |
| `(t*5&t>>7)\|(t*3&t>>10)` | "Long Sierpinski Harmony" | **viznut** (remix of miiro's) | 2011-10-10 | youtu.be/tCRPUv8V22o?t=10 |
| `t*(42&t>>10)` | "the 42 melody" | **no single author**: "Separately discovered by several people on irc" | — | viznut formula list |
| `(t*(t>>5\|t>>8))>>(t>>16)` | (unnamed) | **tejeez** | 2011-09-18 | youtu.be/GtQdIYUtAHg?t=45 |
| `t*(((t>>11)&(t>>8))&(123&(t>>3)))` | (unnamed) | **tejeez** | 2011-09-18 | youtu.be/GtQdIYUtAHg?t=123 |
| `((-t&4095)*(255&t*(t&(t>>13)))>>12)+(127&t*(234&t>>8&t>>3)>>(3&t>>14))` | "Noisy beats" | **tejeez** | 2011-09-18 | youtu.be/GtQdIYUtAHg?t=175 |
| `(~t>>2)*((127&t*(7&t>>10))<(245&t*(2+(5&t>>14))))` | "Bassline #countercomplex" | **tejeez** | 2011-10-05 | viznut formula list |
| `t*(t>>8*((t>>15)\|(t>>8))&(20\|(t>>19)*5>>t\|(t>>3)))` | (unnamed) | **visy** | 2011-09-18 | youtu.be/GtQdIYUtAHg?t=160 |
| `((t*(t>>8\|t>>9)&46&t>>8))^(t&t>>13\|t>>6)` | "Lost in Space" | **xpansive** | 2011-09-29 | pouet 8357 p3 #c388375 |
| `(t>>6\|t\|t>>(t>>16))*10+((t>>11)&7)` | "Sin() isn't kosher, people!" | **viznut** | 2011-09-30 | pouet 8357 p4 #c388477 |
| `(t>>7\|t\|t>>6)*10+4*(t&t>>13\|t>>6)` | "Combined xpansive's and varjohukka's stuff" | **viznut** | 2011-09-30 | pouet 8357 p4 #c388488 |
| `(t*((3+(1^t>>10&5))*(5+(3&t>>14))))>>(t>>8&3)` | "Another attempt at melody construction" | **viznut** | 2011-10-04 | pouet 8357 p9 #c388930 |
| `t*(0xCA98CA98>>(t>>9&30)&15)\|t>>8` | "CA98" | **rrrola** | 2011-10-04 | pouet 8357 p9 #c388902 |
| `t*(4+(t>>9)%3)&t/3>>7&224` | "I'm late to the party" | **rrrola** | 2011-09-30 | pouet 8357 p5 #c388529 |
| `(t>>5)\|(t<<3)+(t*12*((t>>13)\|((t>>1)\|(t>>10)\|(t>>2))&(t>>8)))` | "Oh the headaches" | **sub** | 2011-09-28 | pouet 8357 p2 #c388363 |
| `(t&4096)?((t*(t^t%255)\|(t>>4))>>1):(t>>3)\|((t&8192)?t<<2:t)` | "Street Surfer" | **skurk, raer** | 2011-09-30 | pouet 8357 p4 |
| `(t/8)>>(t>>9)*t/((t>>14&3)+4)` | "mr. arpeggiator playing a solo" | **tonic** | 2011-10-01 | pouet 8357 p5 #c388569 |
| `t%(t/(t>>9\|t>>13))` | (unnamed) | **xpansive** | 2012-02-25 | pouet 8357 p21 #c401775 |

(In the table, `\|` is an escaped `|` for Markdown.)

- `t*(t>>5|t>>8)` **on its own** is not a separate library entry. It is the core of tejeez's `(t*(t>>5|t>>8))>>(t>>16)`, whose `>>(t>>16)` part makes it quieter or cut out in later sections. Present the bare form as "the core of tejeez's formula" or leave it unattributed. — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- `(t*5&t>>7)|(t*3&t>>10)` is often cited without credit. The library credits it to viznut as "Long Sierpinski Harmony", derived from **miiro**'s earlier `t*5&(t>>7)|t*3&(t*4>>10)`. Credit "viznut, after miiro". — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- A later community variant: `t*(42&t>>10)%256*(1-t%2048/3000)`, "42 melody with adjustable decay", from 2023-02-23 on the dollchan forum. It is shown under an empty-author group in the library, so treat it as unattributed. — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)

### Inferences
- When Strudel docs or posts say "viznut's formula", they almost always mean `t*(((t>>12)|(t>>8))&(63&(t>>4)))`. Its minified form `t*((t>>12|t>>8)&63&t>>4)` is the same expression, because of the precedence rules above (the library lists both).

### Gaps
- I could not check these attributions against viznut's own `bytebeat_formulas.txt` or the pouet posts (both blocked). They rest on the dollchan library's curation, which cites those sources link by link.

## Sample rate: why 8 kHz, and what changes elsewhere

### Takeaway
Classic formulas assume 8000 samples per second. `t` counts samples, not seconds, so at rate R **both pitch and tempo scale by R/8000**. At 44.1 kHz everything plays about 5.5× faster and about 2.5 octaves higher. To keep the original sound, players feed the formula a rescaled `t`.

### Cited Findings
- greggman: "*t* is an 8000hz timer"; selectable rates include 8000, 11000, 22050, 44100 and 48000. — [html5bytebeat README](https://github.com/greggman/html5bytebeat/blob/master/README.md)
- dollchan stores a `sampleRate` per song. Most classics are 8000, and some later songs use 11025 (e.g. "The time is running out!", 2021). The processor computes `time = sampleRatio * audioSample` and steps `time += sampleRatio`, i.e. it resamples `t` so that a song authored for R plays correctly on a 44.1 or 48 kHz audio device. — [audio-processor.mjs](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/src/audio-processor.mjs); [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- Low sample rates make sawtooths alias. Square-wave masks (`&128`) sound cleaner. (search snippet) — [deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)

### Inferences (computed)
- If you run a formula with raw `t` at R = 48000, every frequency is multiplied by 6 (+31 semitones) and every note and section is 6× shorter. The 42 Melody cycle shrinks from 8.19 s to 1.37 s.
- To emulate 8 kHz on a higher-rate engine, use `t8 = floor(t * 8000 / R)` and feed `t8` into the formula. That is also a sample-and-hold, so you keep the 8 kHz "crunch" and aliasing character.
- Alternatively, compensate inside the formula: add +k to every shift amount to slow down by 2^k, and divide multipliers to fix pitch. The two scale independently: shifts set tempo, multipliers set pitch.
- `t*N` pitch at any rate: f = N·R/256. The 8-bit wrap means the waveform shape does not depend on R; only the time scale changes.

### Gaps
- I did not research how Strudel itself defines `t` or the sample rate for bytebeat. That belongs to the Strudel-specific notes.

## Practical tips for composing and experimenting

### Takeaway
Start from a t\* sawtooth. Pick the pitch with N = 256·f/rate. Sequence the multiplier with `&` masks on a `t>>N` clock. Layer rhythms with `| t>>k`. Use ternaries or `%` for structure. Tweak one constant at a time and listen. That trial-and-error loop is how the original community found these formulas.

### Cited Findings
- The paper describes the discoveries as coming from "a simple trial-and-error methodology". (search snippet) — [arXiv 1112.1368](https://arxiv.org/abs/1112.1368)
- dollchan's "Boss level" series (2017) is a documented example of iterative tweaking. Each entry changes one thing, with notes such as:
  - "Slowing down the rhythm to |t>>3";
  - "Changing the coefficients adds harmonics";
  - "t>>6 gives SUPER POWERFUL ECHOES";
  - "Replacing 3&t>>9 with 3&t>>2 … gives a noise sound. This is an excellent instrument for drums".
  — [classic.gz](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/data/library/classic.gz)
- Turn sawtooth into square with `&128` or `&64` for a cleaner sound. (search snippet) — [deep analysis](http://countercomplex.blogspot.com/2011/10/some-deep-analysis-of-one-line-music.html)
- Signed ↔ unsigned conversion: add `+0x80` (128). — [npm bytebeat.js](https://www.npmjs.com/package/bytebeat.js); [audio-processor.mjs](https://github.com/SthephanShinkufag/bytebeat-composer/blob/master/src/audio-processor.mjs)

### Inferences (practical recipe, derived from the theory above)
1. **Tone:** `t*N` for a sawtooth, `(t*N)&128` for a square. N=1 is 31.25 Hz at 8 kHz, and each doubling is +1 octave.
2. **Melody:** `t*(K & t>>S)`. S sets note length (2^S samples) and K's bits set the pitch set. Alternatively use a lookup like rrrola's `0xCA98CA98>>(t>>9&30)&15`, which reads 4-bit nibbles of a hex constant as a note table. This is a clean way to write a specific melody.
3. **Rhythm layer:** OR in a slow shift (`| t>>4`, `| t>>6`) or a gated noise `t*t>>k & mask`.
4. **Structure:** use ternaries on high bits (`t&16384 ? A : B`), or right-shift the whole output by a slowly changing amount (`>>(t>>16)`) to fade sections in and out.
5. **Debugging:** add parentheses when unsure of precedence. Remember that `/` makes floats in JS but integers in C. Expect a constant output (silence) whenever a multiplier mask comes out 0.
6. **Rate:** write at 8000 Hz, or rescale `t` when your host runs at 44.1 or 48 kHz.

### Gaps
- No primary source was reachable for viznut's own composing advice (e.g. in the deep-analysis post). The tips above are synthesized from the library annotations and the arithmetic.
