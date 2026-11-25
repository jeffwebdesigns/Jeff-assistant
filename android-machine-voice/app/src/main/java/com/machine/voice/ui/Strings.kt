package com.machine.voice.ui

import com.machine.voice.data.prefs.AppLanguage

data class MachineStrings(
    val appTitle: String,
    val subtitle: String,
    val privacyHeadline: String,
    val privacyBody: String,
    val aiDisclosureTitle: String,
    val aiDisclosureBody: String,
    val onDeviceOnlyToggle: String,
    val geminiOptInToggle: String,
    val continueAction: String,
    val backAction: String,
    val finishSetupAction: String,
    val permissionsHeadline: String,
    val permissionsSubtitle: String,
    val grantedBadge: String,
    val missingBadge: String,
    val optionalBadge: String,
    val grantButton: String,
    val openSettingsButton: String,
    val samsungGuideTitle: String,
    val samsungGuideSteps: String,
    val dashboardStatusActive: String,
    val dashboardStatusNeedsPerms: String,
    val openPermissionChecklist: String,
    val startKeepAlive: String,
    val stopKeepAlive: String,
    val step1ReadyBanner: String
)

fun stringsFor(language: AppLanguage): MachineStrings = when (language) {
    AppLanguage.ENGLISH -> MachineStrings(
        appTitle = "MACHINE VOICE",
        subtitle = "PRIVATE OWNER ASSISTANT",
        privacyHeadline = "ONE OWNER. DEVICE-FIRST.",
        privacyBody = "Notifications, call history, contacts, and reminders stay strictly on this phone. " +
            "There is no analytics, no ad SDK, no hidden call recording, and no background cloud sync.",
        aiDisclosureTitle = "AI SUMMARIZATION DISCLOSURE",
        aiDisclosureBody = "You can run 100% offline on-device. If you enable Gemini voice understanding " +
            "and paste your own free-tier API key in Settings, only the command or message snippet you " +
            "ask to analyze is sent to Google Gemini. One-time passwords and PINs are automatically shielded.",
        onDeviceOnlyToggle = "Stay 100% On-Device (No AI cloud calls)",
        geminiOptInToggle = "Allow Gemini API when I enter my key",
        continueAction = "CONTINUE",
        backAction = "BACK",
        finishSetupAction = "ENTER MACHINE VOICE",
        permissionsHeadline = "SYSTEM PERMISSIONS",
        permissionsSubtitle = "Grant each permission so Machine Voice can read alerts, announce callers, and stay alive on Samsung One UI.",
        grantedBadge = "GRANTED",
        missingBadge = "REQUIRED",
        optionalBadge = "RECOMMENDED",
        grantButton = "GRANT",
        openSettingsButton = "OPEN SETTINGS",
        samsungGuideTitle = "SAMSUNG GALAXY A06 RELIABILITY",
        samsungGuideSteps = "1. Set Battery to 'Unrestricted' in App Info.\n" +
            "2. Open Settings → Battery → Background usage limits → Sleeping apps, and ensure Machine Voice is NOT sleeping.\n" +
            "3. Keep the minimal status notification enabled.",
        dashboardStatusActive = "SYSTEM READY · LOCAL SHIELD ACTIVE",
        dashboardStatusNeedsPerms = "ACTION NEEDED · MISSING PERMISSIONS",
        openPermissionChecklist = "PERMISSION CHECKLIST",
        startKeepAlive = "START BACKGROUND SHIELD",
        stopKeepAlive = "PAUSE BACKGROUND SHIELD",
        step1ReadyBanner = "Foundation, Black & Gold theme, encrypted prefs, keep-alive foreground service, and permission links are active."
    )

    AppLanguage.SWAHILI -> MachineStrings(
        appTitle = "MACHINE VOICE",
        subtitle = "MSAIDIZI BINAFSI WA SAUTI",
        privacyHeadline = "MMILIKI MMOJA. KWENYE SIMU PEKEE.",
        privacyBody = "Arifa, historia ya simu, anwani, na vikumbusho hukaa kwenye simu hii pekee. " +
            "Hakuna takwimu za siri, hakuna kurekodi simu kisiri, na hakuna upakiaji wa wingu.",
        aiDisclosureTitle = "TAARIFA YA MATUMIZI YA AI",
        aiDisclosureBody = "Unaweza kutumia programu nje ya mtandao kwa 100%. Ukiwasha Gemini na kuweka " +
            "ufunguo wako wa API katika Mipangilio, ni maandishi unayouliza pekee yanayotumwa kwa Gemini. " +
            "Namba za siri (OTP/PIN) zinalindwa kiotomatiki.",
        onDeviceOnlyToggle = "Baki Nje ya Mtandao 100% (Bila Gemini)",
        geminiOptInToggle = "Ruhusu Gemini nitakapoweka ufunguo wangu",
        continueAction = "ENDELEA",
        backAction = "RUDI",
        finishSetupAction = "INGIA MACHINE VOICE",
        permissionsHeadline = "RUHUSA ZA MFUMO",
        permissionsSubtitle = "Toa ruhusa hizi ili Machine Voice isome arifa, itangaze wanaopiga simu, na isizimwe na Samsung.",
        grantedBadge = "IMERUHUSIWA",
        missingBadge = "INAHITAJIKA",
        optionalBadge = "INAPENDEKEZWA",
        grantButton = "RUHUSU",
        openSettingsButton = "FUNGUA MIPANGILIO",
        samsungGuideTitle = "UIMARA KWENYE SAMSUNG GALAXY A06",
        samsungGuideSteps = "1. Weka Betri kuwa 'Unrestricted' kwenye Maelezo ya Programu.\n" +
            "2. Nenda Settings → Battery → Background usage limits → Sleeping apps, hakikisha Machine Voice haipo.\n" +
            "3. Usizime arifa ndogo ya huduma.",
        dashboardStatusActive = "MFUMO TAYARI · ULINZI WA NDANI UNAFANYA KAZI",
        dashboardStatusNeedsPerms = "HATUA INAHITAJIKA · RUHUSA ZINAKOSEKANA",
        openPermissionChecklist = "ORODHA YA RUHUSA",
        startKeepAlive = "WASHA ULINZI WA NYUMA",
        stopKeepAlive = "SIMAMISHA ULINZI",
        step1ReadyBanner = "Msingi wa mradi, mandhari ya Dhahabu na Nyeusi, hifadhi iliyosimbwa, huduma ya kudumu, na ruhusa ziko tayari."
    )
}
