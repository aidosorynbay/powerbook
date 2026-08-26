# PowerBook — native app shell

Capacitor wrapper around the existing web frontend. There is no second
codebase: the app loads the same build that `frontend/` produces, so a
feature written once appears on the website and in both apps.

## Toolchain

Everything is installed under the developer's home directory, not system-wide:

- Node — `~/dev-tools/node-v22.11.0-darwin-arm64/bin`
- JDK 21 — `~/dev-tools/jdk-21.0.12.1+1/Contents/Home`
- Android SDK — `~/Library/Android/sdk`
- Xcode — `/Applications/Xcode.app` (iOS only; there is no way to build iOS elsewhere)

`xcode-select` still points at the Command Line Tools, so iOS commands need
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` rather than a
sudo'd switch.

## Rebuilding after a frontend change

    # on the server: build the web app first
    cd /opt/powerbook/frontend && npm run build

    # locally: refresh dist/, then sync
    npx cap sync

## Android

    export JAVA_HOME=~/dev-tools/jdk-21.0.12.1+1/Contents/Home
    export ANDROID_HOME=~/Library/Android/sdk
    cd android && ./gradlew assembleDebug

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

The debug APK is signed with a throwaway key — fine for testing, not for
Google Play. A release build needs a keystore that must be kept safe: lose it
and the app can never be updated under the same listing.

## iOS

Open `ios/App/App.xcworkspace` (the workspace, not the project — Pods live in
the workspace). Signing needs a paid Apple Developer account; select the team
under Signing & Capabilities, then Product → Archive.
