package io.liriliri.aya

import android.annotation.TargetApi
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.content.res.Configuration
import android.content.res.Resources
import android.net.LocalSocket
import android.os.Build
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.Locale

class Connection(private val client: LocalSocket) : Thread() {
    private companion object {
        private const val TAG = "Aya.Connection"
        private var packageCache = JSONObject()
        private const val ICON_CACHE_DIR = "/data/local/tmp/aya/icons"
        // 前端以 44px 显示图标，96px 足够高分屏使用
        private const val ICON_SIZE = 96

        init {
            val iconCacheDir = File(ICON_CACHE_DIR)
            if (!iconCacheDir.exists()) {
                iconCacheDir.mkdirs()
            }
        }
    }

    override fun run() {
        while (!isInterrupted && client.isConnected) {
            try {
                val request = Wire.Request.parseDelimitedFrom(client.inputStream)
                if (request == null) {
                    // 流结束，客户端断开连接
                    break
                }
                val params = request.params.ifEmpty { "{}" }
                handleRequest(request.id, request.method, params)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to handle request", e)
                break
            }
        }

        client.close()
        Log.i(TAG, "Client disconnected")
    }

    private fun handleRequest(id: String, method: String, params: String) {
        Log.i(TAG, "Request method: $method")

        val result = JSONObject()

        when (method) {
            "getVersion" -> {
                result.put("version", getVersion())
            }

            "getPackageInfos" -> {
                result.put("packageInfos", getPackageInfos(JSONObject(params)))
            }

            else -> {
                Log.e(TAG, "Unknown method: $method")
            }
        }

        Wire.Response.newBuilder().setId(id).setResult(result.toString()).build()
            .writeDelimitedTo(client.outputStream)
    }

    private fun getVersion(): String {
        return BuildConfig.VERSION_NAME
    }

    private fun getPackageInfos(params: JSONObject): JSONArray {
        val packageNames = Util.jsonArrayToStringArray(params.getJSONArray("packageNames"))
        val result = JSONArray()
        // 每次请求读取一次：用户切换系统语言后，应用名随之更新
        val locale = Util.systemLocaleTag()

        packageNames.forEach {
            try {
                result.put(getPackageInfo(it, locale))
            } catch (e: Exception) {
                Log.e(TAG, "Fail to get package info", e)
            }
        }

        return result
    }

    @TargetApi(Build.VERSION_CODES.P)
    private fun getPackageInfo(packageName: String, locale: String): JSONObject {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            @Suppress("DEPRECATION")
            PackageManager.GET_SIGNATURES
        }
        val packageInfo =
            ServiceManager.packageManager.getPackageInfo(packageName, flags)

        val info = JSONObject()
        info.put("packageName", packageInfo.packageName)
        info.put("versionName", packageInfo.versionName)
        // 添加 versionCode（需要处理 API 版本兼容性）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.put("versionCode", packageInfo.longVersionCode)
        } else {
            @Suppress("DEPRECATION")
            info.put("versionCode", packageInfo.versionCode.toLong())
        }
        info.put("firstInstallTime", packageInfo.firstInstallTime)
        info.put("lastUpdateTime", packageInfo.lastUpdateTime)
        info.put("signatureSha256s", getSignatureSha256s(packageInfo))

        val applicationInfo = packageInfo.applicationInfo
        val apkPath = applicationInfo.sourceDir
        info.put("apkPath", apkPath)
        info.put("apkSize", File(apkPath).length())
        info.put("enabled", applicationInfo.enabled)

        var system = false
        if ((applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) == ApplicationInfo.FLAG_SYSTEM) {
            system = true
        }
        info.put("system", system)

        // 应用更新后 lastUpdateTime 会变，用它区分缓存版本；应用名还与系统语言有关
        val cacheKey = "$packageName.${packageInfo.lastUpdateTime}"
        val cached = getCachedLabelAndIcon(packageName, cacheKey, locale) ?: loadLabelAndIcon(
            packageName, cacheKey, locale, apkPath, applicationInfo
        )
        info.put("label", cached.getString("label"))
        info.put("icon", cached.getString("icon"))

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            info.put("minSdkVersion", applicationInfo.minSdkVersion)
            info.put("targetSdkVersion", applicationInfo.targetSdkVersion)
        }

        //if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        //    try {
        //        val stats = ServiceManager.storageStatsManager.queryStatsForPackage(
        //            packageName
        //        )
        //        info.put("appSize", stats.appBytes)
        //        info.put("dataSize", stats.dataBytes)
        //        info.put("cacheSize", stats.cacheBytes)
        //    } catch (e: Exception) {
        //        Log.e(TAG, "Failed to get storage stats for $packageName", e)
        //    }
        //}

        return info
    }

    // 磁盘缓存：图标 <包名>.<lastUpdateTime>.png 与语言无关；
    // 应用名 <包名>.<lastUpdateTime>.<语言>.label，在图标之后写入，它存在即表示该语言下的缓存完整
    private fun iconFile(cacheKey: String) = File("$ICON_CACHE_DIR/$cacheKey.png")
    private fun labelFile(cacheKey: String, locale: String) = File("$ICON_CACHE_DIR/$cacheKey.$locale.label")

    // 先查内存缓存，再查磁盘缓存（服务重启后内存缓存为空，磁盘缓存可免去解析 APK 资源）
    private fun getCachedLabelAndIcon(packageName: String, cacheKey: String, locale: String): JSONObject? {
        val memoryKey = "$cacheKey.$locale"
        if (packageCache.has(memoryKey)) {
            return packageCache.getJSONObject(memoryKey)
        }
        val labelFile = labelFile(cacheKey, locale)
        if (!labelFile.exists()) {
            return null
        }
        return try {
            val iconFile = iconFile(cacheKey)
            val cacheInfo = JSONObject()
            cacheInfo.put("label", labelFile.readText().ifEmpty { packageName })
            cacheInfo.put("icon", if (iconFile.exists()) toDataUrl(iconFile.readBytes()) else "")
            packageCache.put(memoryKey, cacheInfo)
            cacheInfo
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read cache for $packageName", e)
            null
        }
    }

    private fun loadLabelAndIcon(
        packageName: String,
        cacheKey: String,
        locale: String,
        apkPath: String,
        applicationInfo: ApplicationInfo
    ): JSONObject {
        var label = packageName
        var icon = ""
        var pngIcon: ByteArray? = null

        val resources = getResources(apkPath, locale)
        val labelRes = applicationInfo.labelRes
        if (labelRes != 0) {
            try {
                label = resources.getString(labelRes)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to get label for $packageName")
            }
        }

        // 只是语言变了时复用已缓存的图标
        val iconFile = iconFile(cacheKey)
        val cachedIcon = try {
            if (iconFile.exists()) iconFile.readBytes() else null
        } catch (e: Exception) {
            null
        }
        if (cachedIcon != null) {
            icon = toDataUrl(cachedIcon)
        } else if (applicationInfo.icon != 0) {
            try {
                val resIcon = resources.getDrawable(applicationInfo.icon)
                pngIcon = Util.drawableToPng(resIcon, ICON_SIZE)
                icon = toDataUrl(pngIcon)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to get icon for $packageName")
            }
        }

        val cacheInfo = JSONObject()
        cacheInfo.put("label", label)
        cacheInfo.put("icon", icon)
        packageCache.put("$cacheKey.$locale", cacheInfo)

        try {
            if (cachedIcon == null) {
                removeStaleCache(packageName, cacheKey)
            }
            if (pngIcon != null) {
                iconFile.writeBytes(pngIcon)
            }
            labelFile(cacheKey, locale).writeText(label)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write cache for $packageName", e)
        }
        return cacheInfo
    }

    // 删除该应用其他版本的缓存文件（包括旧版按 apkSize 命名的图标）。
    // Android 包名每段都以字母开头，"<包名>.<数字>." 不会误配到以它为前缀的其他包
    private fun removeStaleCache(packageName: String, cacheKey: String) {
        val pattern = Regex("^" + Regex.escape(packageName) + "\\.\\d+\\.(.+\\.)?(png|label)$")
        File(ICON_CACHE_DIR).listFiles()?.forEach {
            if (pattern.matches(it.name) && !it.name.startsWith("$cacheKey.")) {
                it.delete()
            }
        }
    }

    private fun toDataUrl(png: ByteArray): String {
        return "data:image/png;base64,${Base64.encodeToString(png, Base64.NO_WRAP)}"
    }

    private fun getResources(apkPath: String, locale: String): Resources {
        val assetManager = AssetManager::class.java.newInstance() as AssetManager
        val addAssetManagerMethod =
            assetManager.javaClass.getMethod("addAssetPath", String::class.java)
        addAssetManagerMethod.invoke(assetManager, apkPath)

        val displayMetrics = DisplayMetrics()
        displayMetrics.setToDefaults()
        val configuration = Configuration()
        configuration.setToDefaults()
        if (locale.isNotEmpty()) {
            configuration.setLocale(Locale.forLanguageTag(locale))
        }

        return Resources(assetManager, displayMetrics, configuration)
    }

    private fun getSignatureSha256s(packageInfo: PackageInfo): JSONArray {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.signingInfo.apkContentsSigners
        } else {
            packageInfo.signatures
        }

        val array = JSONArray()
        val md = MessageDigest.getInstance("SHA-256")
        signatures.forEach {
            val digest = md.digest(it.toByteArray())
            val hexString = digest.joinToString("") { byte -> "%02X".format(byte) }
            array.put(hexString)
            md.reset()
        }
        return array
    }
}
