# Recover Style Settings After a Restart

If Willemstad returns to its default colours after restarting Obsidian, check
whether Style Settings has loaded and whether **Willemstad** remains selected in
**Settings > Appearance**.

In [issue #60](https://github.com/tingmelvin/willemstad-x/issues/60), the macOS
reporter confirmed that reinstalling Style Settings restored the settings. The
maintainer linked an [upstream plugin startup
issue](https://github.com/community-archive/obsidian-style-settings/issues/178).
That report does not establish that the theme deletes saved settings.

## Preserve Configuration

Before uninstalling, use Style Settings' **Export** control when available. Also
back up `.obsidian/plugins/obsidian-style-settings/data.json` in the vault, if it
exists. Substitute the vault's custom configuration directory for `.obsidian` if
needed. Keep the backup private; it may contain other themes' or snippets' settings.

## Recovery Steps

1. In **Settings > Community plugins**, disable and re-enable **Style Settings**.
2. Reopen its settings and check whether the selected palette is applied.
3. If it still fails, confirm the backup exists, then uninstall and reinstall
   Style Settings through **Community plugins** and enable it.
4. If reinstalling removed preferences, restore them with **Import** from the
   export. Do not overwrite plugin data while Obsidian is writing it.
5. Restart Obsidian and check both the selected values and resulting colours.

If it recurs, test in a separate vault with only Willemstad and Style Settings.
Record the Obsidian, installer, theme, and plugin versions, plus any console error.
A startup error such as `view.setSettings is not a function` belongs in the linked
plugin issue. For a theme parsing error, include the affected setting ID. Share
only a sanitized error and a non-private sample.

CSS cannot repair a plugin's startup state. Reinstalling was a confirmed
workaround for the original reporter, not a guaranteed fix for all settings issues.
