>[!note] Willemstad. Set once and get on with work.
> The theme documentation is available [here](https://willemstad.cc/).
>
> See our rather-numerous [callout types supported](https://willemstad.cc/Features/Callouts/Callouts).
> Willemstad also supports [Alternative Checkboxes](https://willemstad.cc/Features/Alternative+Checkboxes+Reference+Set).
>
> If you need examples on what colour palettes to use from Willemstad, see [here](https://willemstad.cc/Showcase).

![Willemstad-X](https://github.com/user-attachments/assets/46dd7d2b-6520-4deb-8d12-30ad4c822fa3)

# Willemstad
Named after the capital of Curaçao (which is known for its colourful houses), the extended _Willemstad_ is a fully-fledged theme and extension of [the original _Willemstad_ snippet/theme variant proof-of-concept](https://github.com/tingmelvin/willemstad) for Chris Grieser (pseudometa)'s [Obsidian](https://obsidian.md/) theme, [Shimmering Focus](https://github.com/chrisgrieser/shimmering-focus). You can sponsor Chris [here](https://ko-fi.com/pseudometa)!

**To use**:

For the most current version, use the Community Theme store in Obsidian. __(this is the preferred and recommended method!)__ 

Alternatively, download the release, and drop `obsidian.css` into your `.obsidian\themes` folder in the vault you wish to have the theme in.

---

### Why is Inter embedded into Willemstad X, isn't that included in Obsidian proper?
There are a few reasons for this:
1. While Inter is included in Obsidian proper, Obsidian does not support all font-weights of Inter.
2. Most people will download Inter onto their computers, and Obsidian [will use the font with the name that is present in your computer](https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/Best+Practices+and+Tips+for+Theme+Development).
3. Moreover, most people (**including myself**) will have had downloaded Inter from Google Fonts, [which is probably the most outdated version you can get of the font](https://github.com/rsms/inter#alternate-distributions), which has no proper italics.
4. There has been a case in the past in which Obsidian failed to work with fonts if it was not embedded into the theme. This prevents that occurence from happening again.
By embedding Inter, alongside the other fonts, allows me to quality control and ensure the quality of your experience.

### I'd like to change something or propose something. What's the easiest way to do so?
If it's something you reckon people would need/want as well, the easiest way to request changes is to use the Issues tab here on GitHub. If you would like to change something that you can reckon you rather do it yourself, the best way would be to use a snippet.

---

## Supported Community Plugins
Please refer to the [Willemstad theme documentation](https://willemstad.cc).

## Attribution
As is with most theme codes in Obsidian, many pieces/snippets of code have been cobbled together from whatever the hive mind has created. It is therefore not possible to accurately and fully attribute everyone's efforts, which might have come into and been adopted by this theme. That being said, there are multiple pieces of instrumental code that I can attribute to, which I do so here:
- Multi-Colour Highlighting, adapted from [Zhang Chenyu (@Atlas)](https://github.com/zcysxy)'s and [Chris Grieser (@pseudometa)](https://github.com/chrisgrieser)'s code
- Varying/Readable Underlines, co-written by myself and [Cecilia May](https://github.com/ceciliamay)
- Dataview Word Wraps, from [SlRvB](https://github.com/SlRvb)
- No-Shadow Sliding Panes, with input from [Damian Korcz](https://github.com/damiankorcz)
- No-Shadow Admonitions, inspired by Leah's lamentations to [Jeremy Valentine](https://github.com/valentine195)
- Longform plugin and `writing` cssclass support, adapted from [Chris Grieser (@pseudometa)](https://github.com/chrisgrieser)'s code, and also with credits to [Kevin Barrett (@kevboh)](https://github.com/kevboh/longform)'s [styling](https://github.com/kevboh/longform#scene-only-styling)
- and many other snippets that were written by [Chris Grieser](https://github.com/chrisgrieser).

This theme uses assets/colour palettes and fonts all publicly available and open-sourced, such as
- Nord theme colour palette, adapted from the original documentation written by [Sven Greb](https://github.com/svengreb)
- The MetBrewer colour palettes, created and compiled by [Blake R. Mills](https://github.com/BlakeRMills/MetBrewer)
- Inter font, created by [Rasmus Andersson](https://github.com/rsms/inter)
- Manrope font, created by Mikhail Sharanda and no longer available on GitHub
- ... and many more.

## Theme Documentation
Available [here](https://willemstad.cc).

### Just another word
Having a theme out within 2.5 weeks of trying to do something with CSS (from the time I left [Sanctum](https://github.com/jdanielmourao/obsidian-sanctum), which I honestly think [jdaniel](https://github.com/jdanielmourao) did an amazing job with) is probably something I didn't think was possible even a week before this was published.
That being said, [Chris](https://github.com/chrisgrieser) (of [Shimmering Focus](https://github.com/chrisgrieser/shimmering-focus) fame), [Cecilia](https://github.com/ceciliamay) (of [Primary](https://github.com/ceciliamay/obsidianmd-theme-primary) fame), and [SlRvB](https://github.com/SlRvb) (of [ITS Theme](https://github.com/SlRvb/Obsidian--ITS-Theme) fame) prophesied I would end up with a theme and had more faith in me than I did. I owe them a word of thanks. Thanks y'all, and I hope I didn't let anyone of you down. :blush:

<!-- ![wx-github-2-mini](https://user-images.githubusercontent.com/43155211/159142584-70b88e36-7634-4ddb-9ee1-1a7c11f0b2c9.png) -->

---
### License
Previous versions of Willemstad was licensed under the Mozilla Public License 2.0. From version 1.1 onwards this is licensed under GNU Public License 3.0 (GPL 3.0)

Willemstad's code in its earlier days includes constituent snippets (CSSClass, code written in conjunction with, or by other developers) and components that are licensed under the terms of the MIT license or another license, either by myself or its respective authors. These parts of the code take the original licence and remain as is.

You will obtain a compiled copy of the CSS code, which includes the snippets as well (as these do not require compiling). However, since version 1.1 the uncompiled SASS/SCSS source code will no longer be available on GitHub.
