# Euclidean rhythms: theory and musical background (for Strudel users)

> **How these notes were made.** The research environment's egress proxy blocked most of the primary sources: Toussaint's PDF at cgm.cs.mcgill.ca, arXiv (Demaine et al. 2009 / Morrill 2022), Wikipedia, tidalcycles.org, bridgesmathart.org, sdiy.info and ORNL. Toussaint's paper could **not** be read directly. The following *could* be read in full:
> - The Tidal docs source on GitHub: `tidal-doc/docs/reference/mini_notation.md`, which reproduces Toussaint's list.
> - The published Strudel source on npm (`@strudel/core@1.2.6` `euclid.mjs` and its tests, plus `@strudel/mini@1.2.6`).
> - The `euclidean-rhythms` JS library's test fixtures, which encode Toussaint's binary patterns.
> - Brian House's `bjorklund` README.
> - Web-search snippets.
>
> All algorithm outputs below were **computed by running Strudel's own `bjorklund` function** (extracted from the npm package) under Node 22. I did not test them in the Strudel REPL or by ear. Anything taken from memory of Toussaint's paper is marked **[unverified – memory]**.

## 1. Origin and history

### Takeaway
Eric Bjorklund devised the algorithm to space timing pulses evenly at the Spallation Neutron Source (SNS) accelerator. Godfried Toussaint saw that it has the same structure as Euclid's GCD algorithm. In a 2005 Bridges (Banff) paper he showed that it generates many traditional timelines, especially from sub-Saharan Africa and Afro-Cuban music.

### Cited Findings
- The source paper is G. T. Toussaint, "The Euclidean Algorithm Generates Traditional Musical Rhythms", in *Proceedings of BRIDGES: Mathematical Connections in Art, Music, and Science*, Banff, Alberta, Canada, July 31 – August 3, 2005, pp. 47–56. — [Bridges archive (search snippet)](https://archive.bridgesmathart.org/2005/bridges2005-47.html); [PDF (blocked here)](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf)
- The paper's abstract says the structure of the Euclidean algorithm "may be used to generate, very efficiently, a large family of rhythms used as timelines (ostinatos), in sub-Saharan African music in particular, and world music in general". It also says that these "Euclidean rhythms" have onset patterns that are "distributed as evenly as possible". — [search snippet of banff.pdf / Wikipedia](https://en.wikipedia.org/wiki/Euclidean_rhythm)
- Some sources date the discovery to 2004. Tidal's docs say the rhythms "were described in 2004 by Godfried Toussaint, a canadian computer scientist", and Strudel's JSDoc repeats this wording. — [Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md); [Strudel euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) (read from the npm tarball `@strudel/core@1.2.6`)
- Bjorklund's source paper is E. Bjorklund, "The Theory of Rep-Rate Pattern Generation in the SNS Timing System", SNS technical note SNS-NOTE-CNTRL-99, 2003.
  - The problem it solved: given a number of time slots and a number of pulses, distribute the pulses "as evenly as possible", for example to drive components such as high-voltage power supplies of the neutron-source accelerator. The result is a binary sequence of ones and zeros.
  - Source: [search summary citing Demaine et al., "The Distance Geometry of Music"](https://arxiv.org/pdf/0705.4085). The tech note itself was at [ics-web.sns.ornl.gov](https://ics-web.sns.ornl.gov/timing/Rep-Rate%20Tech%20Note.pdf) and was not reachable.
- Brian House wrote a well-known Python implementation.
  - He reports that many implementations he tried (in Ruby, Python, Java and JavaScript) "return inaccurate results", and that "Trying 13 steps with 5 pulses was an easy way to break most of them".
  - He notes that Björklund's paper provides C code.
  - He also found that Björklund's output "didn't exactly match what was in Toussaint's paper, being rotations of those strings". In his words: "Some rhythm necklaces still don't match what Toussaint uses, but he likely rotated those to match traditional musical patterns".
  - Source: [brianhouse/bjorklund README](https://github.com/brianhouse/bjorklund)
- An expanded journal version exists: Demaine, Gomez-Martin, Meijer, Rappaport, Taslakian, Toussaint, Toussaint and Wood, "The Distance Geometry of Music", *Computational Geometry: Theory and Applications* (2009), arXiv:0705.4085. — [Erik Demaine paper page](https://erikdemaine.org/papers/DeepRhythms_CGTA)
- Strudel's implementation says its Bjorklund code is "ported from the Haskell Music Theory Haskell module by Rohan Drape". — [Strudel euclid.mjs header](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) (npm 1.2.6)

### Inferences
- When explaining this to a Strudel user, the clean lineage is: Euclid's GCD algorithm → Bjorklund (SNS timing, 2003) → Toussaint (2005, music) → Tidal → Strudel. Strudel's code arrived through Rohan Drape's Haskell `hmt` library.

### Gaps
- Toussaint's PDF and Bjorklund's tech note could not be opened here, so I could not quote them verbatim.
- The details of the 2004 vs 2005 dating (a 2004 talk or preprint versus the 2005 proceedings) were not verified.

## 2. How Bjorklund's algorithm distributes k onsets over n steps (worked examples)

### Takeaway
The algorithm works like repeated Euclidean division. Start with k "1" groups and n−k "0" groups. Repeatedly append the smaller set of leftover groups onto the front groups, one each, until at most one remainder group is left. Then read all the groups left to right.

### Algorithm, as implemented in Strudel
This is a paraphrase of the code in `@strudel/core/euclid.mjs`:
- Keep two lists: the "front" groups `xs`, initially k copies of `[1]`, and the "remainder" groups `ys`, initially n−k copies of `[0]`.
- If there are more front groups than remainder groups (`left`), glue one remainder group onto each of the first |ys| front groups. The leftover front groups become the new remainder.
- Otherwise (`right`), glue the first |xs| remainder groups onto the front groups. The rest stay as the remainder.
- Stop when `min(count) <= 1`, then flatten the front groups followed by the remainder.
- Negative k returns the complementary (inverted) pattern, e.g. `bjorklund(-3,8) = [0,1,1,0,1,1,0,1]`. This is in the source and asserted in Strudel's unit test.
- Source: [Strudel euclid.mjs + test/euclid.test.js](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)

### Worked example E(3,8), the tresillo
1. Start: `[1] [1] [1] | [0] [0] [0] [0] [0]` (3 ones, 5 zeros)
2. Pair each 1 with a 0: `[1 0] [1 0] [1 0] | [0] [0]`. The 2 unpaired zeros are the remainder (8 = 3·2 + 2, just like a Euclid step).
3. Pair again, with the remainder 2 < 3: `[1 0 0] [1 0 0] | [1 0]`. Now only one remainder group is left, so stop.
4. Read out: `1 0 0 1 0 0 1 0` = `x..x..x.`. The inter-onset intervals are **3-3-2**.

The computed Strudel output is `bjorklund(3,8) = x..x..x.`, which matches Strudel's unit test `[1,0,0,1,0,0,1,0]` ([test file](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/euclid.test.js), npm 1.2.6).

### Worked example E(5,8), the cinquillo
1. Start: `[1]×5 | [0]×3`
2. Pair 3 ones with 3 zeros: `[1 0] [1 0] [1 0] | [1] [1]`. The 2 leftover ones become the remainder.
3. Append them to the first two groups: `[1 0 1] [1 0 1] | [1 0]`. One remainder group is left, so stop.
4. Read out: `1 0 1 1 0 1 1 0` = `x.xx.xx.`. The intervals are **2-1-2-1-2**.

This matches Strudel's unit test `bjorklund(5,8) = [1,0,1,1,0,1,1,0]`.

### Worked example E(5,13), the "hard case" used to check implementations
1. Start: `[1]×5 | [0]×8`
2. Pair: `[10]×5 | [0]×3`
3. Pair: `[100]×3 | [10]×2`
4. Pair: `[10010]×2 | [100]`
5. Read out: `1001010010100` = `x..x.x..x.x..`

The computed Strudel output is the same. The `euclidean-rhythms` README also gives `getPattern(5,13)` = `[1,0,0,1,0,1,0,0,1,0,1,0,0]`. — [mkontogiannis/euclidean-rhythms README](https://github.com/mkontogiannis/euclidean-rhythms)

### Cited Findings
- The step structure mirrors Euclid's algorithm for the gcd: 8 = 3·2 + 2, then 3 = 2·1 + 1, and so on. Toussaint's thesis is that this structure generates the rhythms. — [Toussaint 2005 abstract via search](https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf)
- Toussaint's paper itself walks through **E(5,13)** as its main example of the Bjorklund procedure. **[unverified – memory; consistent with House's remark that 5-in-13 is the standard test case]** — [brianhouse/bjorklund](https://github.com/brianhouse/bjorklund)
- There is an alternative formulation: a Bresenham-line or "floor" formula, onset i at ⌊i·n/k⌋. It produces the same necklaces with often different rotations. House's module includes it because it matched Toussaint's printed rotations better. — [brianhouse/bjorklund README](https://github.com/brianhouse/bjorklund), citing [Morrill, "On the Euclidean Algorithm: Rhythm Without Recursion", arXiv:2206.12421](https://arxiv.org/abs/2206.12421)

### Inferences
- For teaching, the interval representation is the most intuitive one: k gaps that take only two sizes, ⌈n/k⌉ and ⌊n/k⌋, spread as evenly as possible. Examples: E(3,8) = 3-3-2, E(5,8) = 2-1-2-1-2, E(5,12) = 3-2-3-2-2, E(7,16) = 3-2-2-3-2-2-2 (all computed).

### Gaps
- I could not verify Toussaint's exact verbal walkthrough or figure numbering.

## 3. Toussaint's list of E(k,n) rhythms, attributions, and rotation differences

### Takeaway
The attributions below are the ones repeated in Tidal's and Strudel's docs, credited to Toussaint's paper. Toussaint's printed binary strings agree with Strudel's `bjorklund` output for most entries. Four entries differ only by rotation: E(2,3), E(3,4), E(5,6) and E(7,8). Several entries are explicitly "necklaces", meaning the traditional rhythm is a *rotation* of the Euclidean string. Tidal and Strudel encode those with a third rotation argument.

### The attribution list
Tidal's docs list these under the heading "The Euclidean Algorithm Generates Traditional Musical Rhythms by Toussaint". The text is verbatim from the [Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md), and Strudel's `euclid.mjs` JSDoc has identical text ([source](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)).

In the table:
- **"Toussaint's string"** comes from the test fixtures of [mkontogiannis/euclidean-rhythms `src/patterns.ts`](https://github.com/mkontogiannis/euclidean-rhythms/blob/master/src/patterns.ts). That library exists to reproduce "the expected results as described on the paper" ([README](https://github.com/mkontogiannis/euclidean-rhythms)). These strings also agree with my memory of the paper. **Treat them as strongly corroborated, not directly verified against the PDF.**
- **"Strudel output"** was computed by running `bjorklund(k,n)` from `@strudel/core@1.2.6`.

| E(k,n) (Tidal/Strudel arg) | Attribution (Tidal/Strudel docs, credited to Toussaint) | Toussaint's string (fixture) | Strudel `bjorklund` output | Same? |
|---|---|---|---|---|
| (2,5) | "A thirteenth century Persian rhythm called Khafif-e-ramal." | `x.x..` | `x.x..` | yes |
| (3,4) | "The archetypal pattern of the Cumbia from Colombia, as well as a Calypso rhythm from Trinidad." | `x.xx` | `xxx.` | **rotation** (shift 2) |
| (3,5,2) | "Another thirteenth century Persian rhythm by the name of Khafif-e-ramal, as well as a Rumanian folk-dance rhythm." | E(3,5) = `x.x.x` | `x.x.x` | yes (the doc applies rotation 2) |
| (3,7) | "A Ruchenitza rhythm used in a Bulgarian folk-dance." | `x.x.x..` | same | yes |
| (3,8) | "The Cuban tresillo pattern." | `x..x..x.` | same | yes |
| (4,7) | "Another Ruchenitza Bulgarian folk-dance rhythm." | `x.x.x.x` | same | yes |
| (4,9) | "The Aksak rhythm of Turkey." | `x.x.x.x..` | same | yes |
| (4,11) | "The metric pattern used by Frank Zappa in his piece titled Outside Now." | `x..x..x..x.` | same | yes |
| (5,6) | "Yields the York-Samai pattern, a popular Arab rhythm." | `x.xxxx` | `xxxxx.` | **rotation** (shift 4) |
| (5,7) | "The Nawakhat pattern, another popular Arab rhythm." | `x.xx.xx` | same | yes |
| (5,8) | "The Cuban cinquillo pattern." | `x.xx.xx.` | same | yes |
| (5,9) | "A popular Arab rhythm called Agsag-Samai." | `x.x.x.x.x` | same | yes |
| (5,11) | "The metric pattern used by Moussorgsky in Pictures at an Exhibition." | `x.x.x.x.x..` | same | yes |
| (5,12) | "The Venda clapping pattern of a South African children's song." | `x..x.x..x.x.` | same | yes |
| (5,16) | "The Bossa-Nova rhythm necklace of Brazil." | `x..x..x..x..x...` | same | yes |
| (7,8) | "A typical rhythm played on the Bendir (frame drum)." | `x.xxxxxx` | `xxxxxxx.` | **rotation** (shift 6) |
| (7,12) | "A common West African bell pattern." | `x.xx.x.xx.x.` | same | yes |
| (7,16,14) | "A Samba rhythm necklace from Brazil." | E(7,16) = `x..x.x.x..x.x.x.` | same | yes (the doc applies rotation 14) |
| (9,16) | "A rhythm necklace used in the Central African Republic." | `x.xx.x.x.xx.x.x.` | same | yes |
| (11,24,14) | "A rhythm necklace of the Aka Pygmies of Central Africa." | `x..x.x.x.x.x..x.x.x.x.x.` | same | yes (the doc applies rotation 14) |
| (13,24,5) | "Another rhythm necklace of the Aka Pygmies of the upper Sangha." | `x.xx.x.x.x.x.xx.x.x.x.x.` | same | yes (the doc applies rotation 5) |

Also in the fixture/paper but not in Tidal's list: E(2,3) = `x.x`, where Strudel gives `xx.` (**rotation**). The fixture labels it "West African, Latin American". In every row of the table, the Strudel string is the same *necklace* as Toussaint's string; I checked this by computing canonical rotations.

### Cited Findings
- The rotation mismatch is known in the implementer community. House says the C-code Bjorklund output "didn't exactly match what was in Toussaint's paper, being rotations of those strings", and that Toussaint "likely rotated those to match traditional musical patterns". — [brianhouse/bjorklund](https://github.com/brianhouse/bjorklund)
- My Node run of Strudel's `bjorklund` shows which entries differ: (2,3), (3,4), (5,6) and (7,8). In each of these, k > n/2 and only one rest exists or the pattern has a run of onsets. Strudel's version puts the rests at the *end* (`xxx.`), while Toussaint starts each with `x.` (`x.xx`). — computed from [Strudel euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)
- The `euclidean-rhythms` fixture uses broader region labels that differ from Tidal's wording. Examples: E(7,8) "Tuareg rhythm of Libya" (Tidal: "Bendir (frame drum)"), E(2,5) "Classical jazz and Persian", E(5,11) "Classical", E(9,16) "West and Central African, and Brazilian necklaces". — [patterns.ts](https://github.com/mkontogiannis/euclidean-rhythms/blob/master/src/patterns.ts). These labels probably come from the longer list in the 2009 journal version, "The Distance Geometry of Music". That paper lists several traditions per rhythm. **[unverified – inferred]**
- **Strudel doc quirk:** in `euclid.mjs`, the JSDoc example for `euclidRot` reads `// A Samba rhythm necklace from Brazil` / `note("c3").euclidRot(3,16,14)`. The attribution list in the same file uses `euclidRot(7,16,14)`. The `3,16` is almost certainly a typo for `7,16`. — [Strudel euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) (npm 1.2.6)
- **Rotation direction differs between Tidal's docs and Strudel's code. This matters for the "necklace" entries.**
  - Tidal's docs: the third number "provides an offset, moving the pattern left by the number of steps". Their examples are `(3,8,1)` = `~ ~ x ~ ~ x ~ x` and `(3,8,2)` = `~ x ~ ~ x ~ x ~`. — [Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md)
  - Strudel 1.2.6: `_euclidRot` returns `rotate(b, -rotation)`, where `rotate(arr,n) = arr.slice(n).concat(arr.slice(0,n))`. That is a **right** rotation, which delays the pattern. Strudel's own unit test expects `euclidRot(3,8,2)` to give onsets at 0, 2/8 and 5/8, i.e. `x.x..x..`. Tidal's docs give `.x..x.x.` for `(3,8,2)`.
  - The mini-notation `"bd(3,8,2)"` calls `euclidRot` (`@strudel/mini/mini.mjs`), so it gets the same behaviour.
  - Computed Strudel results: `(3,8,1)` = `.x..x..x`, `(7,16,14)` = `.x.x.x..x.x.x.x.`, `(11,24,14)` = `.x..x.x.x.x.x.x..x.x.x.x`, `(13,24,5)` = `.x.x.x.xx.x.x.x.x.xx.x.x`.
  - Sources: [Strudel euclid.mjs/util.mjs/test](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) (npm `@strudel/core@1.2.6`, `@strudel/mini@1.2.6`)

### Inferences
- The rotation arguments in Toussaint-derived lists (14, 5, 2) were written for Tidal's left-shift convention. Pasted into Strudel 1.2.6 they rotate the other way. You get the same *necklace* but a different phase relative to the downbeat, so it may not match the traditional starting point. For n=16 with rotation 14, the left shift of 14 that Tidal's docs describe equals a right shift of 2, while Strudel performs a right shift of 14 (= a left shift of 2). Confirm in the Strudel REPL before stating it to readers as fact; I did not run the REPL.
- Several of these attributions are best read as "a rotation of the traditional pattern". That is what Toussaint means by "necklace". Example: the bossa-nova clave `x..x..x...x..x..` has intervals 3-3-4-3-3, a rotation of E(5,16) = 3-3-3-3-4 (I checked by computation). By contrast, the son clave `x..x..x...x.x...` (3-3-4-2-4) is **not** a rotation of E(5,16), and so is not Euclidean (computed). This fits Toussaint's broader work: in other papers he discusses the son clave as *not* maximally even. **[unverified – memory]**

### Gaps
- I could not check each attribution directly against the PDF.
  - The Tidal list may have been edited or abridged from the paper. For example, the paper's wording for E(3,5) is, from memory, "when started on the second onset" rather than "rotation 2". **[unverified]**
  - The paper also lists rhythms Tidal omits, e.g. E(2,3), E(4,12), E(6,7) and E(5,13). **[unverified]**
- I made no independent ethnomusicological check of claims such as "Zappa, Outside Now" being 4-in-11 or "Mussorgsky, Pictures" being 5-in-11. These are Toussaint's attributions as transmitted. Promenade in *Pictures at an Exhibition* alternates 5/4 and 6/4, i.e. 11 beats per two bars, which is consistent with 5 groups over 11. **[background knowledge, not source-verified]**

## 4. Why coprime k and n matter; necklace and rotation equivalence

### Takeaway
If gcd(k,n) = d > 1, E(k,n) is just E(k/d, n/d) repeated d times, up to rotation, so it has a shorter internal period. Only coprime (k,n) give a pattern whose period is the full n steps, with the characteristic asymmetric "long-short" feel. Every rotation of a Euclidean rhythm is equally "even". Musically, the rotations form one necklace, and which rotation is traditional is a matter of style.

### Cited Findings
- Computed with Strudel's `bjorklund`:
  - E(4,12) = `x..x..x..x..` (intervals 3-3-3-3, i.e. E(1,3)×4)
  - E(6,16) = `x..x.x..x..x.x..` (3-2-3-3-2-3, a rotation of E(3,8)×2)
  - E(6,8) = `x.xxx.xx` (2-1-1-2-1-1, a rotation of E(3,4)×2)
  - Source: [Strudel euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs) (run locally)
- Complements of Euclidean rhythms are Euclidean necklaces. Computed: the complement of E(3,8) is a rotation of E(5,8); the complement of E(5,12) is a rotation of E(7,12); the complement of E(7,16) is a rotation of E(9,16). Strudel exposes the complement directly through negative pulses, since `bjorklund(-3,8)` = `.xx.xx.x` per its unit test. — [Strudel test](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/test/euclid.test.js)
- Toussaint uses "rhythm necklace" for the rotation class, as in the "Bossa-Nova rhythm necklace" and "Samba rhythm necklace" entries in the attribution list. — [Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md)
- Euclidean rhythms coincide with the "maximally even sets" of Clough and Douthett (1991) from music theory, the same property that makes the diatonic scale (7 in 12) evenly spread. Demaine et al. (2009) formalise this link. **[unverified – memory; Demaine et al. paper page: [erikdemaine.org](https://erikdemaine.org/papers/DeepRhythms_CGTA)]**

### Inferences
- Practical consequence: `bd(4,16)` is just four-on-the-floor, and `bd(6,16)` is a tresillo repeated twice. To get a true full-length asymmetric timeline, choose k coprime with n, e.g. (3,8), (5,8), (5,12), (7,12), (7,16), (9,16), (5,16), (11,24) or (13,24). Every entry in Toussaint's attribution list above is coprime.
- A nice teaching point: E(7,12) is the West African bell pattern, and as a pitch set it has the same "7 maximally spread over 12" shape as the diatonic scale. This is the maximal-evenness link. **[relies on the unverified Clough–Douthett item above]**

### Gaps
- Clough & Douthett 1991 and the Demaine et al. proofs could not be fetched for direct citation.

## 5. Practical tips for composing with Euclidean rhythms in Strudel/Tidal

### Takeaway
Layer several Euclidean patterns with different k or n, and use rotations and complements so the parts interlock. Different n per layer gives polymeter or cross-rhythm. The same (k,n) at different rotations gives call-and-response figures.

### Cited Findings
- Tidal's docs show layering several Euclidean parts in one stack, e.g. `"[bd(3,8), cp(2,8), hh(7,8), bass:1(7,16)]"` and `"[bd(5,8), cp(4,8), hh(7,8), bass:1(7,16)]"`. They also show spreading one Euclidean rhythm across different samples, e.g. `s "east(4,7)" # n "2 3 0 5"`. — [Tidal docs source](https://raw.githubusercontent.com/tidalcycles/tidal-doc/main/docs/reference/mini_notation.md)
- Music-tech press advice (summarised from search snippets):
  - Layering several Euclidean patterns can "replicate the interweaving cross rhythms of African and Latin music".
  - Using a different length for each sequence means working "in multiple time signatures at once", so the loops interact differently on every pass.
  - Rotating or offsetting a pattern makes the same values sound more complex, and the same sequence can be layered at different rotations.
  - Sources: [MusicRadar](https://musicradar.com/how-to/what-is-euclidean-sequencing-and-how-do-you-use-it); [Splice blog](https://splice.com/blog/euclidean-rhythms); [Synthtopia](https://www.synthtopia.com/content/2017/10/19/polyrhythmic-sequencing-with-euclidean-rhythms/). I saw these only as search snippets and did not read the full articles.
- Strudel has extra variants beyond `euclid`/`euclidRot` (from the 1.2.6 source/JSDoc):
  - `euclidLegato`: "each pulse is held until the next pulse, so there will be no gaps".
  - `euclidLegatoRot`.
  - `euclidish`/`eish`: morphs from a strict Euclidean pattern (0) to an even pulse (1), "Inspired by the work of Malcom Braff".
  - `bjork([k,n,rot])`.
  - Source: [Strudel euclid.mjs](https://codeberg.org/uzu/strudel/src/branch/main/packages/core/euclid.mjs)

### Inferences
These tips are derived from the theory above and not individually sourced.
1. **Complement layering.** Put a part on E(k,n) and another on its complement, e.g. kick `(3,8)` with hats `(-3,8)`, if negative pulses work in mini-notation (code path suggests yes; untested). Together they fill every step with no collisions. That gives tresillo plus cinquillo-shaped fill.
2. **Same n, different k** (e.g. 3,5,7 over 8 or 16) stays phase-locked each cycle and sounds like a single groove.
3. **Different n** (e.g. `(3,8)` against `(5,12)`) squeezes both into one Strudel cycle, giving a cross-rhythm (8 vs 12 subdivisions = 2:3 feel) rather than drifting polymeter. For a drifting polymeter, change each layer's cycle length, e.g. with `{}` polymetric notation or `.slow()`.
4. **Rotation as variation.** Patterning the rotation, e.g. `"bd(3,8,<0 2 4>)"`, keeps the same necklace while moving the accent relative to the downbeat. Remember that Strudel's rotation direction appears to be opposite to Tidal's docs (section 3).
5. **Prefer coprime (k,n)** for timeline or bell parts. Non-coprime values give simpler repeating sub-patterns, which suit kick or four-on-the-floor parts.
6. **Pattern the arguments**, e.g. `"hh(<5 7>,16)"`, to move between related Euclidean densities. 7- and 9-in-16 are complementary samba and Central African necklaces.

### Gaps
- No Strudel REPL or audio test was performed. Mini-notation behaviour of negative pulses and patterned rotation was inferred from the npm source, not executed in the REPL.
- I did not read the full text of the music-press articles, only search snippets.
