package expo.modules.callerid

import android.annotation.SuppressLint
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
// import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.util.Base64
import android.util.Log
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import expo.modules.callerid.database.CallerRepository
import java.lang.ref.WeakReference

data class CallerInfo(
    val name: String = "",
    val appointment: String = "",
    val location: String = "",
    val prefix: String = "",
    val suffix: String = "",
    val photo: String = ""
)

interface GetCallerHandler {
    fun onGetCaller(callerInfo: CallerInfo?)
}

class CallReceiver : BroadcastReceiver() {
    companion object {
        private var isShowingOverlay = false
        private var overlay: WeakReference<View>? = null
        var callServiceNumber: String? = null

        // Variables for collapse functionality
        private var isCollapsed = false
        private var collapsedWidth = 60 // Width of collapsed popup visible from edge

        // Variables for dragging functionality
        private var initialX = 0
        private var initialY = 0
        private var initialTouchX = 0f
        private var initialTouchY = 0f
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (!Settings.canDrawOverlays(context)) {
            return
        }

        val sharedPreferences =
            context.getSharedPreferences(context.packageName + ".settings", Context.MODE_PRIVATE)

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                val showIncomingPopup = sharedPreferences.getBoolean("show_incoming_popup", true)
                if (isShowingOverlay || !showIncomingPopup) return

                @Suppress("DEPRECATION")
                val phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                    ?: callServiceNumber ?: return

                isShowingOverlay = true
                showCallerInfoForNumber(context, phoneNumber)
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                val showOutgoingPopup = sharedPreferences.getBoolean("show_outgoing_popup", true)
                if (isShowingOverlay || !showOutgoingPopup) return

                @Suppress("DEPRECATION")
                val phoneNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                    ?: callServiceNumber ?: return

                isShowingOverlay = true
                showCallerInfoForNumber(context, phoneNumber)
            }

            TelephonyManager.EXTRA_STATE_IDLE -> {
                if (!isShowingOverlay) return
                isShowingOverlay = false
                callServiceNumber = null // Reset the number
                dismissCallerInfo(context)
            }
        }
    }

    // Helper function to avoid code duplication
    private fun showCallerInfoForNumber(context: Context, phoneNumber: String) {
        getCallerName(context, phoneNumber, object : GetCallerHandler {
            override fun onGetCaller(callerInfo: CallerInfo?) {
                callerInfo?.let {
                    showCallerInfo(
                        context,
                        it.name,
                        it.appointment,
                        it.location,
                        it.prefix,
                        it.suffix,
                        it.photo
                    )
                }
            }
        })
    }

    private fun getApplicationName(context: Context): String {
        val applicationInfo = context.applicationInfo
        val stringId = applicationInfo.labelRes
        return if (stringId == 0) {
            applicationInfo.nonLocalizedLabel.toString()
        } else {
            context.getString(stringId)
        }
    }

    @SuppressLint("InflateParams")
    private fun showCallerInfo(
        context: Context,
        callerName: String,
        callerAppointment: String,
        callerLocation: String,
        callerNamePrefix: String,
        callerNameSuffix: String,
        callerPhoto: String
    ) {
        val appName = getApplicationName(context)

        Handler(Looper.getMainLooper()).postDelayed({
            // Check if device is locked and wake it up if needed
            context.getSystemService(Context.POWER_SERVICE) as PowerManager
            val keyguardManager =
                context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

            val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            if (overlay?.get() == null) {
                val inflater = LayoutInflater.from(context)
                val overlayView = inflater.inflate(R.layout.caller_info_dialog, null)
                overlay = WeakReference(overlayView)
            }

            // Choose appropriate window type based on lock screen state and API level
            val typeParam = when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                }

                keyguardManager.isKeyguardLocked -> {
                    @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
                }

                else -> {
                    @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
                }
            }

            // Handle flags for lock screen display across different API levels
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                // For API 27+, use combination of flags for lock screen display
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            } else {
                // For older versions, use the deprecated flags with suppression
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            }

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                typeParam,
                flags,
                PixelFormat.TRANSLUCENT
            )

            // Set initial position and gravity
            params.gravity = android.view.Gravity.CENTER
            params.x = 0
            params.y = 0

            overlay?.get()?.let { overlayView ->
                // Fill layout with data first
                fillLayout(
                    context,
                    appName,
                    callerName,
                    callerAppointment,
                    callerLocation,
                    callerNamePrefix,
                    callerNameSuffix,
                    callerPhoto
                )

                // Set up draggable functionality
                setupDraggableOverlay(overlayView, windowManager, params)

                // Add view to window manager
                windowManager.addView(overlayView, params)
            }
        }, 500)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupDraggableOverlay(
        overlayView: View,
        windowManager: WindowManager,
        params: WindowManager.LayoutParams
    ) {
        overlayView.setOnTouchListener { _, event ->
            // Don't allow dragging when collapsed - clicking should expand instead
            if (isCollapsed) {
                return@setOnTouchListener false
            }

            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    // Store initial position
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    // Calculate new position
                    val deltaX = (event.rawX - initialTouchX).toInt()
                    val deltaY = (event.rawY - initialTouchY).toInt()

                    params.x = initialX + deltaX
                    params.y = initialY + deltaY

                    // Update the overlay position
                    try {
                        windowManager.updateViewLayout(overlayView, params)
                    } catch (e: Exception) {
                        Log.e("CallReceiver", "Error updating overlay position", e)
                    }
                    true
                }

                else -> false
            }
        }
    }

    private fun fillLayout(
        context: Context,
        appName: String,
        callerName: String,
        callerAppointment: String,
        callerLocation: String,
        callerNamePrefix: String,
        callerNameSuffix: String,
        callerPhoto: String
    ) {
        overlay?.get()?.let { overlayView ->
            // Set close button listener
            try {
                val closeButton = overlayView.findViewById<ImageButton>(R.id.close_btn)
                closeButton?.setOnClickListener {
                    isShowingOverlay = false
                    dismissCallerInfo(context)
                }
            } catch (e: Exception) {
                Log.e("CallReceiver", "Error setting close button listener", e)
            }

            // Set collapse button listener
            try {
                val collapseButton = overlayView.findViewById<ImageButton>(R.id.collapse_btn)
                collapseButton?.setOnClickListener {
                    val windowManager =
                        context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                    if (isCollapsed) {
                        expandPopup(overlayView, windowManager)
                    } else {
                        collapsePopup(overlayView, windowManager)
                    }
                }
            } catch (e: Exception) {
                Log.e("CallReceiver", "Error setting collapse button listener", e)
            }

            // Set app name
            try {
                val textViewAppName = overlayView.findViewById<TextView>(R.id.appName)
                textViewAppName?.text = appName
            } catch (e: Exception) {
                // Handle exception silently
            }

            // Set caller name
            try {
                val textViewCallerName = overlayView.findViewById<TextView>(R.id.callerName)
                val formattedName = buildString {
                    callerNamePrefix.takeIf { it.isNotBlank() }
                        ?.let { append(it).append(" ") }
                    append(callerName)
                    callerNameSuffix.takeIf { it.isNotBlank() }
                        ?.let { append(", ").append(it) }
                }

                textViewCallerName?.text = formattedName
            } catch (e: Exception) {
                // Handle exception silently
            }

            // Set caller photo
            try {
                val callerPhotoImageView = overlayView.findViewById<ImageView>(R.id.callerPhoto)

                if (callerPhoto.isNotEmpty()) {

                    // Decode base64 photo string to bitmap
                    try {
                        // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
                        val base64String = if (callerPhoto.startsWith("data:")) {
                            callerPhoto.substring(callerPhoto.indexOf(",") + 1)
                        } else {
                            callerPhoto
                        }

                        val decodedBytes = Base64.decode(base64String, Base64.DEFAULT)
                        val bitmap =
                            BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)

                        if (bitmap != null) {
                            callerPhotoImageView?.setImageBitmap(bitmap)
                        } else {
                            callerPhotoImageView?.visibility = View.GONE
                        }
                    } catch (e: Exception) {
                        callerPhotoImageView?.visibility = View.GONE
                    }
                } else {
                    callerPhotoImageView?.visibility = View.GONE
                }
            } catch (e: Exception) {
                Log.e("CallReceiver", "Error setting photo", e)
            }

            // Set caller appointment
            try {
                val textViewCallerAppointment =
                    overlayView.findViewById<TextView>(R.id.callerAppointment)
                if (callerAppointment.isNotEmpty()) {
                    textViewCallerAppointment?.text = callerAppointment
                } else {
                    textViewCallerAppointment?.visibility = View.GONE
                }
            } catch (e: Exception) {
                // Handle exception silently
            }

            // Set caller location
            try {
                val textViewCallerCity = overlayView.findViewById<TextView>(R.id.callerCity)
                if (callerLocation.isNotEmpty()) {
                    textViewCallerCity?.text = callerLocation
                } else {
                    textViewCallerCity?.visibility = View.GONE
                }
            } catch (e: Exception) {
                // Handle exception silently
            }

            // Set app icon
            try {
                val appIconImage = overlayView.findViewById<ImageView>(R.id.appIcon)
                try {
                    val icon = context.packageManager.getApplicationIcon(context.packageName)
                    appIconImage?.setImageDrawable(icon)
                } catch (e: PackageManager.NameNotFoundException) {
                    appIconImage?.visibility = View.GONE
                }
            } catch (e: Exception) {
                // Handle exception silently
            }
        }
    }

    private fun collapsePopup(overlayView: View, windowManager: WindowManager) {
        try {
            val params = overlayView.layoutParams as WindowManager.LayoutParams
            val displayMetrics = overlayView.context.resources.displayMetrics
            val screenWidth = displayMetrics.widthPixels

            // Move popup to right edge with only a small portion visible
            params.width = WindowManager.LayoutParams.WRAP_CONTENT
            params.x = screenWidth - collapsedWidth
            params.gravity = android.view.Gravity.TOP or android.view.Gravity.START

            // Hide all content except the app icon area for the collapsed state
            val mainCard = overlayView.findViewById<View>(R.id.main_card)
            mainCard?.alpha = 0.8f

            // Update layout parameters
            windowManager.updateViewLayout(overlayView, params)
            isCollapsed = true

            // Set up click listener for expansion on the collapsed view
            overlayView.setOnClickListener {
                expandPopup(overlayView, windowManager)
            }

        } catch (e: Exception) {
            Log.e("CallReceiver", "Error collapsing popup", e)
        }
    }

    private fun expandPopup(overlayView: View, windowManager: WindowManager) {
        try {
            val params = overlayView.layoutParams as WindowManager.LayoutParams

            // Restore popup to full width
            params.width = WindowManager.LayoutParams.MATCH_PARENT
            params.x = 0
            params.gravity = android.view.Gravity.CENTER

            // Restore full opacity
            val mainCard = overlayView.findViewById<View>(R.id.main_card)
            mainCard?.alpha = 1.0f

            // Update layout parameters
            windowManager.updateViewLayout(overlayView, params)
            isCollapsed = false

            // Remove the click listener and restore dragging functionality
            overlayView.setOnClickListener(null)
            setupDraggableOverlay(overlayView, windowManager, params)

        } catch (e: Exception) {
            Log.e("CallReceiver", "Error expanding popup", e)
        }
    }

    private fun dismissCallerInfo(context: Context) {
        Handler(Looper.getMainLooper()).post {
            overlay?.get()?.let { overlayView ->
                try {
                    val windowManager =
                        context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
                    windowManager?.removeView(overlayView)
                } catch (e: Exception) {
                    Log.e("CallReceiver", "Error removing overlay view", e)
                }
            }
            overlay = null
            isCollapsed = false // Reset collapsed state
        }
    }

    private fun getCorrectedPhoneNumber(phoneNumber: String, context: Context): String {
        return try {
            val telephonyManager =
                context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            val countryISO = PhoneNumberNormalizer.resolveCountry(
                telephonyManager?.networkCountryIso,
                telephonyManager?.simCountryIso
            )
            PhoneNumberNormalizer.normalize(phoneNumber, countryISO)

        } catch (e: Exception) {
            Log.e("CallReceiver", "Error getting corrected phone number", e)
            return phoneNumber
        }
    }

    private fun getCallerName(
        context: Context, phoneNumberInString: String, callback: GetCallerHandler
    ) {
        try {
            // Old Method
            // val correctedPhoneNumber = if (phoneNumberInString.startsWith("+")) {
            //     phoneNumberInString.substring(1)
            // } else {
            //     phoneNumberInString
            // }

            val correctedPhoneNumber = getCorrectedPhoneNumber(phoneNumberInString, context)

            // Use Room database to get caller information synchronously
            val callerRepository = CallerRepository(context)
            val callerEntity = callerRepository.getCallerInfoSync(correctedPhoneNumber)

            if (callerEntity != null) {
                val callerInfo = CallerInfo(
                    name = callerEntity.name,
                    appointment = callerEntity.appointment,
                    location = callerEntity.location,
                    prefix = callerEntity.prefix,
                    suffix = callerEntity.suffix,
                    photo = callerEntity.photo
                )
                callback.onGetCaller(callerInfo)
            } else {
                callback.onGetCaller(null)
            }
        } catch (e: Exception) {
            Log.e("CallReceiver", "Error getting caller name", e)
            callback.onGetCaller(null)
        }
    }
}
