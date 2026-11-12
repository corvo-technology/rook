# @corvo/ui-web

Shared React UI for web and Electron: shadcn/ui on Base UI plus the building blocks below. Colors,
shadows, motion and title type come from `@corvo/ui-tokens`.

## App without modals

Use these instead of `Dialog` / `AlertDialog`. All labels are props (already translated); the package
has no i18n and no router.

### `SidePanel`

A right-hand, non-modal layer for create/edit flows and viewers. No scrim, no focus trap; Esc closes
it from inside the panel (or with nothing focused), and focus returns to what opened it. Full-width
with a back arrow below `sm`. Renders nothing while `open` is false.

```tsx
<SidePanel open onClose={close} title={t`New routine`} closeLabel={t`Close`} footer={<Button>…</Button>} wide>
  <Input data-autofocus … /> {/* data-autofocus gets focus on open */}
</SidePanel>
```

Props: `open`, `onClose`, `title`, `closeLabel`, `footer?`, `wide?`, `className?`, `data-testid?`
(default `side-panel-layer`).

URL state lives in the app: `apps/web/src/lib/side-panel.ts`.

```ts
const { panel, isOpen, open, close, parsed } = useSidePanel(); // ?panel=
open("new-routine"); open(sidePanelValue("bot", id)); // ?panel=bot:<id>
parseSidePanel("bot:abc"); // { kind: "bot", id: "abc" }
```

One `?panel=` value exists, so opening another panel replaces the current one. `open` pushes history,
`close` replaces.

### `SettingsLayout`

Left nav and one section on the right; no routing inside. The app maps it to `/settings/:section`
(`apps/web/src/pages/Settings.tsx`: add a section to its `sections` array). Props: `title`, `onBack`,
`sections` (`{ id, label, icon? }`), `activeId`, `onSelect`, `heading?`, `width?` (`prose` | `full`).
Esc calls `onBack` (not while typing or with a menu open).

Entry points use `useOpenSettings()(section)` from `apps/web/src/lib/settings-route.ts`, which
remembers where the person was; the page uses `useSettingsNavigation()` (`select`, `back`).
`settingsPath("approvals")` is `/settings/approvals`.

### `InlineConfirm`

For actions that cannot be undone. A `Button` (all button props) that becomes `confirmLabel`
("Confirm delete?") on the first click and runs `onConfirm` on the second. Disarms after `timeoutMs`
(4000), on Esc and on blur; announced through a polite live region. `data-armed` is set while armed.

### `undoable` / `undoableDeferred`

Use the app's existing toast (`Toaster`, sonner).

```ts
await undoable({ message: t`Rule removed`, undoLabel: t`Undo`, run: remove, undo: restore });
await undoableDeferred({ message, undoLabel, commit, onUndo }); // hide now, commit after the toast
```

Prefer `undoable` when the backend can reverse the action. `undoableDeferred` resolves `"undone"` or
`"committed"`; leaving the page before the toast expires drops the commit.

### `EmptyState`

A chess piece (`piece`, default `pawn`) and one line (`title`); `action?` only when there is
something to do.

## Tokens

Defined in `packages/ui-tokens/src/index.ts`, generated into `tokens.css`
(`pnpm --filter @corvo/ui-tokens generate`).

| Token | Use |
| --- | --- |
| `--elevation-raised`, `--elevation-overlay` (`shadow-raised`, `shadow-overlay`) | Layered soft shadows for cards/popovers and panels, per theme |
| `--motion-fast` 120ms, `--motion-panel` 200ms, `--motion-ease-out` (`ease-out-soft`) | Transitions; `animate-panel-in` slides a layer in and is off under reduced motion |
| `--title-weight`, `--title-tracking`, `--title-line-height` (`text-title`) | Page titles: Inter Tight, light, tight tracking |

Fonts: Inter (text), Inter Tight (titles), IBM Plex Mono (`font-mono`: numbers, times, keys), all
bundled from `apps/web/public/fonts`.
