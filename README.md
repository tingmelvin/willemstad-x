![wx-github-2-mini](https://user-images.githubusercontent.com/43155211/159142584-70b88e36-7634-4ddb-9ee1-1a7c11f0b2c9.png)


# Willemstad X (Extended)
Named after the capital of Curaçao (which is known for its colourful houses), the extended _Willemstad_ is a fully-fledged theme and extension of [the original _Willemstad_ snippet/theme variant proof-of-concept](https://github.com/tingmelvin/willemstad) for Chris Grieser (pseudometa)'s [Obsidian](https://obsidian.md/) theme, [Shimmering Focus](https://github.com/chrisgrieser/shimmering-focus). You can sponsor Chris [here](https://ko-fi.com/pseudometa)!

**NOTE!** Willemstad X is not supported for the legacy editor (CodeMirror 5), or for mobile. While mobile support might be coming in the longer future, you are advised only to use Willemstad X on desktop, and in the current default editor.

**To use**:

For the most current version, use the Community Theme store in Obsidian. __(this is the preferred and recommended method!)__ 

Alternatively, download the release, and drop `obsidian.css` into your `.obsidian\themes` folder in the vault you wish to have the theme in.

---

### Why is Inter embedded into Willemstad X, isn't that included in Obsidian proper?
Yes, it is. Inter is included in Obsidian proper. However, most people will download Inter onto their computers, and Obsidian [will use the font with the name that is present in your computer](https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/Best+Practices+and+Tips+for+Theme+Development). Moreover, most people (**including myself**) download/-s/-ed Inter from Google Fonts, [which is probably the most outdated version you can get of the font](https://github.com/rsms/inter#alternate-distributions). (No proper _italics_, need I say more?!) By embedding Inter, alongside the other fonts, allows me to quality control and ensure the quality of your experience.

### I'd like to change something or propose something. What's the easiest way to do so?
If it's something you reckon people would need/want as well, the easiest way to request changes is to use the Issues tab here on GitHub. If you would like to change something that you can reckon you rather do it yourself, the best way would be to use a snippet.

Alternatively, and if you are familiar with Sass/SCSS, you can compile Willemstad yourself via the files in the `build` folder, and fork the repo and edit the relevant files you want to. To understand what each specific SCSS file consists of, consult [here](https://willemstad.cc/Development+Docs/Revamp+v0.4). This might be slightly outdated.

---

## Supported Community Plugins
Like Primary, Willemstad aims to get the core features right before delving into plugins. However, I totally agree that some plugins are almost essential to the Obsidian experience, and they were my daily drivers too, so they did get a bit of work done to it.
1. Style Settings
2. Calendar
3. Sliding Panes
4. Admonitions
5. Dataview
7. Breadcrumbs
8. Advanced Tables
9. Full Calendar
10. Get Info
11. CookLang Plugin
12. Emoji Toolbar
13. Maps of Content
14. cMenu
15. Footnote & Citation Indicator
16. Longform
17. Settings Search
18. LanguageTool Integration
and more.

The full list of supported community plugins can be found [here](https://willemstad.cc/Development+Docs/Coding+Nomenclatures).

## Attribution
As is with most theme codes in Obsidian, many pieces/snippets of code have been cobbled together from whatever the hive mind has created. It is therefore not possible to accurately and fully attribute everyone's efforts, which might have come into and been adopted by this theme. That being said, there are multiple pieces of instrumental code that I can attribute to, which I do so here:
- Multi-Colour Highlighting, adapted from [Zhang Chenyu (@Atlas)](https://github.com/zcysxy)'s and [Chris Grieser (@pseudometa)](https://github.com/chrisgrieser)'s code
- Varying/Readable Underlines, co-written by myself and [Cecilia May](https://github.com/ceciliamay)
- Dataview Word Wraps, from [SlRvB](https://github.com/SlRvb)
- No-Shadow Sliding Panes, with input from [Damian Korcz](https://github.com/damiankorcz)
- No-Shadow Admonitions, inspired by Leah's lamentations to [Jeremy Valentine](https://github.com/valentine195)
- Longform plugin and `writing` cssclass support, adapted from [Chris Grieser (@pseudometa)](https://github.com/chrisgrieser)'s code, and also with credits to [Kevin Barrett (@kevboh)](https://github.com/kevboh/longform)'s [styling](https://github.com/kevboh/longform#scene-only-styling)
- and many other snippets that were written by [Chris Grieser](https://github.com/chrisgrieser)
- Nord theme colour palette, adapted from the original documentation written by [Sven Greb](https://github.com/svengreb)
- Minimal Cards and Image Grids, from [Stephan Ango](https://github.com/kepano)


## Theme Documentation (currently a work in progress)
Available [here](https://willemstad.cc), includes information on [callouts](https://willemstad.cc/Theme+Extensions/Callouts).

## Mentions in the Obsidian Roundup
[4th June](https://www.obsidianroundup.org/2022-06-04/) | [14th May](https://www.obsidianroundup.org/2022-05-14/) | [23rd April](https://www.obsidianroundup.org/2022-04-23/) | [16th April](https://www.obsidianroundup.org/2022-04-16/) | [04th April](https://www.obsidianroundup.org/2022-04-02/) | [26th March](https://www.obsidianroundup.org/differentiate-versions-embed-web-apps/) | [12th March](https://www.obsidianroundup.org/2022-03-12/) | [5th March](https://www.obsidianroundup.org/2022-03-05/) | [26th February](https://www.obsidianroundup.org/2022-02-26/) | [19th February](https://www.obsidianroundup.org/2022-02-19/)

and of the original Willemstad snippet for Shimmering Focus:
[12th February](https://www.obsidianroundup.org/2022-02-12/) and [5th February](https://www.obsidianroundup.org/2022-02-05/)

### Just another word
Having a theme out within 2.5 weeks of trying to do something with CSS (from the time I left [Sanctum](https://github.com/jdanielmourao/obsidian-sanctum), which I honestly think [jdaniel](https://github.com/jdanielmourao) did an amazing job with) is probably something I didn't think was possible even a week before this was published.
That being said, [Chris](https://github.com/chrisgrieser) (of [Shimmering Focus](https://github.com/chrisgrieser/shimmering-focus) fame), [Cecilia](https://github.com/ceciliamay) (of [Primary](https://github.com/ceciliamay/obsidianmd-theme-primary) fame), and [SlRvB](https://github.com/SlRvb) (of [ITS Theme](https://github.com/SlRvb/Obsidian--ITS-Theme) fame) prophesied I would end up with a theme and had more faith in me than I did. I owe them a word of thanks. Thanks y'all, and I hope I didn't let anyone of you down. :blush:

---
### Note on `snippet.css` file
(this file will be updated again once some issues are ironed out)

Currently includes:

## Callouts
| Title | Image |
| -- | -- |
| `kanban` | <img src="https://user-images.githubusercontent.com/43155211/159336761-f44cd2e6-9f37-407b-a4fa-485cce949ed3.png" width="500">
| `aside` | |
|`infobox`| |

## CSS Classes
| Title | Image |
| -- | -- |
| `latex` | <img src="https://user-images.githubusercontent.com/43155211/159337451-70b6e80a-16e9-47c1-a2b5-06688aeaeb43.png" width="500"> |
| `magazine` | <img src="https://user-images.githubusercontent.com/43155211/159337592-5b264de3-fa1c-484d-afc0-4eb69699b5d2.png" width="500"> |


---
### License
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
This repository is licensed under the terms of Mozilla Public License version 2.0. Most of its constituent snippets (callouts, CSSClass, etc.) are licensed under the terms of the MIT license, either by myself or its respective authors.
