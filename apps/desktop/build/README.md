# App icon assets

The owner-supplied mark is `docs/design/osmiumide-mark.svg`; the plated app-icon
source is `icon.svg` here. Do not redraw or recolor the mark.

Generated from `icon.svg`:

- `icon.ico` — Windows packaging / window icon (16–256 px).
- `icon.icns` — macOS packaging (16–1024 px PNG chunks).
- `icon.png` and `icons/16x16.png` … `icons/512x512.png` — Linux packaging.
- `apps/desktop/public/icon.png`, `favicon.svg`, `favicon-16.png`,
  `favicon-32.png` — renderer window icon and browser favicon.

The plated icon is a white rounded square with a hairline neutral border so the
dark mark stays visible on both light and dark taskbars. The titlebar uses the
unplated mark (`BrandMark.tsx`) with theme-aware `--brand-mark-ink` and
`--brand-mark-accent` tokens.
