# Write like Jon: the data

The tables behind [SKILL.md](SKILL.md). Built from all 1,381 Hacker News comments by [jwilliams](https://news.ycombinator.com/user?id=jwilliams), 3 Sep 2008 to 26 Nov 2026, and 22 Lobsters comments by [jonathannen](https://lobste.rs/~jonathannen/threads). Collected 26 Nov 2026.

## How the voice changed

Share of comments in each period, unless the row says otherwise. Follow the "2026 only" column.

| Share of comments | 2008-09 | 2010-16 | 2017-20 | 2021-26 | 2026 only |
| --- | ---: | ---: | ---: | ---: | ---: |
| Comments | 805 | 207 | 261 | 108 | 88 |
| Median length (words) | 44 | 54 | 55 | 44 | 44 |
| Top-level, not a reply | 35% | 37% | 39% | 46% | 45% |
| First person (I, we, my) | 63% | 75% | 72% | 79% | 82% |
| Concrete personal or company experience | 23% | 30% | 35% | 40% | 43% |
| Says "we" | 6% | 5% | 10% | 21% | 24% |
| Contains a question | 26% | 24% | 10% | 23% | 24% |
| Opens by quoting with > | 7% | 0% | 8% | 9% | 11% |
| At least one hedge | 49% | 39% | 41% | 45% | 48% |
| Spaced hyphen as a dash ( - ) | 62% | 47% | 38% | 37% | 34% |
| Double hyphen ( -- ) | 8% | 20% | 22% | 8% | 10% |
| Ellipsis ( ... ) | 34% | 17% | 10% | 15% | 17% |
| \*Emphasis\* or italics | 15% | 13% | 7% | 20% | 23% |
| Exclamation mark | 2% | 6% | 4% | 9% | 11% |
| Smiley | 3% | 2% | 0% | 1% | 1% |
| The word "yeah" | 9% | 4% | 0% | 0% | 0% |
| The word "definitely" | 1% | 2% | 4% | 7% | 9% |
| Has a link | 13% | 13% | 11% | 14% | 14% |
| British / American spellings (count) | 78 / 42 | 24 / 39 | 1 / 61 | 4 / 12 | 2 / 12 |

Experience, hedges and questions are detected with keyword patterns, so treat those rows as approximate. The 2008-09 italics figure includes quotes, which he set in italics then.

## Reply rates

"Drew a reply" is the share of comments in the group that drew at least one direct reply from someone else. His overall rate is 43%, with 0.64 direct replies on average. A reply is a response, not an upvote.

### Opening move, 2017 onward

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| Opens by quoting a line (>) | 77% | 1.63 | 30 |
| No opening quote | 42% | 0.70 | 339 |

Before 2017 he quoted in italics or not at all, so the comparison starts there.

### Stance

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| Pushes back | 56% | 0.98 | 232 |
| Adds information | 42% | 0.60 | 990 |
| Opens by agreeing | 30% | 0.38 | 159 |

Stance is keyword-tagged: an agreeing first word (Agree, Yeah, Indeed, Fair, Thanks) or disagreement markers anywhere (I don't think, not sure, at odds, fails to, counterpoint).

### Top-level or reply

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| Top-level comment | 48% | 0.81 | 513 |
| Reply to a comment | 40% | 0.54 | 868 |

### Top-level comments: time since the story was posted

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| Under 1 hour | 47% | 0.86 | 133 |
| 1 to 3 hours | 57% | 0.96 | 166 |
| 3 to 8 hours | 47% | 0.76 | 122 |
| 8 to 24 hours | 36% | 0.56 | 73 |
| Over a day | 42% | 0.58 | 12 |

### Top-level comments: size of the story

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| Under 50 points | 42% | 0.53 | 288 |
| 50 to 199 | 59% | 1.10 | 143 |
| 200 to 499 | 57% | 1.85 | 46 |
| 500 and up | 45% | 0.66 | 29 |

Story points as reported by Algolia on 26 Nov 2026.

### Length

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| 25 words or fewer | 36% | 0.47 | 338 |
| 26 to 60 | 43% | 0.63 | 516 |
| 61 to 120 | 47% | 0.72 | 352 |
| Over 120 | 51% | 0.83 | 175 |

### Contains a question

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| Asks a question | 52% | 0.82 | 305 |
| No question | 41% | 0.59 | 1,076 |

### Links

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| No link | 44% | 0.64 | 1,204 |
| Any link | 38% | 0.66 | 177 |
| Link to his own writing or code | 20% | 0.40 | 10 |

Own link means jonathannen.com or his GitHub. Ten comments, nine of them from 2026.

### Topic of the thread

| Group | Drew a reply | Avg replies | n |
| --- | ---: | ---: | ---: |
| AI / LLMs / agents | 55% | 1.05 | 58 |
| Energy / science / engineering | 53% | 1.05 | 59 |
| Economy / finance / politics | 51% | 0.76 | 88 |
| Programming / languages / dev tools | 46% | 0.71 | 278 |
| Australia | 44% | 0.58 | 36 |
| Big tech / web companies | 42% | 0.64 | 113 |
| Startups / funding / business | 38% | 0.50 | 155 |
| Apple / devices / hardware | 37% | 0.55 | 89 |
| Work / management / careers | 37% | 0.48 | 71 |
| Ask / Show HN & community | 26% | 0.30 | 76 |
| Other | 45% | 0.61 | 358 |

Topics are keyword-tagged from the story title, then the comment text. "Other" is everything the keywords missed.

## Position in the thread, 2026

Rank of each of his 38 top-level comments from 2026 among the story's top-level comments, as the page stood on 26 Nov 2026, in threads with at least five top-level comments. Ordered from top of thread to bottom. 13 sit in the top quarter, 3 are first, 3 sit in the bottom quarter; the median is 36% of the way down.

| Rank | Comment | Rank | Comment |
| --- | --- | --- | --- |
| 1 of 10 | [48143488](https://news.ycombinator.com/item?id=48143488) | 12 of 31 | [47490381](https://news.ycombinator.com/item?id=47490381) |
| 1 of 30 | [48144871](https://news.ycombinator.com/item?id=48144871) | 264 of 698 | [48090308](https://news.ycombinator.com/item?id=48090308) |
| 1 of 112 | [48176627](https://news.ycombinator.com/item?id=48176627) | 15 of 36 | [47245227](https://news.ycombinator.com/item?id=47245227) |
| 5 of 64 | [48232573](https://news.ycombinator.com/item?id=48232573) | 6 of 12 | [48032182](https://news.ycombinator.com/item?id=48032182) |
| 5 of 58 | [50421097](https://news.ycombinator.com/item?id=50421097) | 11 of 22 | [47606060](https://news.ycombinator.com/item?id=47606060) |
| 2 of 15 | [47345293](https://news.ycombinator.com/item?id=47345293) | 5 of 9 | [47597647](https://news.ycombinator.com/item?id=47597647) |
| 4 of 40 | [47254109](https://news.ycombinator.com/item?id=47254109) | 13 of 23 | [47389322](https://news.ycombinator.com/item?id=47389322) |
| 5 of 43 | [50646949](https://news.ycombinator.com/item?id=50646949) | 84 of 136 | [47509353](https://news.ycombinator.com/item?id=47509353) |
| 10 of 95 | [46790488](https://news.ycombinator.com/item?id=46790488) | 48 of 75 | [47596806](https://news.ycombinator.com/item?id=47596806) |
| 5 of 31 | [50649994](https://news.ycombinator.com/item?id=50649994) | 57 of 88 | [50579152](https://news.ycombinator.com/item?id=50579152) |
| 6 of 33 | [47992006](https://news.ycombinator.com/item?id=47992006) | 54 of 82 | [47790961](https://news.ycombinator.com/item?id=47790961) |
| 9 of 42 | [48029826](https://news.ycombinator.com/item?id=48029826) | 9 of 13 | [47728262](https://news.ycombinator.com/item?id=47728262) |
| 7 of 28 | [47957532](https://news.ycombinator.com/item?id=47957532) | 18 of 26 | [47832187](https://news.ycombinator.com/item?id=47832187) |
| 41 of 151 | [47378931](https://news.ycombinator.com/item?id=47378931) | 8 of 11 | [47557261](https://news.ycombinator.com/item?id=47557261) |
| 13 of 45 | [47381277](https://news.ycombinator.com/item?id=47381277) | 98 of 139 | [49651547](https://news.ycombinator.com/item?id=49651547) |
| 22 of 66 | [48144712](https://news.ycombinator.com/item?id=48144712) | 32 of 45 | [47543656](https://news.ycombinator.com/item?id=47543656) |
| 5 of 13 | [47044136](https://news.ycombinator.com/item?id=47044136) | 10 of 13 | [46938656](https://news.ycombinator.com/item?id=46938656) |
| 25 of 68 | [47377909](https://news.ycombinator.com/item?id=47377909) | 24 of 30 | [47378099](https://news.ycombinator.com/item?id=47378099) |
| 39 of 107 | [47556094](https://news.ycombinator.com/item?id=47556094) | 75 of 80 | [47789269](https://news.ycombinator.com/item?id=47789269) |

Read down the left pair of columns, then the right.

## His ten most-replied comments

Ranked by direct replies, ties broken by total descendants.

| # | Comment | What it does | Thread | Replies | Descendants |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | [Typing speed? Not sure how much code people here write per hour, but I doubt typing speed is a real issue (the ratio...](https://news.ycombinator.com/item?id=510127) | One-line challenge to the article's premise, with his own 10:1 thinking-to-typing ratio | Core competencies of great hackers (Mar 2009, top-level, 35 words) | 18 | 58 |
| 2 | [Rovelli is arguing (I think) that we need to fundamentally view consciousness as a natural phenomenon - albeit one...](https://news.ycombinator.com/item?id=48176627) | Restates the author's argument in plain terms, then says the frame is wrong | It is time to give up the dualism introduced by the debate on consciousness (May 2026, top-level, 114 words) | 16 | 250 |
| 3 | [Interesting, although I think the "beta" is quite literal. Seems to lack a bit of polish. The one I was most...](https://news.ycombinator.com/item?id=6223371) | Tried the thing and reports a concrete bug, with the link | Brick - UI Components for Modern Web Apps (Aug 2013, top-level, 39 words) | 10 | 21 |
| 4 | [I've got the 13" maxed out Late 2016. I've owned every form factor of the MacBook Pro and this is my least favorite....](https://news.ycombinator.com/item?id=13692234) | Owner's review, feature by feature, from someone who has had every model | Thoughts on the Late 2016 MacBook Pro (Feb 2017, top-level, 268 words) | 7 | 22 |
| 5 | [(I've used both DataPower and COBOL - I've got a healthy respect for robust, long-lived legacy systems). I must admit...](https://news.ycombinator.com/item?id=20713030) | Credentials in brackets, then a defence of the system everyone else was mocking | The Order of the JSON (Aug 2019, top-level, 115 words) | 7 | 19 |
| 6 | [> Claude Code navigates a codebase the way a software engineer would: it traverses the file system, reads files, uses...](https://news.ycombinator.com/item?id=48144871) | Quotes two passages and argues they contradict each other, from daily use | How Claude Code works in large codebases (May 2026, top-level, 204 words) | 7 | 13 |
| 7 | [Personally, I have some concerns over this approach. Google is a mediator between users and information. As such,...](https://news.ycombinator.com/item?id=317219) | Polite dissent on a popular position, reasons in three short paragraphs | Google backs gay marriage (Sep 2008, top-level, 137 words) | 5 | 50 |
| 8 | [It was genuinely a surprise to see how much relative energy petrol cars use (and shame on me - I'm an electrical...](https://news.ycombinator.com/item?id=47254109) | Admits surprise, with a self-deprecating credential | Does that use a lot of energy? (Mar 2026, top-level, 38 words) | 5 | 35 |
| 9 | [> You may be overestimating how easy cut and cover is. You're right. In fact, the Market Street passage of BART/Muni...](https://news.ycombinator.com/item?id=16852129) | Concedes the point, then adds local San Francisco history and a source | Why New York City Stopped Building Subways (Apr 2018, reply, 96 words) | 5 | 8 |
| 10 | [Pretty early on it calls code & design reviews "overhead", with "The Man" underneath. Maybe I'm missing some...](https://news.ycombinator.com/item?id=5542577) | Points at one detail in the deck and disagrees from experience | Keeping People (Apr 2013, top-level, 38 words) | 5 | 8 |

Five of the ten are tagged as pushback. Descendants are very uneven: the Rovelli comment alone holds 250 of the 426 descendants under everything he wrote from 2021 to 2026.

## Lobsters scores

Lobsters shows comment scores to everyone. The first page of his threads holds 22 comments from 28 Apr to 22 Nov 2026: median score 3, mean 6.2. The six highest:

| Score | Comment | Story |
| ---: | --- | --- |
| 33 | [I've been at it 30+ years and I think this article is a little bit too rosy on the past. Let's not forget, say,...](https://lobste.rs/c/kg5pbm) | Software is breaking down at a systemic level (69 words, top-level) |
| 18 | [I bristled a bit at: "Open Source code written since RMS announced the GNU Project and the Free Software Movement." ...](https://lobste.rs/c/zr3eau) | All AI-generated code should be Open Source (42 words, top-level) |
| 14 | [I've worked on a lot of (very) legacy codebases. In these cases, nobody that wrote the code is anywhere to be found. So...](https://lobste.rs/c/2iyl5c) | My Thoughts on Bun's Rust Rewrite (214 words, reply) |
| 14 | [I'd add a significant category to unwanted states: messy reality. This comes up a lot with people data, which is often...](https://lobste.rs/c/fsmplu) | Illegal vs Unwanted States (79 words, top-level) |
| 9 | [It's a real grab-bag of topics for sure. If I squint I'd distill it down: Build durable skills, develop good taste,...](https://lobste.rs/c/ah3rjq) | A sustainable web career, for when all this blows over (42 words, reply) |
| 7 | [I mean this is how we literally used to do it - programs came as BASIC in a magazine and you typed them in yourself. >...](https://lobste.rs/c/3h83af) | Type out the code (153 words, top-level) |

- The top comment (33) and the third (14) quote a line and answer it from long experience. The second (18) picks out one sentence and corrects the history. The fourth (14) adds a category the article missed, with a war story from an insurance system.
- The three comments that link to his blog scored 1, 2 and 4.
- His shortest comment, a ten-word question, scored 2.

## Method and limits

- **Corpus:** all 1,381 comments by jwilliams, 3 Sep 2008 to 26 Nov 2026. Metadata from the Algolia HN API; full text and reply trees from his 114 public threads pages, matched one to one. Collected 26 Nov 2026.
- **Lumpy history:** 805 comments (58%) are from 2008 and 2009, 88 from 2026, and only 20 from 2021 to 2025. All-years findings lean on the early period, when HN was much smaller. Where the recent data disagrees, the guide says so.
- **Replies:** counts of comments by other people nested under his, as shown on the collection date. His own follow-ups are excluded. He replied again in 35% of threads where someone answered him.
- **Timing:** minutes between the story's creation time in Algolia and his comment. Stories that were re-upped by moderators can make a prompt comment look late.
- **Position:** 60 story pages from 2026 were read once. HN's ordering also weighs age and moderation, so position is a rough guide to votes, not a score.
- **Tags:** topic, stance, hedge, experience and question flags come from keyword patterns. They were spot-checked by reading about 270 comments across all periods, not validated one by one.
- **Not covered:** his LinkedIn comments, HN submissions, and his private view of his own HN points. Opening his threads page while logged in would show real scores and would settle most of the open questions here.

Built from public data on news.ycombinator.com, hn.algolia.com and lobste.rs. Quotes are verbatim and link to the original comment.
