# XPPAUT Android app

The website (`dist/`) in a WebView, bundled so it works offline, plus phone
features a browser lacks: "Open with XPPAUT" for `.ode` files, saving to
`Downloads/XPPAUT` (Share for session `.zip` files), Back = Esc, and the screen
kept on while XPP computes. The page side is `src/android.ts`.

Needs JDK 17+ and the Android SDK (`local.properties`: `sdk.dir=...`).

```bash
npm run build:wasm && npm run build     # the website, into dist/
cd android
./gradlew assembleDebug                 # app/build/outputs/apk/debug/
./gradlew assembleRelease               # signed: needs keystore.properties
```

`keystore.properties` (not in git) names the signing key:

```
storeFile=/path/to/xppaut-release.jks
storePassword=...
keyAlias=xppaut
keyPassword=...
```

Keep the key and its password safe and backed up: every update must be signed
with the same key, or phones refuse to install it. Raise `versionCode` (and
`versionName`) in `app/build.gradle.kts` for each release.
