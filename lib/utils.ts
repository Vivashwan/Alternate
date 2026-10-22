import {
	type CountryCode,
	formatIncompletePhoneNumber,
} from "libphonenumber-js";
import { getCountryByCode } from "./countries";
import type { Contact } from "./types";

/**
 * Strips an explicit international prefix ("+91..." or "0091...") from a number.
 * Bare digits are never trimmed: national numbers can legitimately start with the
 * same digits as the dial code (e.g. Indian mobiles beginning with 91).
 */
export function trimDialCode(phoneNumber: string, countryCode: string): string {
	const country = getCountryByCode(countryCode);
	if (!country) {
		return phoneNumber; // If no country found, return original number
	}

	const number = phoneNumber.trim();
	for (const prefix of [`+${country.dialCode}`, `00${country.dialCode}`]) {
		if (number.startsWith(prefix)) {
			return number.slice(prefix.length).trim();
		}
	}

	return phoneNumber;
}

export function getFormattedPhoneNumber(contact: Contact): string {
	try {
		return formatIncompletePhoneNumber(
			contact.fullPhoneNumber,
			contact.countryCode as CountryCode,
		);
	} catch {
		return contact.fullPhoneNumber;
	}
}

export function getFormattedName(contact: Contact): string {
	let formattedName = contact.name.trim();

	if (contact.prefix?.trim()) {
		formattedName = `${contact.prefix.trim()} ${formattedName}`;
	}

	if (contact.suffix?.trim()) {
		formattedName = `${formattedName}, ${contact.suffix.trim()}`;
	}

	return formattedName;
}

export function getFormattedDate(date: string): string {
	const isMonthDay = date?.startsWith("--");
	const parsedDate = new Date(
		isMonthDay ? `2000-${date.slice(2)}` : date || new Date(),
	);

	return parsedDate.toLocaleDateString("en-US", {
		...(isMonthDay
			? { month: "long", day: "numeric" }
			: { year: "numeric", month: "long", day: "numeric" }),
	});
}

export function getVisibleFields(contact: Contact | null): Set<string> {
	if (!contact) return new Set<string>();

	const fields = [
		"suffix",
		"prefix",
		"email",
		"notes",
		"website",
		"birthday",
		"nickname",
	] as const;
	return new Set(fields.filter((field) => contact[field] !== ""));
}
