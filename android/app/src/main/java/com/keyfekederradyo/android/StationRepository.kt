package com.keyfekederradyo.android

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.util.concurrent.TimeUnit

class StationRepository {
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val sourceUrl =
        "https://raw.githubusercontent.com/B4htsizBedevevi/KeyfeKederRadyo-Web/main/stations.json"

    fun load(): List<Station> {
        val request = Request.Builder().url(sourceUrl).get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("HTTP ${response.code}")
            val body = response.body?.string().orEmpty()
            return parse(body)
        }
    }

    private fun parse(json: String): List<Station> {
        val array = JSONArray(json)
        val result = ArrayList<Station>(array.length())
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            val url = o.optString("url_resolved").ifBlank { o.optString("url") }
            if (o.optString("name").isBlank() || url.isBlank()) continue
            result += Station(
                name = o.optString("name"),
                url = o.optString("url"),
                resolvedUrl = url,
                genre = o.optString("genre"),
                language = o.optString("language"),
                country = o.optString("country"),
                quality = o.optString("quality"),
                song = o.optString("song").ifBlank { "Canlı yayın" },
                homepage = o.optString("homepage")
            )
        }
        return result
    }
}
