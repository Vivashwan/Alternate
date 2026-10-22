package expo.modules.callerid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneNumberNormalizerTest {

    private fun normalize(number: String, country: String? = "IN") =
        PhoneNumberNormalizer.normalize(number, country)

    @Test
    fun `international format drops the plus sign`() {
        assertEquals("919876543210", normalize("+919876543210"))
    }

    @Test
    fun `international numbers are normalised even when the country is unknown`() {
        // Previously the '+' was kept whenever TelephonyManager had no country, so the lookup failed
        assertEquals("919876543210", normalize("+919876543210", country = null))
    }

    @Test
    fun `formatting characters are removed`() {
        assertEquals("919876543210", normalize("+91 98765-43210"))
        assertEquals("14155550123", normalize("+1 (415) 555-0123", country = "US"))
    }

    @Test
    fun `double-zero international prefix is treated like plus`() {
        // Previously only one 0 was removed, giving "0919876543210"
        assertEquals("919876543210", normalize("00919876543210"))
    }

    @Test
    fun `national trunk prefix 0 is removed`() {
        assertEquals("9876543210", normalize("09876543210"))
        assertEquals("2071234567", normalize("020 7123 4567", country = "GB"))
    }

    @Test
    fun `leading zero is kept where it is part of the number`() {
        assertEquals("0612345678", normalize("06 1234 5678", country = "IT"))
        assertEquals("0549123456", normalize("0549123456", country = "sm"))
    }

    @Test
    fun `local numbers without a trunk prefix are unchanged`() {
        assertEquals("9876543210", normalize("9876543210"))
        assertEquals("4155550123", normalize("4155550123", country = "US"))
    }

    @Test
    fun `without a country a leading zero is left alone`() {
        assertEquals("09876543210", normalize("09876543210", country = null))
    }

    @Test
    fun `withheld numbers are returned as reported`() {
        assertEquals("Private", normalize(" Private "))
        assertEquals("", normalize(""))
    }

    @Test
    fun `country comes from the network, falling back to the SIM`() {
        assertEquals("IN", PhoneNumberNormalizer.resolveCountry("in", "us"))
        // TelephonyManager reports "" (not null) when the network country is unknown
        assertEquals("US", PhoneNumberNormalizer.resolveCountry("", "us"))
        assertEquals("US", PhoneNumberNormalizer.resolveCountry(null, " us "))
        assertNull(PhoneNumberNormalizer.resolveCountry("", ""))
    }
}
