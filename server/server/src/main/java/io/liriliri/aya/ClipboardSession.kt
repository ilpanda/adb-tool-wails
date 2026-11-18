package io.liriliri.aya

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import org.json.JSONObject
import java.io.FileDescriptor
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.Timer
import java.util.ArrayDeque
import kotlin.concurrent.thread
import kotlin.concurrent.schedule
import kotlin.system.exitProcess

// One adb shell owns both FDs. There is no listening socket or persistent service.
object ClipboardSession {
    private const val MAX_BYTES = 64 * 1024
    private const val DESKTOP_CLIP = "io.liriliri.aya.desktop_clip"
    private const val SHELL = "com.android.shell"

    @SuppressLint("PrivateApi")
    private fun shellContext(): Context {
        Looper.prepareMainLooper()
        val type = Class.forName("android.app.ActivityThread")
        val thread = type.getMethod("systemMain").invoke(null)
        val system = type.getMethod("getSystemContext").invoke(thread) as Context
        val shell = system.createPackageContext(SHELL, 0)
        check(shell.applicationInfo.uid == Process.myUid())
        if (shell.opPackageName == SHELL) return shell

        // A derived package context can inherit "android" from the system context.
        // Let Android construct a fresh app context from the shell package's own LoadedApk.
        val impl = Class.forName("android.app.ContextImpl")
        val loaded = impl.getDeclaredField("mPackageInfo").apply { isAccessible = true }.get(shell)
        val create = impl.getDeclaredMethod("createAppContext", type, Class.forName("android.app.LoadedApk"))
        return create.apply { isAccessible = true }.invoke(null, thread, loaded) as Context
    }

    private fun status(value: String) = JSONObject().put("status", value)

    @JvmStatic
    fun main(args: Array<String>) {
        val timer = Timer(true)
        val startupDeadline = timer.schedule(30_000L) { exitProcess(124) }
        val input = FileInputStream(FileDescriptor.`in`)
        val output = FileOutputStream(FileDescriptor.out)
        fun reply(request: Wire.Request, result: JSONObject) {
            Wire.Response.newBuilder().setId(request.id).setResult(result.toString())
                .build().writeDelimitedTo(output)
            output.flush()
        }
        try {
            val hello = Wire.Request.parseDelimitedFrom(input) ?: return
            if (hello.method != "getVersion") return
            val info = status("identity_mismatch").put("version", BuildConfig.VERSION_NAME)
                .put("uid", Process.myUid()).put("pid", Process.myPid())
            if (Process.myUid() != 2000) {
                reply(hello, info)
                return
            }
            val context = try {
                shellContext()
            } catch (e: Exception) {
                reply(hello, info.put("status", "context_unavailable").put("cause", e.javaClass.simpleName))
                return
            }
            info.put("package", context.packageName).put("opPackage", context.opPackageName)
            if (context.opPackageName != SHELL || context.applicationInfo.uid != Process.myUid()) {
                reply(hello, info)
                return
            }
            val manager = try {
                context.getSystemService(ClipboardManager::class.java)
            } catch (e: Exception) {
                val kind = if (e is SecurityException) "permission_denied" else "manager_unavailable"
                reply(hello, info.put("status", kind).put("cause", e.javaClass.simpleName))
                return
            }
            if (manager == null) {
                reply(hello, info.put("status", "manager_unavailable"))
                return
            }
            reply(hello, info.put("status", "ok"))
            val request = Wire.Request.parseDelimitedFrom(input) ?: return
            if (request.method == "watchClipboard") {
                try {
                    watch(manager, input, request, ::reply, timer) { startupDeadline.cancel() }
                } catch (_: SecurityException) {
                    reply(request, status("permission_denied"))
                } catch (_: Exception) {
                    reply(request, status("watch_error"))
                }
                return
            }
            val result = try {
                val expectedLocked = request.method == "getClipboardText" &&
                        JSONObject(request.params).optBoolean("locked", false)
                val screen = screenMatches(expectedLocked)
                when {
                    screen == null -> status("screen_state_unknown")
                    !screen -> status("screen_state_mismatch")
                    request.method == "setClipboardText" -> {
                        writeText(manager, JSONObject(request.params))
                    }
                    request.method == "getClipboardText" -> readText(manager.primaryClip)
                    else -> status("unknown_method")
                }
            } catch (_: SecurityException) {
                status("permission_denied")
            } catch (e: Exception) {
                // Framework locations help diagnose OEM failures without logging messages or clip data.
                val frames = e.stackTrace.take(6).joinToString(" > ") { it.className + "." + it.methodName }
                status("api_error").put("cause", e.javaClass.simpleName + " at " + frames)
            }
            reply(request, result)
        } finally {
            exitProcess(0)
        }
    }

    // A standalone app_process has no application shared memory on some ROMs.
    // Query the system's keyguard delegate, which also reports display power state.
    private fun screenMatches(locked: Boolean): Boolean? {
        val proc = ProcessBuilder("/system/bin/dumpsys", "window", "policy").start()
        val fields = proc.inputStream.bufferedReader().useLines { lines ->
            lines.dropWhile { it.trim() != "KeyguardServiceDelegate" }.drop(1)
                .map { it.trim() }
                .filter { it.startsWith("showing=") || it.startsWith("screenState=") }
                .toSet()
        }
        if (proc.waitFor() != 0) return null
        val showing = fields.singleOrNull { it.startsWith("showing=") }
            ?.removePrefix("showing=")?.toBooleanStrictOrNull() ?: return null
        if (showing != locked) return false
        if (locked) return true
        return when (fields.singleOrNull { it.startsWith("screenState=") }) {
            "screenState=SCREEN_STATE_ON" -> true
            "screenState=SCREEN_STATE_OFF", "screenState=SCREEN_STATE_TURNING_ON",
            "screenState=SCREEN_STATE_TURNING_OFF" -> false
            else -> null
        }
    }

    private fun watch(manager: ClipboardManager, input: FileInputStream, start: Wire.Request,
                      reply: (Wire.Request, JSONObject) -> Unit, timer: Timer, ready: () -> Unit) {
        val startedAt = System.currentTimeMillis()
        val changes = ArrayDeque<JSONObject>()
        val handler = Handler(Looper.getMainLooper())
        var pending: Wire.Request? = null
        val idleReply = Runnable {
            pending?.let { reply(it, status("idle")) }
            pending = null
        }
        var lastTimestamp = -1L
        var lastText: String? = null
        fun ignored(description: ClipDescription): Boolean {
            if (Build.VERSION.SDK_INT >= 26 && description.timestamp in 1 until startedAt) return true
            if (Build.VERSION.SDK_INT < 24) return description.label == "ADB Tool"
            val extras = description.extras ?: return false
            return extras.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false) ||
                    extras.getBoolean(DESKTOP_CLIP, false)
        }
        fun enqueue(event: JSONObject) {
            val waiting = pending
            if (waiting != null) {
                handler.removeCallbacks(idleReply)
                pending = null
                reply(waiting, event)
            } else {
                if (changes.size == 20) changes.removeFirst()
                changes.addLast(event)
            }
        }
        val listener = ClipboardManager.OnPrimaryClipChangedListener {
            try {
                val description = manager.primaryClipDescription ?: return@OnPrimaryClipChangedListener
                if (ignored(description)) return@OnPrimaryClipChangedListener
                val screen = screenMatches(false)
                if (screen == null) enqueue(status("screen_state_unknown"))
                if (screen != true) return@OnPrimaryClipChangedListener
                val clip = manager.primaryClip ?: return@OnPrimaryClipChangedListener
                if (ignored(clip.description)) return@OnPrimaryClipChangedListener
                val result = readText(clip)
                if (result.optString("status") != "ok") return@OnPrimaryClipChangedListener
                val timestamp = if (Build.VERSION.SDK_INT >= 26) clip.description.timestamp else 0L
                val text = result.getString("text")
                // Classification updates can notify twice for the same physical copy.
                if (timestamp > 0 && timestamp == lastTimestamp && text == lastText) return@OnPrimaryClipChangedListener
                lastTimestamp = timestamp
                lastText = text
                enqueue(result)
            } catch (_: SecurityException) {
                enqueue(status("permission_denied"))
            } catch (_: Exception) {
                enqueue(status("watch_error"))
            }
        }
        manager.addPrimaryClipChangedListener(listener)
        ready()
        reply(start, status("watching"))
        // The main looper receives Android callbacks. The private adb pipe owns the subscription.
        thread(name = "clipboard-requests", isDaemon = true) {
            try {
                while (true) {
                    val deadline = timer.schedule(30_000L) { exitProcess(124) }
                    val next = try { Wire.Request.parseDelimitedFrom(input) } finally {
                        deadline.cancel()
                        timer.purge()
                    }
                    if (next == null || next.method != "nextClipboardChange") break
                    handler.post {
                        if (pending != null) exitProcess(1)
                        if (changes.isEmpty()) {
                            pending = next
                            handler.postDelayed(idleReply, 12_000L)
                        } else reply(next, changes.removeFirst())
                    }
                }
            } finally {
                try { manager.removePrimaryClipChangedListener(listener) } finally { exitProcess(0) }
            }
        }
        Looper.loop()
    }

    private fun writeText(manager: ClipboardManager, params: JSONObject): JSONObject {
        val text = params.getString("text")
        if (text.isEmpty()) return status("empty")
        if (text.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return status("too_large")
        val clip = ClipData.newPlainText("ADB Tool", text)
        if (Build.VERSION.SDK_INT >= 24) {
            clip.description.extras = android.os.PersistableBundle().apply {
                putBoolean(DESKTOP_CLIP, true)
                if (params.optBoolean("sensitive")) putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
        }
        manager.setPrimaryClip(clip)
        return status("write_rpc_ok")
    }

    private fun readText(clip: ClipData?): JSONObject {
        if (clip == null) return status("empty_or_invisible")
        if (clip.itemCount == 0) return status("empty")
        if (clip.itemCount != 1) return status("non_plain_text").put("cause", "multiple_items")
        val item = clip.getItemAt(0)
        val cause = when {
            item.uri != null -> "uri_item"
            item.intent != null -> "intent_item"
            !clip.description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN) -> "no_plain_text_mime"
            item.text == null -> "missing_text"
            else -> null
        }
        if (cause != null) return status("non_plain_text").put("cause", cause)
        if (item.text.isEmpty()) return status("empty")
        val text = item.text.toString()
        if (text.toByteArray(Charsets.UTF_8).size > MAX_BYTES) return status("too_large")
        val sensitive = Build.VERSION.SDK_INT >= 24 &&
            clip.description.extras?.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE, false) == true
        // Android can offer both text/plain and text/html. Only consume its explicit plain text.
        return status("ok").put("text", text).put("sensitive", sensitive).put("alsoHtml",
            clip.description.hasMimeType(ClipDescription.MIMETYPE_TEXT_HTML) || item.htmlText != null)
    }
}
