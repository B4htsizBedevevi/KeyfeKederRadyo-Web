package com.keyfekederradyo.android

import android.Manifest
import android.content.ComponentName
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {
    private val orange = Color.rgb(255, 122, 0)
    private val bg = Color.rgb(18, 18, 18)
    private val surface = Color.rgb(32, 32, 32)
    private val muted = Color.rgb(150, 150, 150)

    private lateinit var list: RecyclerView
    private lateinit var progress: ProgressBar
    private lateinit var nowPlaying: TextView
    private lateinit var nowState: TextView
    private lateinit var playButton: ImageButton
    private lateinit var search: EditText

    private lateinit var adapter: StationAdapter
    private var allStations = emptyList<Station>()
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private val executor = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("radio", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        setContentView(buildUi())

        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 20)
        }

        connectPlayer()
        loadStations()
    }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
        }

        val top = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(18.dp(), 10.dp(), 14.dp(), 10.dp())
            setBackgroundColor(Color.rgb(31, 31, 31))
        }
        val menu = iconButton("☰")
        val brand = TextView(this).apply {
            text = "◉  KEYFE KEDER"
            textSize = 20f
            setTextColor(orange)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(0, 52.dp(), 1f)
        }
        val searchButton = iconButton("⌕")
        top.addView(menu)
        top.addView(brand)
        top.addView(searchButton)
        root.addView(top)

        val tabs = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(10.dp(), 0, 10.dp(), 0)
            setBackgroundColor(Color.rgb(35, 35, 35))
        }
        tabs.addView(tab("📡  TÜM RADYOLAR", true) { showAll() })
        tabs.addView(tab("♥  FAVORİLER", false) { showFavorites() })
        tabs.addView(tab("🏷  KATEGORİLER", false) { showCategories() })
        root.addView(tabs, LinearLayout.LayoutParams(-1, 54.dp()))

        search = EditText(this).apply {
            hint = "Radyo ara..."
            hintTextColor = muted
            setTextColor(Color.WHITE)
            setSingleLine(true)
            setPadding(16.dp(), 0, 16.dp(), 0)
            setBackgroundColor(surface)
            visibility = View.GONE
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { filter(s?.toString().orEmpty()) }
                override fun afterTextChanged(s: android.text.Editable?) = Unit
            })
        }
        root.addView(search, LinearLayout.LayoutParams(-1, 52.dp()).apply {
            setMargins(10.dp(), 8.dp(), 10.dp(), 4.dp())
        })
        searchButton.setOnClickListener {
            search.visibility = if (search.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            if (search.visibility == View.VISIBLE) search.requestFocus()
        }

        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        progress = ProgressBar(this).apply { visibility = View.VISIBLE }
        content.addView(progress, LinearLayout.LayoutParams(-1, 52.dp()).apply { gravity = Gravity.CENTER })

        list = RecyclerView(this).apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        adapter = StationAdapter(
            onClick = { play(it) },
            isFavorite = { isFavorite(it) },
            onFavorite = { toggleFavorite(it) }
        )
        list.adapter = adapter
        content.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))

        val player = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(14.dp(), 10.dp(), 10.dp(), 10.dp())
            setBackgroundColor(Color.rgb(31, 31, 31))
        }
        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        nowPlaying = TextView(this).apply {
            text = "Bir radyo seç"
            textSize = 16f
            setTextColor(Color.WHITE)
            maxLines = 1
        }
        nowState = TextView(this).apply {
            text = "Hazır"
            textSize = 12f
            setTextColor(muted)
        }
        info.addView(nowPlaying)
        info.addView(nowState)
        playButton = iconButton("▶")
        playButton.setOnClickListener { controller?.let { if (it.isPlaying) it.pause() else it.play() } }
        player.addView(info)
        player.addView(playButton)
        root.addView(player, LinearLayout.LayoutParams(-1, 78.dp()))

        return root
    }

    private fun connectPlayer() {
        val token = SessionToken(this, ComponentName(this, RadioPlaybackService::class.java))
        controllerFuture = MediaController.Builder(this, token).buildAsync()
        controllerFuture?.addListener({
            try {
                controller = controllerFuture?.get()
                controller?.addListener(object : androidx.media3.common.Player.Listener {
                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        playButton.setImageResource(if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
                        nowState.text = if (isPlaying) "Canlı yayın" else "Durduruldu"
                    }
                    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                        nowPlaying.text = mediaItem?.mediaMetadata?.title ?: "Bir radyo seç"
                    }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        nowState.text = "Yayın açılamadı"
                    }
                })
            } catch (e: Exception) {
                Toast.makeText(this, "Oynatıcı başlatılamadı", Toast.LENGTH_SHORT).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun loadStations() {
        executor.execute {
            try {
                val loaded = StationRepository().load()
                runOnUiThread {
                    allStations = loaded
                    progress.visibility = View.GONE
                    adapter.submitList(loaded)
                }
            } catch (e: Exception) {
                runOnUiThread {
                    progress.visibility = View.GONE
                    nowState.text = "İstasyon listesi alınamadı"
                    Toast.makeText(this, "Radyolar yüklenemedi: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun play(station: Station) {
        val item = MediaItem.Builder()
            .setMediaId(station.resolvedUrl)
            .setUri(station.resolvedUrl)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(station.name)
                    .setArtist(station.genre.ifBlank { "Canlı radyo" })
                    .setDescription(station.song)
                    .build()
            )
            .build()
        controller?.setMediaItem(item)
        controller?.prepare()
        controller?.play()
        nowPlaying.text = station.name
        nowState.text = "Bağlanıyor..."
    }

    private fun filter(query: String) {
        if (query.isBlank()) {
            adapter.submitList(allStations)
            return
        }
        val q = query.trim().lowercase()
        adapter.submitList(allStations.filter {
            it.name.lowercase().contains(q) ||
                it.genre.lowercase().contains(q) ||
                it.country.lowercase().contains(q)
        })
    }

    private fun showAll() = adapter.submitList(allStations)

    private fun showFavorites() {
        adapter.submitList(allStations.filter { isFavorite(it) })
    }

    private fun showCategories() {
        val genres = allStations.mapNotNull { it.genre.takeIf(String::isNotBlank) }.distinct().sorted()
        Toast.makeText(this, if (genres.isEmpty()) "Kategori bulunamadı" else genres.take(8).joinToString(" • "), Toast.LENGTH_LONG).show()
    }

    private fun isFavorite(station: Station): Boolean = prefs.getBoolean(station.resolvedUrl, false)

    private fun toggleFavorite(station: Station) {
        prefs.edit().putBoolean(station.resolvedUrl, !isFavorite(station)).apply()
        adapter.notifyDataSetChanged()
    }

    private fun tab(text: String, selected: Boolean, action: () -> Unit): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(if (selected) orange else Color.LTGRAY)
        gravity = Gravity.CENTER
        setPadding(14.dp(), 0, 14.dp(), 0)
        setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(0, -1, 1f)
    }

    private fun iconButton(symbol: String) = ImageButton(this).apply {
        contentDescription = symbol
        setBackgroundColor(Color.TRANSPARENT)
        setColorFilter(Color.WHITE)
        layoutParams = LinearLayout.LayoutParams(52.dp(), 52.dp())
        setImageResource(android.R.drawable.ic_menu_search)
        if (symbol == "☰") setImageResource(android.R.drawable.ic_menu_sort_by_size)
        if (symbol == "▶") setImageResource(android.R.drawable.ic_media_play)
        if (symbol == "⌕") setImageResource(android.R.drawable.ic_menu_search)
    }

    private fun Int.dp() = (this * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        controllerFuture?.let { MediaController.releaseFuture(it) }
        executor.shutdownNow()
        super.onDestroy()
    }
}
