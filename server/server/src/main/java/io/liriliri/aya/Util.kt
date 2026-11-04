package io.liriliri.aya

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.lang.reflect.Method
import java.util.Locale

object Util {
    private val getSystemProperty: Method? by lazy {
        try {
            Class.forName("android.os.SystemProperties").getMethod("get", String::class.java)
        } catch (e: Exception) {
            null
        }
    }

    // 当前系统语言（如 zh-Hans-CN）。服务进程的 Locale.getDefault() 固定为启动时的语言，
    // 用户切换语言后只有 persist.sys.locale 会更新
    fun systemLocaleTag(): String {
        val tag = try {
            getSystemProperty?.invoke(null, "persist.sys.locale") as? String
        } catch (e: Exception) {
            null
        }
        return tag?.takeIf { it.isNotEmpty() } ?: Locale.getDefault().toLanguageTag()
    }

    fun jsonArrayToStringArray(jsonArray: JSONArray): Array<String> {
        val list = ArrayList<String>()
        for (i in 0 until jsonArray.length()) {
            list.add(jsonArray.getString(i))
        }
        return list.toTypedArray()
    }

    // 按 maxSize 等比缩放后直接绘制，避免先按原尺寸（高密度屏上可达 300px 以上）渲染再缩小
    fun drawableToPng(drawable: Drawable, maxSize: Int): ByteArray {
        var width = drawable.intrinsicWidth
        var height = drawable.intrinsicHeight
        if (width <= 0 || height <= 0) {
            width = maxSize
            height = maxSize
        }
        val scale = minOf(1f, maxSize.toFloat() / maxOf(width, height))
        width = maxOf(1, Math.round(width * scale))
        height = maxOf(1, Math.round(height * scale))

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.setHasAlpha(true)
        drawable.setBounds(0, 0, width, height)
        drawable.draw(Canvas(bitmap))

        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        bitmap.recycle()
        return stream.toByteArray()
    }
}