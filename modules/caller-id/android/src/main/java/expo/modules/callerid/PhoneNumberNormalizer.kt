package expo.modules.callerid

/**
 * Turns the number Android reports for a call into the form stored in the caller
 * database: digits only, no international prefix, no national trunk "0".
 *
 * Stored contacts keep both `fullPhoneNumber` (e.g. "919876543210") and the national
 * `phoneNumber` (e.g. "9876543210"); the lookup matches either column, so callers
 * shown as "+91 98765 43210", "0091…" or "098765 43210" all resolve.
 *
 * Kept free of Android APIs so it can be unit-tested on the JVM.
 */
object PhoneNumberNormalizer {
    /** Countries where the leading 0 is part of the number, not a trunk prefix. */
    private val COUNTRIES_KEEPING_LEADING_ZERO = setOf("IT", "SM", "VA")

    fun normalize(rawNumber: String, countryIso: String?): String {
        val trimmed = rawNumber.trim()
        val digits = trimmed.filter { it.isDigit() }
        // Nothing dialable (e.g. a withheld/private number): leave it as reported
        if (digits.isEmpty()) return trimmed

        val country = countryIso?.trim()?.uppercase()?.takeIf { it.isNotEmpty() }
        return when {
            trimmed.startsWith("+") -> digits
            digits.startsWith("00") -> digits.removePrefix("00")
            digits.startsWith("0") && country != null && country !in COUNTRIES_KEEPING_LEADING_ZERO ->
                digits.removePrefix("0")
            else -> digits
        }
    }

    /**
     * Picks the country to interpret local numbers with: the network's, falling back
     * to the SIM's. TelephonyManager returns "" (not null) when a value is unknown.
     */
    fun resolveCountry(networkCountryIso: String?, simCountryIso: String?): String? =
        listOf(networkCountryIso, simCountryIso)
            .firstOrNull { !it.isNullOrBlank() }
            ?.trim()
            ?.uppercase()
}
