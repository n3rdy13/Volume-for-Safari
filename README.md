# Volume Boost for Safari (iPhone)

A Safari extension that makes quiet web audio/video louder. On iPhone, Safari plays web audio at a fixed level and websites get no loudness settings, so streams often come out quieter than Apple Music. This routes the page's audio through a gain stage with an optional loudness leveler and a soft clipper so it gets loud without harsh digital clipping.

It only affects audio played in Safari. It can't boost other apps, and it can't raise the phone's system volume.

## Build and install

1. In this repo, open **Actions → Build unsigned IPA → Run workflow**. (It also runs on every push to `main`.) You can change the bundle ID when you start it; the extension's ID becomes `<bundle id>.Extension`. If you sign with a provisioning profile that has explicit app IDs, make these match.
2. When the run finishes, download **VolumeBoost-unsigned-ipa** from the run's Artifacts and unzip it to get `VolumeBoost-unsigned.ipa`.
3. Sign and install it with your developer certificate, the same way you do your other apps. Make sure your signing tool also signs the app extension inside it (the `.appex` in `PlugIns`).
4. On the iPhone: **Settings → Apps → Safari → Extensions → Volume Boost**. Turn it **On** and set **All Websites** to **Allow**.

## Use

1. In Safari, open the page you want to play, then tap **aA** in the address bar → **Volume Boost**.
2. Turn **Boost** on and pick a level. Start at 2×, go up if it's still too quiet.
3. **Tap the page once** (play/pause is fine). iOS only lets audio processing start from a tap on the page itself. The popup tells you when this is needed.
4. Keep the phone volume at maximum.

"Even out loudness" squeezes the difference between quiet and loud parts, which makes music sound louder in a noisy vehicle. Turn it off if it sounds pumpy or flat.

## Limits

- **Some sites can't be boosted.** If a site plays audio from another domain (some live streams, HLS) without the headers Web Audio requires, Safari would mute it if boosted. The extension skips those players and the popup says so.
- **Players created in code and never added to the page** (`new Audio()`) can't be seen by a Safari extension.
- **Screen lock:** iOS may pause boosted web audio when the screen locks or Safari goes to the background. The extension keeps trying to resume it, but whether that works depends on the iOS version. Test with the screen on first.
- Very high levels distort. That's the soft clipper doing its job; lower the level if it gets harsh.

## How it's built

`extension/` is a standard Safari Web Extension (Manifest V3). The GitHub Action uses Apple's `safari-web-extension-converter` on a macOS runner to wrap it in an iOS app project, then builds an unsigned IPA. There is no hand-written Xcode project to maintain.
