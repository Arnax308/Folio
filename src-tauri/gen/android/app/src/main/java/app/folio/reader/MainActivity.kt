package app.folio.reader

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) receive(intent)
  }

  // Folio is singleTask: "Open with" while it's already running arrives here.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    receive(intent)
  }

  /**
   * "Open with Folio" / "Share to Folio": copies each document into cache/folio-incoming, where the
   * app picks it up (Rust `take_pending`) and adds it to the library. Android only lends us the file
   * through a content:// link for a short while, so the copy is made straight away.
   */
  private fun receive(intent: Intent?) {
    if (intent == null) return
    val uris = mutableListOf<Uri>()
    when (intent.action) {
      Intent.ACTION_VIEW -> intent.data?.let { uris.add(it) }
      Intent.ACTION_SEND -> stream(intent)?.let { uris.add(it) }
      Intent.ACTION_SEND_MULTIPLE -> streams(intent)?.let { uris.addAll(it) }
    }
    if (uris.isEmpty()) return
    val mime = intent.type
    val dir = File(cacheDir, "folio-incoming").apply { mkdirs() }
    Thread {
      for (uri in uris) {
        try {
          copyIn(uri, mime, dir)
        } catch (e: Exception) {
          Log.w("Folio", "Could not open $uri", e)
        }
      }
    }.start()
  }

  @Suppress("DEPRECATION")
  private fun stream(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableExtra(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri>? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)

  private fun copyIn(uri: Uri, intentMime: String?, dir: File) {
    var name = displayName(uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "Document"
    name = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120)
    val mime = contentResolver.getType(uri) ?: intentMime
    val part = File(dir, "${System.nanoTime()}.part")
    contentResolver.openInputStream(uri)?.use { input -> part.outputStream().use { input.copyTo(it) } } ?: return

    // Make sure the name ends in something Folio opens: from the type, or by looking at the bytes.
    if (!Regex("(?i)\\.(pdf|md|markdown|mdown|mkd|txt)$").containsMatchIn(name)) {
      val head = ByteArray(5)
      val n = part.inputStream().use { it.read(head) }
      name += when {
        n >= 4 && String(head, 0, 4, Charsets.US_ASCII) == "%PDF" -> ".pdf"
        mime == "application/pdf" -> ".pdf"
        mime == "text/plain" -> ".txt"
        else -> ".md"
      }
    }
    // a folder per document keeps its real name and lets two files share one
    val target = File(File(dir, System.nanoTime().toString()).apply { mkdirs() }, name)
    if (!part.renameTo(target)) {
      part.copyTo(target, overwrite = true)
      part.delete()
    }
  }

  private fun displayName(uri: Uri): String? {
    if (uri.scheme == "file") return uri.lastPathSegment
    return try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (e: Exception) {
      null
    }
  }
}
