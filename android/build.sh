#!/usr/bin/env bash
# Builds silbo.apk (offline WebView shell around dist/) with plain Android SDK tools: no Gradle, no network.
# Needs ANDROID_HOME with platforms;android-34 and build-tools;34.0.0, a JDK, and `node tools/build-app.ts` done.
# Debug-signed with android/debug.keystore (generated on first run); for Play, sign with your own key.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(dirname "$here")
SDK=${ANDROID_HOME:-/opt/android-sdk}; BT=$SDK/build-tools/34.0.0; JAR=$SDK/platforms/android-34/android.jar
out=$here/build; rm -rf "$out"; mkdir -p "$out/gen" "$out/classes" "$out/apk/assets/www"
[ -d "$root/dist" ] || node "$root/tools/build-app.ts"
cp "$root"/dist/* "$out/apk/assets/www/"
# launcher icon from the PWA icon
mkdir -p "$out/res/mipmap-xxxhdpi" "$out/res/values"; cp "$root/app/icon-192.png" "$out/res/mipmap-xxxhdpi/ic_launcher.png"
"$BT/aapt2" compile --dir "$out/res" -o "$out/res.zip"
"$BT/aapt2" link -o "$out/base.apk" -I "$JAR" --manifest "$here/AndroidManifest.xml" --java "$out/gen" \
  --min-sdk-version 26 --target-sdk-version 34 "$out/res.zip"
javac -nowarn --release 8 -cp "$JAR" -d "$out/classes" $(find "$here/src" "$out/gen" -name '*.java')
"$BT/d8" --release --lib "$JAR" --min-api 26 --output "$out" $(find "$out/classes" -name '*.class')
cd "$out/apk" && cp "$out/base.apk" ../unsigned.apk && cp "$out/classes.dex" . && zip -q -r ../unsigned.apk classes.dex assets
cd "$out"; "$BT/zipalign" -f -p 4 unsigned.apk aligned.apk
ks=$here/debug.keystore
[ -f "$ks" ] || keytool -genkeypair -keystore "$ks" -storepass android -keypass android -alias silbo -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Silbo" 2>/dev/null
"$BT/apksigner" sign --ks "$ks" --ks-pass pass:android --key-pass pass:android --out "$root/silbo.apk" aligned.apk
"$BT/apksigner" verify --verbose "$root/silbo.apk" | head -3
ls -la "$root/silbo.apk"
