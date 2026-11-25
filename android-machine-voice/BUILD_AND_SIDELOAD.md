# MACHINE VOICE — Build & Sideload Guide (Samsung Galaxy A06)

Because this AI Studio workspace runs a web Node.js runtime without a local Android SDK or JDK, compile the APK on your computer using Android Studio (recommended) or Android command-line tools.

## Option A: Build Debug APK in Android Studio
1. Copy the `android-machine-voice/` folder to your computer.
2. Open **Android Studio** -> **Open** -> select `android-machine-voice`.
3. Android Studio will automatically sync Gradle and generate the Gradle Wrapper.
4. Choose **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
5. Locate the generated file at:
   `app/build/outputs/apk/debug/app-debug.apk`

## Option B: Build from Command Line (with Android SDK & JDK 17 installed)
```bash
cd android-machine-voice
gradle wrapper --gradle-version 8.9
./gradlew assembleDebug
```

## Install on Samsung Galaxy A06 (Sideloading)

### Method 1: USB Cable via ADB (Fastest)
1. On your Galaxy A06: **Settings → About phone → Software information → tap Build number 7 times** to enable Developer Options.
2. Open **Developer options → enable USB debugging**.
3. Connect the phone via USB and run:
   ```bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

### Method 2: APK Transfer (No PC Terminal Needed)
1. Copy `app-debug.apk` to your Galaxy A06 **Downloads** folder.
2. Tap `app-debug.apk` in **My Files**.
3. When prompted, allow **Install unknown apps** for My Files, then tap **Install**.

## First-Run Samsung One UI Setup
1. Complete the **Privacy & AI Disclosure** onboarding screen.
2. Grant runtime permissions (Phone, Contacts, Call Log, Microphone, Notifications).
3. Enable **Machine Voice Reader** under **Notification access**.
4. Tap **Open App Info** → **Battery** → select **Unrestricted**.
5. In **Settings → Battery → Background usage limits → Sleeping apps**, confirm **Machine Voice** is not listed.
