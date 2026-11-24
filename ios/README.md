# Aurum for iOS

A native iOS app that runs the Aurum web app offline from inside the app bundle.

## Run it

1. Open `ios/Aurum.xcodeproj` in Xcode (16 or later).
2. Select the **Aurum** target, open **Signing & Capabilities**, and pick your Team.
   If Xcode says the bundle ID is taken, change `com.hollywoodveal.aurum` to something unique.
3. Choose an iPhone simulator or your connected iPhone and press **Run** (⌘R).

Each build runs `bun run build` and bundles `dist/client`, so install [bun](https://bun.sh) first. To skip the rebuild, set `AURUM_SKIP_WEB_BUILD=1` in the scheme's environment variables.

## How it works

- The web app is copied into the app's `Web` folder at build time (`copy-web.sh`).
- It's served from `aurum://localhost/`, so IndexedDB, localStorage,
  ES modules and Web Crypto work like they do on the web. Data stays on the device.
- The site's `_headers` (Content-Security-Policy etc.) are applied to every response.
- `alert`, `confirm` and `prompt` show native dialogs.
- Downloads (exports, backups) open the share sheet, which includes Save to Files.
- Outside links open in Safari.
- No service worker is needed: everything is already offline in the bundle.

## Things to know

- **Your data does not carry over.** The app has its own storage, separate from
  the Safari/Home Screen version. Export a backup from the web app and import it here.
- **Don't change the `aurum` scheme** in `AppConfig.swift` after release,
  or existing users start with an empty app.
- **App Store review.** Apple rejects apps that are "just a website." Aurum runs
  fully offline with no website loaded, which helps, but expect review to look closely.
- **Debugging.** In Debug builds, open Safari on your Mac, then Develop > your
  device or simulator > Aurum to get the web inspector.
