package com.keyfekederradyo.android

data class Station(
    val name: String,
    val url: String,
    val resolvedUrl: String = url,
    val genre: String = "",
    val language: String = "",
    val country: String = "",
    val quality: String = "",
    val song: String = "Canlı yayın",
    val homepage: String = ""
)
