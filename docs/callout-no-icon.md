# Callouts Without Icons

Add `no-icon` after the callout type to hide its icon while keeping the title:

```md
> [!note|no-icon] A title without an icon
> The callout body is unchanged.
```

Separate metadata keywords with spaces to combine them:

```md
> [!note|no-bg no-icon] A title without a background or icon
> Both metadata options apply.
```

`no-icon` hides only the current callout's title icon. Nested callouts keep their
own icons unless they also use `no-icon`. Collapsible callouts retain their fold
control and can still be expanded by clicking the title. To hide the entire title,
use the existing `no-title` metadata instead.

Supported in Live Preview, Reading mode, and `publish.css`.

In notes with `cssclasses: cornell`, combine the Cornell `inline` keyword with
`no-icon` as `> [!note|inline no-icon] Title`. The current theme keeps the same
Cornell alignment as `inline` alone, including in print. Outside Cornell notes,
`inline` does not enable a separate inline-callout layout.
