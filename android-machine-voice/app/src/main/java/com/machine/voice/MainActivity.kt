package com.machine.voice

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.machine.voice.ai.VoiceAssistantCoordinator
import com.machine.voice.briefing.BriefingGenerator
import com.machine.voice.briefing.BriefingReport
import com.machine.voice.briefing.BriefingScheduler
import com.machine.voice.calls.CallerLookupResult
import com.machine.voice.calls.DeviceCallLogEntry
import com.machine.voice.calls.LocalCallerIdResolver
import com.machine.voice.data.backup.BackupAndWipeManager
import com.machine.voice.data.local.CallerTagEntity
import com.machine.voice.data.local.ContactRuleEntity
import com.machine.voice.data.local.MachineDatabase
import com.machine.voice.data.local.ReminderEntity
import com.machine.voice.data.prefs.AppLanguage
import com.machine.voice.data.prefs.SecurePrefs
import com.machine.voice.permissions.PermissionHelper
import com.machine.voice.reminders.ReminderScheduler
import com.machine.voice.service.CallAnnounceCoordinator
import com.machine.voice.service.MachineKeepAliveService
import com.machine.voice.service.VoiceOverlayService
import com.machine.voice.speech.SpeechQueueManager
import com.machine.voice.speech.VoiceRecognizerHelper
import com.machine.voice.ui.assistant.VoiceAssistantScreen
import com.machine.voice.ui.briefing.BriefingScreen
import com.machine.voice.ui.calls.CallsCallerIdScreen
import com.machine.voice.ui.home.HomeDashboardScreen
import com.machine.voice.ui.notifications.NotificationRulesScreen
import com.machine.voice.ui.notifications.NotificationsFeedScreen
import com.machine.voice.ui.onboarding.OnboardingScreen
import com.machine.voice.ui.permissions.PermissionChecklistContent
import com.machine.voice.ui.reminders.RemindersScreen
import com.machine.voice.ui.settings.SettingsScreen
import com.machine.voice.ui.stringsFor
import com.machine.voice.ui.theme.ChampagneGold
import com.machine.voice.ui.theme.GoldBorder
import com.machine.voice.ui.theme.MachineVoiceTheme
import com.machine.voice.ui.theme.MetallicGold
import com.machine.voice.ui.theme.MutedIvory
import com.machine.voice.ui.theme.ObsidianBlack
import com.machine.voice.ui.theme.ObsidianElevated
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private lateinit var securePrefs: SecurePrefs
    private lateinit var database: MachineDatabase
    private lateinit var speechQueue: SpeechQueueManager
    private lateinit var voiceCoordinator: VoiceAssistantCoordinator
    private lateinit var voiceRecognizer: VoiceRecognizerHelper
    private val voiceTriggerNonce = MutableStateFlow(0L)
    private val openRouteRequest = MutableStateFlow<Pair<String, Long>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        securePrefs = SecurePrefs(applicationContext)
        database = MachineDatabase.getInstance(applicationContext)
        speechQueue = SpeechQueueManager.getInstance(applicationContext)
        voiceCoordinator = VoiceAssistantCoordinator.getInstance(applicationContext)
        voiceRecognizer = VoiceRecognizerHelper(applicationContext)

        val currentSettings = securePrefs.settings.value
        if (currentSettings.onboardingCompleted && currentSettings.keepAliveEnabled) {
            MachineKeepAliveService.start(applicationContext)
        }
        if (currentSettings.onboardingCompleted &&
            (currentSettings.floatingMicEnabled || currentSettings.wakeWordEnabled)
        ) {
            VoiceOverlayService.syncVoiceControls(applicationContext, currentSettings)
        }
        if (currentSettings.onboardingCompleted && currentSettings.morningBriefingEnabled) {
            BriefingScheduler.scheduleNextDailyBriefing(applicationContext)
        }

        handleDeepLinkIntent(intent)

        setContent {
            MachineVoiceTheme {
                MachineVoiceRoot(
                    securePrefs = securePrefs,
                    database = database,
                    speechQueue = speechQueue,
                    voiceCoordinator = voiceCoordinator,
                    voiceRecognizer = voiceRecognizer,
                    voiceTriggerNonceFlow = voiceTriggerNonce,
                    openRouteFlow = openRouteRequest
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLinkIntent(intent)
    }

    override fun onDestroy() {
        voiceRecognizer.destroy()
        super.onDestroy()
    }

    private fun handleDeepLinkIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.action == ACTION_TRIGGER_VOICE || intent.getBooleanExtra(EXTRA_TRIGGER_VOICE, false)) {
            voiceTriggerNonce.value = System.currentTimeMillis()
        }
        val route = intent.getStringExtra(EXTRA_OPEN_ROUTE)
        if (!route.isNullOrBlank()) {
            openRouteRequest.value = route to System.currentTimeMillis()
        }
    }

    companion object {
        const val ACTION_TRIGGER_VOICE = "com.machine.voice.ACTION_TRIGGER_VOICE"
        const val EXTRA_TRIGGER_VOICE = "extra_trigger_voice"
        const val ACTION_OPEN_ROUTE = "com.machine.voice.ACTION_OPEN_ROUTE"
        const val EXTRA_OPEN_ROUTE = "extra_open_route"
    }
}

@Composable
private fun MachineVoiceRoot(
    securePrefs: SecurePrefs,
    database: MachineDatabase,
    speechQueue: SpeechQueueManager,
    voiceCoordinator: VoiceAssistantCoordinator,
    voiceRecognizer: VoiceRecognizerHelper,
    voiceTriggerNonceFlow: MutableStateFlow<Long>,
    openRouteFlow: MutableStateFlow<Pair<String, Long>?>
) {
    val context = LocalContext.current
    val navController = rememberNavController()
    val scope = rememberCoroutineScope()

    val settings by securePrefs.settings.collectAsStateWithLifecycle()
    val keepAliveRunning by MachineKeepAliveService.isRunning.collectAsStateWithLifecycle()
    val isSpeaking by speechQueue.isSpeaking.collectAsStateWithLifecycle()
    val queueSize by speechQueue.queueSize.collectAsStateWithLifecycle()
    val voiceTurns by voiceCoordinator.turns.collectAsStateWithLifecycle()
    val pendingVoiceAction by voiceCoordinator.pendingAction.collectAsStateWithLifecycle()
    val isVoiceThinking by voiceCoordinator.isThinking.collectAsStateWithLifecycle()
    val isListening by voiceRecognizer.isListening.collectAsStateWithLifecycle()
    val partialTranscript by voiceRecognizer.partialText.collectAsStateWithLifecycle()
    val speechError by voiceRecognizer.lastError.collectAsStateWithLifecycle()
    val voiceTriggerNonce by voiceTriggerNonceFlow.collectAsStateWithLifecycle()
    val openRouteReq by openRouteFlow.collectAsStateWithLifecycle()

    val notifications by database.notificationLogDao().observeRecent(100)
        .collectAsStateWithLifecycle(initialValue = emptyList())
    val appRules by database.appRuleDao().observeAll()
        .collectAsStateWithLifecycle(initialValue = emptyList())
    val contactRules by database.contactRuleDao().observeAll()
        .collectAsStateWithLifecycle(initialValue = emptyList())
    val savedCallerTags by database.callerTagDao().observeAll()
        .collectAsStateWithLifecycle(initialValue = emptyList())
    val reminders by database.reminderDao().observeAll()
        .collectAsStateWithLifecycle(initialValue = emptyList())

    var permissionSnapshot by remember { mutableStateOf(PermissionHelper.inspect(context)) }
    var recentCalls by remember { mutableStateOf<List<DeviceCallLogEntry>>(emptyList()) }
    val strings = remember(settings.language) { stringsFor(settings.language) }

    val refreshCallLog: () -> Unit = {
        scope.launch {
            val tagMap = savedCallerTags.associateBy { it.normalizedNumber }
            val loaded = withContext(Dispatchers.IO) {
                LocalCallerIdResolver.fetchRecentCallLog(
                    context = context,
                    callerTagDao = database.callerTagDao(),
                    tagsByNormalized = tagMap
                )
            }
            recentCalls = loaded
        }
    }

    LaunchedEffect(Unit) {
        database.ensureDefaultAppRulesSeeded()
        BackupAndWipeManager.enforceRetentionNow(context)
    }

    LaunchedEffect(voiceTriggerNonce) {
        if (voiceTriggerNonce > 0L && settings.onboardingCompleted) {
            navController.navigate("voice") {
                popUpTo("home") { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
            if (voiceRecognizer.hasAudioPermission()) {
                voiceRecognizer.startListening(settings.voiceInputLocale.tag) { spoken ->
                    voiceCoordinator.submitInput(spoken, speakReply = true)
                }
            }
        }
    }

    LaunchedEffect(openRouteReq) {
        val target = openRouteReq?.first
        if (!target.isNullOrBlank() && settings.onboardingCompleted) {
            navController.navigate(target) {
                launchSingleTop = true
            }
        }
    }

    LaunchedEffect(permissionSnapshot.callLog, savedCallerTags) {
        if (permissionSnapshot.callLog) {
            val tagMap = savedCallerTags.associateBy { it.normalizedNumber }
            recentCalls = withContext(Dispatchers.IO) {
                LocalCallerIdResolver.fetchRecentCallLog(
                    context = context,
                    callerTagDao = database.callerTagDao(),
                    tagsByNormalized = tagMap
                )
            }
        } else {
            recentCalls = emptyList()
        }
    }

    val refreshPermissions: () -> Unit = {
        permissionSnapshot = PermissionHelper.inspect(context)
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        refreshPermissions()
    }

    val runtimeLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) {
        refreshPermissions()
    }

    val callScreeningLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) {
        refreshPermissions()
    }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showBottomBar = currentRoute != null && currentRoute != "onboarding"

    val startDestination = if (settings.onboardingCompleted) "home" else "onboarding"

    Scaffold(
        containerColor = ObsidianBlack,
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(containerColor = ObsidianElevated) {
                    val items = listOf(
                        Triple("home", "Home", Icons.Default.Home),
                        Triple("voice", "Voice", Icons.Default.Mic),
                        Triple("inbox", "Inbox", Icons.Default.Notifications),
                        Triple("calls", "Calls", Icons.Default.Call),
                        Triple("rules", "Rules", Icons.Default.Tune)
                    )
                    items.forEach { (route, label, icon) ->
                        val selected = currentRoute == route
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(route) {
                                    popUpTo("home") { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(imageVector = icon, contentDescription = label) },
                            label = { Text(label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = ObsidianBlack,
                                selectedTextColor = ChampagneGold,
                                indicatorColor = MetallicGold,
                                unselectedIconColor = MutedIvory,
                                unselectedTextColor = MutedIvory
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            NavHost(
                navController = navController,
                startDestination = startDestination
            ) {
                composable("onboarding") {
                    OnboardingScreen(
                        settings = settings,
                        permissionSnapshot = permissionSnapshot,
                        strings = strings,
                        onSelectLanguage = { securePrefs.setLanguage(it) },
                        onToggleAiEnabled = { securePrefs.setAiEnabled(it) },
                        onRequestRuntimePermissions = {
                            runtimeLauncher.launch(PermissionHelper.runtimePermissionsToRequest())
                        },
                        onOpenNotificationListener = {
                            PermissionHelper.openNotificationListenerSettings(context)
                        },
                        onOpenOverlaySettings = {
                            PermissionHelper.openOverlaySettings(context)
                        },
                        onOpenBatterySettings = {
                            PermissionHelper.openBatteryOptimizationSettings(context)
                        },
                        onOpenSamsungAppInfo = {
                            PermissionHelper.openAppDetailsSettings(context)
                        },
                        onOpenExactAlarmSettings = {
                            PermissionHelper.openExactAlarmSettings(context)
                        },
                        onRequestCallScreeningRole = {
                            val intent = PermissionHelper.buildCallScreeningRoleIntent(context)
                            if (intent != null) {
                                callScreeningLauncher.launch(intent)
                            } else {
                                PermissionHelper.openAppDetailsSettings(context)
                            }
                        },
                        onCompleteOnboarding = {
                            securePrefs.setOnboardingCompleted(true)
                            if (settings.keepAliveEnabled) {
                                MachineKeepAliveService.start(context)
                            }
                            if (settings.morningBriefingEnabled) {
                                BriefingScheduler.scheduleNextDailyBriefing(context)
                            }
                            navController.navigate("home") {
                                popUpTo("onboarding") { inclusive = true }
                            }
                        }
                    )
                }

                composable("home") {
                    val now = System.currentTimeMillis()
                    val activeReminders = reminders.filter { !it.completed }
                    val overdueCount = activeReminders.count { it.triggerAtMillis <= now }
                    HomeDashboardScreen(
                        settings = settings,
                        permissionSnapshot = permissionSnapshot,
                        keepAliveRunning = keepAliveRunning,
                        recentNotificationCount = notifications.size,
                        activeReminderCount = activeReminders.size,
                        overdueReminderCount = overdueCount,
                        isSpeaking = isSpeaking,
                        strings = strings,
                        onToggleKeepAlive = {
                            if (keepAliveRunning) {
                                securePrefs.setKeepAliveEnabled(false)
                                MachineKeepAliveService.stop(context)
                            } else {
                                securePrefs.setKeepAliveEnabled(true)
                                MachineKeepAliveService.start(context)
                            }
                        },
                        onOpenVoice = {
                            navController.navigate("voice") {
                                popUpTo("home") { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        onOpenBriefing = { navController.navigate("briefing") },
                        onPlayBriefing = {
                            scope.launch {
                                val report = BriefingGenerator.generate(context, allowCloudPolish = true)
                                speechQueue.enqueue(report.spokenScript, settings.language, pauseDuringCall = false)
                            }
                        },
                        onOpenReminders = { navController.navigate("reminders") },
                        onOpenNotifications = { navController.navigate("inbox") },
                        onOpenRules = { navController.navigate("rules") },
                        onOpenPermissions = { navController.navigate("permissions") },
                        onOpenSettings = { navController.navigate("settings") },
                        onStopSpeech = { speechQueue.stopAll() },
                        onToggleLanguage = {
                            val next = if (settings.language == AppLanguage.ENGLISH) {
                                AppLanguage.SWAHILI
                            } else {
                                AppLanguage.ENGLISH
                            }
                            securePrefs.setLanguage(next)
                        },
                        onReviewOnboarding = { navController.navigate("onboarding") }
                    )
                }

                composable("settings") {
                    SettingsScreen(
                        settings = settings,
                        permissionSnapshot = permissionSnapshot,
                        onSelectLanguage = { securePrefs.setLanguage(it) },
                        onSelectVoiceLocale = { locale ->
                            securePrefs.setVoiceInputLocale(locale)
                            VoiceOverlayService.syncVoiceControls(context, securePrefs.settings.value)
                        },
                        onUpdateVoiceTuning = { rate, pitch ->
                            securePrefs.setVoiceTuning(rate, pitch)
                        },
                        onTestVoice = {
                            val phrase = if (settings.language == AppLanguage.SWAHILI) {
                                "Hujambo. Mfumo wa sauti wa Machine Voice uko tayari."
                            } else {
                                "Machine Voice audio test. Settings saved locally and nominal."
                            }
                            speechQueue.enqueue(phrase, settings.language, pauseDuringCall = false)
                        },
                        onSelectRetention = { securePrefs.setRetentionWindow(it) },
                        onToggleAiEnabled = { securePrefs.setAiEnabled(it) },
                        onSaveGeminiKey = { securePrefs.setGeminiApiKey(it) },
                        onClearGeminiKey = { securePrefs.setGeminiApiKey("") },
                        onToggleFloatingMic = { enabled ->
                            securePrefs.setFloatingMicEnabled(enabled)
                            VoiceOverlayService.syncVoiceControls(context, securePrefs.settings.value)
                        },
                        onToggleWakeWord = { enabled ->
                            securePrefs.setWakeWordEnabled(enabled)
                            VoiceOverlayService.syncVoiceControls(context, securePrefs.settings.value)
                        },
                        onRequestMicPermission = {
                            runtimeLauncher.launch(PermissionHelper.runtimePermissionsToRequest())
                        },
                        onOpenOverlaySettings = {
                            PermissionHelper.openOverlaySettings(context)
                        },
                        onOpenPermissions = { navController.navigate("permissions") },
                        onOpenBriefing = { navController.navigate("briefing") },
                        onDataWiped = {
                            navController.navigate("onboarding") {
                                popUpTo(0) { inclusive = true }
                            }
                        },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("briefing") {
                    var briefingReport by remember { mutableStateOf<BriefingReport?>(null) }
                    var briefingLoading by remember { mutableStateOf(true) }

                    val loadBriefing: () -> Unit = {
                        scope.launch {
                            briefingLoading = true
                            briefingReport = BriefingGenerator.generate(context, allowCloudPolish = true)
                            briefingLoading = false
                        }
                    }

                    LaunchedEffect(Unit) {
                        loadBriefing()
                    }

                    BriefingScreen(
                        settings = settings,
                        report = briefingReport,
                        isLoading = briefingLoading,
                        isSpeaking = isSpeaking,
                        onRefresh = loadBriefing,
                        onPlayBriefing = { script ->
                            speechQueue.enqueue(script, settings.language, pauseDuringCall = false)
                        },
                        onStopSpeech = { speechQueue.stopAll() },
                        onToggleDailyNotification = { enabled ->
                            securePrefs.setMorningBriefingEnabled(enabled)
                            BriefingScheduler.scheduleNextDailyBriefing(context)
                        },
                        onSetBriefingTime = { newTime ->
                            securePrefs.setMorningBriefingTime(newTime)
                            BriefingScheduler.scheduleNextDailyBriefing(context)
                        },
                        onToggleSpeakOnUnlock = { enabled ->
                            securePrefs.setSpeakBriefingOnUnlock(enabled)
                        },
                        onOpenReminders = { navController.navigate("reminders") },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("reminders") {
                    RemindersScreen(
                        reminders = reminders,
                        permissionSnapshot = permissionSnapshot,
                        onCreateReminder = { title, notes, triggerAtMillis, isMeeting ->
                            scope.launch {
                                val entity = ReminderEntity(
                                    title = title,
                                    notes = notes,
                                    triggerAtMillis = triggerAtMillis,
                                    isMeeting = isMeeting
                                )
                                val rowId = withContext(Dispatchers.IO) {
                                    database.reminderDao().upsert(entity)
                                }
                                ReminderScheduler.scheduleReminder(context, entity.copy(id = rowId))
                            }
                        },
                        onToggleCompleted = { item ->
                            scope.launch {
                                val nextDone = !item.completed
                                withContext(Dispatchers.IO) {
                                    database.reminderDao().setCompleted(item.id, nextDone)
                                }
                                if (nextDone) {
                                    ReminderScheduler.cancelReminder(context, item.id)
                                } else {
                                    ReminderScheduler.scheduleReminder(
                                        context,
                                        item.copy(completed = false)
                                    )
                                }
                            }
                        },
                        onDeleteReminder = { item ->
                            scope.launch {
                                ReminderScheduler.cancelReminder(context, item.id)
                                withContext(Dispatchers.IO) {
                                    database.reminderDao().deleteById(item.id)
                                }
                            }
                        },
                        onAddToCalendar = { item ->
                            try {
                                context.startActivity(ReminderScheduler.buildCalendarInsertIntent(item))
                            } catch (_: Exception) {
                            }
                        },
                        onSpeakOverdue = { overdueList ->
                            val lang = settings.language
                            val spoken = if (lang == AppLanguage.SWAHILI) {
                                "Vikumbusho vilivyopita muda: ${overdueList.joinToString(". ") { it.title }}."
                            } else {
                                "Overdue reminders: ${overdueList.joinToString(". ") { it.title }}."
                            }
                            speechQueue.enqueue(spoken, lang, pauseDuringCall = false)
                        },
                        onOpenExactAlarmSettings = {
                            PermissionHelper.openExactAlarmSettings(context)
                        },
                        onBack = { navController.popBackStack() }
                    )
                }

                composable("voice") {
                    VoiceAssistantScreen(
                        settings = settings,
                        permissionSnapshot = permissionSnapshot,
                        turns = voiceTurns,
                        pendingAction = pendingVoiceAction,
                        isListening = isListening,
                        isThinking = isVoiceThinking,
                        isSpeaking = isSpeaking,
                        partialTranscript = partialTranscript,
                        speechError = speechError,
                        onStartListening = {
                            voiceRecognizer.startListening(settings.voiceInputLocale.tag) { spoken ->
                                voiceCoordinator.submitInput(spoken, speakReply = true)
                            }
                        },
                        onStopListening = { voiceRecognizer.stopListening() },
                        onSubmitText = { input ->
                            voiceCoordinator.submitInput(input, speakReply = true)
                        },
                        onConfirmPending = {
                            voiceCoordinator.confirmPendingAction(speakReply = true)
                        },
                        onCancelPending = {
                            voiceCoordinator.cancelPendingAction(speakReply = true)
                        },
                        onSpeakText = { text ->
                            voiceCoordinator.speakText(text)
                        },
                        onStopSpeaking = { speechQueue.stopAll() },
                        onClearTranscript = { voiceCoordinator.clearTranscript() },
                        onSelectVoiceLocale = { locale ->
                            securePrefs.setVoiceInputLocale(locale)
                            VoiceOverlayService.syncVoiceControls(context, securePrefs.settings.value)
                        },
                        onToggleAiEnabled = { securePrefs.setAiEnabled(it) },
                        onSaveGeminiKey = { securePrefs.setGeminiApiKey(it) },
                        onClearGeminiKey = { securePrefs.setGeminiApiKey("") },
                        onToggleFloatingMic = { enabled ->
                            securePrefs.setFloatingMicEnabled(enabled)
                            VoiceOverlayService.syncVoiceControls(context, securePrefs.settings.value)
                        },
                        onToggleWakeWord = { enabled ->
                            securePrefs.setWakeWordEnabled(enabled)
                            VoiceOverlayService.syncVoiceControls(context, securePrefs.settings.value)
                        },
                        onRequestMicPermission = {
                            runtimeLauncher.launch(PermissionHelper.runtimePermissionsToRequest())
                        },
                        onOpenOverlaySettings = {
                            PermissionHelper.openOverlaySettings(context)
                        }
                    )
                }

                composable("inbox") {
                    NotificationsFeedScreen(
                        notifications = notifications,
                        listenerGranted = permissionSnapshot.notificationListener,
                        isSpeaking = isSpeaking,
                        queueSize = queueSize,
                        settings = settings,
                        onOpenListenerSettings = {
                            PermissionHelper.openNotificationListenerSettings(context)
                        },
                        onReadFull = { item ->
                            val lang = if (item.languageCode == "sw") {
                                AppLanguage.SWAHILI
                            } else {
                                AppLanguage.ENGLISH
                            }
                            val textToSpeak = if (item.isSensitiveShielded) {
                                if (lang == AppLanguage.SWAHILI) {
                                    "Ujumbe wa namba ya siri umepokelewa kwenye ${item.appName}."
                                } else {
                                    "Verification code received on ${item.appName}."
                                }
                            } else {
                                if (lang == AppLanguage.SWAHILI) {
                                    "Ujumbe kamili kutoka kwa ${item.sender} kwenye ${item.appName}: ${item.fullText}"
                                } else {
                                    "Message from ${item.sender} on ${item.appName}: ${item.fullText}"
                                }
                            }
                            speechQueue.enqueue(textToSpeak, lang, pauseDuringCall = false)
                        },
                        onStopSpeech = { speechQueue.stopAll() },
                        onTestSpeech = {
                            val phrase = if (settings.language == AppLanguage.SWAHILI) {
                                "Hujambo. Mfumo wa sauti wa Machine Voice uko tayari kusoma ujumbe wako."
                            } else {
                                "Machine Voice audio test. Systems nominal and ready to read incoming messages."
                            }
                            speechQueue.enqueue(phrase, settings.language, pauseDuringCall = false)
                        },
                        onSetContactPriority = { sender, priority ->
                            scope.launch {
                                database.contactRuleDao().upsert(
                                    ContactRuleEntity(
                                        senderKey = sender.trim().lowercase(),
                                        displayName = sender.trim(),
                                        priority = priority.name
                                    )
                                )
                            }
                        },
                        onClearNotifications = {
                            scope.launch { database.notificationLogDao().deleteAll() }
                        }
                    )
                }

                composable("calls") {
                    CallsCallerIdScreen(
                        settings = settings,
                        permissionSnapshot = permissionSnapshot,
                        recentCalls = recentCalls,
                        savedTags = savedCallerTags,
                        onToggleCallAnnouncer = { securePrefs.setCallAnnouncerEnabled(it) },
                        onToggleCallerOverlay = { securePrefs.setCallerOverlayEnabled(it) },
                        onToggleSilenceSpam = { securePrefs.setSilenceMarkedSpamCalls(it) },
                        onToggleRejectSpam = { securePrefs.setRejectMarkedSpamCalls(it) },
                        onSaveCallerTag = { norm, display, label, isSpam ->
                            scope.launch {
                                database.callerTagDao().upsert(
                                    CallerTagEntity(
                                        normalizedNumber = norm,
                                        displayNumber = display,
                                        tagLabel = label,
                                        isSpam = isSpam,
                                        updatedAt = System.currentTimeMillis()
                                    )
                                )
                            }
                        },
                        onDeleteCallerTag = { norm ->
                            scope.launch { database.callerTagDao().deleteByNumber(norm) }
                        },
                        onRefreshCallLog = refreshCallLog,
                        onTestCallOverlay = {
                            val testLookup = CallerLookupResult(
                                rawNumber = "+254700000123",
                                normalizedNumber = "700000123",
                                displayNumber = "+254 700 000 123",
                                contactName = "Amina Delivery",
                                customTag = "Delivery guy",
                                isSpam = false,
                                previousCallCount = 2,
                                lastCallSummary = "2 prior calls · Last: Incoming today"
                            )
                            CallAnnounceCoordinator.handleIncomingResolved(context, testLookup)
                        },
                        onRequestCallScreeningRole = {
                            val intent = PermissionHelper.buildCallScreeningRoleIntent(context)
                            if (intent != null) {
                                callScreeningLauncher.launch(intent)
                            } else {
                                PermissionHelper.openAppDetailsSettings(context)
                            }
                        },
                        onOpenOverlaySettings = {
                            PermissionHelper.openOverlaySettings(context)
                        },
                        onRequestPhonePermissions = {
                            runtimeLauncher.launch(PermissionHelper.runtimePermissionsToRequest())
                        }
                    )
                }

                composable("rules") {
                    NotificationRulesScreen(
                        settings = settings,
                        appRules = appRules,
                        contactRules = contactRules,
                        onToggleReaderEnabled = { securePrefs.setNotificationReaderEnabled(it) },
                        onToggleHeadphoneOnly = { securePrefs.setHeadphoneOnlyMode(it) },
                        onToggleIgnoreGroups = { securePrefs.setIgnoreGroups(it) },
                        onToggleIgnoreMuted = { securePrefs.setIgnoreMuted(it) },
                        onToggleQuietHours = { enabled ->
                            securePrefs.setQuietHours(
                                enabled = enabled,
                                start = settings.quietHoursStart,
                                end = settings.quietHoursEnd
                            )
                        },
                        onUpdateVoiceTuning = { rate, pitch ->
                            securePrefs.setVoiceTuning(rate, pitch)
                        },
                        onToggleAppRule = { pkg, enabled ->
                            scope.launch { database.appRuleDao().setEnabled(pkg, enabled) }
                        },
                        onUpsertContactRule = { name, priority ->
                            scope.launch {
                                database.contactRuleDao().upsert(
                                    ContactRuleEntity(
                                        senderKey = name.lowercase(),
                                        displayName = name,
                                        priority = priority.name
                                    )
                                )
                            }
                        },
                        onDeleteContactRule = { key ->
                            scope.launch { database.contactRuleDao().deleteByKey(key) }
                        }
                    )
                }

                composable("permissions") {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(ObsidianBlack)
                            .padding(horizontal = 20.dp, vertical = 14.dp)
                    ) {
                        Row(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = strings.permissionsHeadline,
                                style = MaterialTheme.typography.headlineSmall,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedButton(
                                onClick = { navController.popBackStack() },
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = MetallicGold)
                            ) {
                                Text(text = strings.backAction, color = MetallicGold)
                            }
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        HorizontalDivider(color = GoldBorder)
                        Spacer(modifier = Modifier.height(14.dp))
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .verticalScroll(rememberScrollState())
                        ) {
                            PermissionChecklistContent(
                                snapshot = permissionSnapshot,
                                strings = strings,
                                onRequestRuntimePermissions = {
                                    runtimeLauncher.launch(PermissionHelper.runtimePermissionsToRequest())
                                },
                                onOpenNotificationListener = {
                                    PermissionHelper.openNotificationListenerSettings(context)
                                },
                                onOpenOverlaySettings = {
                                    PermissionHelper.openOverlaySettings(context)
                                },
                                onOpenBatterySettings = {
                                    PermissionHelper.openBatteryOptimizationSettings(context)
                                },
                                onOpenSamsungAppInfo = {
                                    PermissionHelper.openAppDetailsSettings(context)
                                },
                                onOpenExactAlarmSettings = {
                                    PermissionHelper.openExactAlarmSettings(context)
                                },
                                onRequestCallScreeningRole = {
                                    val intent = PermissionHelper.buildCallScreeningRoleIntent(context)
                                    if (intent != null) {
                                        callScreeningLauncher.launch(intent)
                                    } else {
                                        PermissionHelper.openAppDetailsSettings(context)
                                    }
                                }
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        Button(
                            onClick = refreshPermissions,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MetallicGold,
                                contentColor = ObsidianBlack
                            ),
                            modifier = Modifier.fillMaxWidth().height(48.dp)
                        ) {
                            Text(text = "REFRESH STATUS", style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
        }
    }
}
