package com.keyfekederradyo.android

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class StationAdapter(
    private val onClick: (Station) -> Unit,
    private val isFavorite: (Station) -> Boolean,
    private val onFavorite: (Station) -> Unit
) : RecyclerView.Adapter<StationAdapter.Holder>() {

    private val items = mutableListOf<Station>()

    fun submitList(stations: List<Station>) {
        items.clear()
        items.addAll(stations)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val context = parent.context
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(10), dp(10), dp(10))
            setBackgroundColor(Color.TRANSPARENT)
            layoutParams = RecyclerView.LayoutParams(-1, dp(78))
        }

        val logo = TextView(context).apply {
            gravity = Gravity.CENTER
            textSize = 17f
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(45, 45, 45))
                setStroke(dp(1), Color.rgb(90, 90, 90))
            }
            layoutParams = LinearLayout.LayoutParams(dp(54), dp(54)).apply {
                rightMargin = dp(14)
            }
        }

        val text = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val title = TextView(context).apply {
            textSize = 18f
            setTextColor(Color.rgb(245, 245, 245))
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val meta = TextView(context).apply {
            textSize = 12f
            setTextColor(Color.rgb(155, 155, 155))
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(0, dp(3), 0, 0)
        }
        text.addView(title)
        text.addView(meta)

        val fav = ImageView(context).apply {
            setPadding(dp(8), dp(8), dp(8), dp(8))
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
            setImageResource(android.R.drawable.btn_star_big_off)
        }

        row.addView(logo)
        row.addView(text)
        row.addView(fav)

        return Holder(row, logo, title, meta, fav)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val station = items[position]
        holder.logo.text = initials(station.name)
        holder.title.text = station.name
        holder.meta.text = listOf(station.genre, station.country, station.quality)
            .filter { it.isNotBlank() }
            .joinToString("  •  ")
            .ifBlank { "Canlı radyo" }

        holder.itemView.setOnClickListener { onClick(station) }
        holder.favorite.setImageResource(
            if (isFavorite(station)) android.R.drawable.btn_star_big_on
            else android.R.drawable.btn_star_big_off
        )
        holder.favorite.setOnClickListener { onFavorite(station) }
    }

    override fun getItemCount() = items.size

    private fun initials(name: String): String = name.trim().split(" ")
        .filter { it.isNotBlank() }
        .take(2)
        .joinToString("") { it.first().uppercaseChar().toString() }
        .ifBlank { "FM" }

    private fun dp(value: Int): Int = (value * itemViewDensity).toInt()

    private val itemViewDensity: Float
        get() = 1f

    class Holder(
        view: android.view.View,
        val logo: TextView,
        val title: TextView,
        val meta: TextView,
        val favorite: ImageView
    ) : RecyclerView.ViewHolder(view)
}

private fun Int.dp(context: android.content.Context): Int =
    (this * context.resources.displayMetrics.density).toInt()
