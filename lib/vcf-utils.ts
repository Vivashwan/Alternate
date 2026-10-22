import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { shareAsync } from "expo-sharing";
import { type CountryCode, parsePhoneNumberWithError } from "libphonenumber-js";
import { Platform } from "react-native";
import { getCountryByDialCode } from "@/lib/countries";
import type { Contact } from "@/lib/types";
import { getFormattedName } from "@/lib/utils";
import CallerIdModule from "@/modules/caller-id";

/**
 * Escapes special characters in VCF fields
 */
function escapeVCFValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "");
}

/**
 * Converts a contact object to VCF format string (Google Contacts compatible)
 */
export function contactToVCF(contact: Contact): string {
	const name = contact.name;

	const vcfLines = [
		"BEGIN:VCARD",
		"VERSION:2.1",
		`N:;${escapeVCFValue(name)};;${escapeVCFValue(contact.prefix || "")};${escapeVCFValue(
			contact.suffix || "",
		)}`,
		`FN:${escapeVCFValue(getFormattedName(contact))}`,
	];

	// Add nickname if exists
	if (contact.nickname) {
		vcfLines.push(
			`X-ANDROID-CUSTOM:vnd.android.cursor.item/nickname;${escapeVCFValue(
				contact.nickname,
			)};1;;;;;;;;;;;;;`,
		);
	}

	vcfLines.push(`TEL;CELL;PREF:+${contact.fullPhoneNumber}`);

	// Add email if exists
	if (contact.email) {
		vcfLines.push(`EMAIL;PREF;HOME:${escapeVCFValue(contact.email)}`);
	}

	// Add location/address if exists
	if (contact.location) {
		const escapedLocation = escapeVCFValue(contact.location);
		vcfLines.push(`ADR;PREF;HOME:;;;;${escapedLocation};;`);
	}

	// Add appointment as TITLE (not NOTE as requested)
	if (contact.appointment) {
		vcfLines.push(`TITLE:${escapeVCFValue(contact.appointment)}`);
	}

	// Add website if exists
	if (contact.website) {
		vcfLines.push(`URL:${escapeVCFValue(contact.website)}`);
	}

	// Add notes if exists
	if (contact.notes) {
		vcfLines.push(`NOTE:${escapeVCFValue(contact.notes)}`);
	}

	// Add birthday if exists
	if (contact.birthday) {
		vcfLines.push(`BDAY:${escapeVCFValue(contact.birthday)}`);
	}

	// Add photo if exists (base64 encoded)
	if (contact.photo) {
		// Extract base64 data from data URI if present
		const base64Data = contact.photo.startsWith("data:image/")
			? contact.photo.split(",")[1]
			: contact.photo;

		// vCard expects the image subtype only (TYPE=JPEG), not the full MIME type
		const imageType = contact.photo.startsWith("data:image/")
			? contact.photo.split(";")[0].replace("data:image/", "")
			: "jpeg";

		vcfLines.push(
			`PHOTO;ENCODING=BASE64;TYPE=${imageType.toUpperCase()}:${base64Data}`,
		);
	}

	vcfLines.push("END:VCARD");

	return vcfLines.join("\r\n"); // Use CRLF for better compatibility
}

/**
 * Converts multiple contacts to a single VCF file content
 */
export function contactsToVCF(contacts: Contact[]): string {
	return contacts.map(contactToVCF).join("\r\n\r\n"); // Use CRLF for better compatibility
}

/**
 * Unescapes VCF field values
 */
function unescapeVCFValue(value: string): string {
	return value
		.replace(/\\n/g, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
}

/**
 * Splits a structured value (N, ADR, ...) on unescaped semicolons, then unescapes
 * each component. Unescaping first would turn "\;" into a separator and split
 * values such as "Flat 2; MG Road" in the wrong place.
 */
function splitStructuredValue(rawValue: string): string[] {
	return rawValue.split(/(?<!\\);/).map(unescapeVCFValue);
}

/**
 * Splits "NAME;PARAM=X;PARAM2:value" into an upper-case property name, its
 * upper-case parameter string, and the raw (still escaped) value.
 */
function parseContentLine(
	line: string,
): { property: string; params: string; rawValue: string } | null {
	const colonIndex = line.indexOf(":");
	if (colonIndex === -1) return null;

	const nameAndParams = line.substring(0, colonIndex).toUpperCase();
	const separator = nameAndParams.indexOf(";");
	return {
		property: separator === -1 ? nameAndParams : nameAndParams.substring(0, separator),
		params: separator === -1 ? "" : nameAndParams.substring(separator + 1),
		rawValue: line.substring(colonIndex + 1),
	};
}

/**
 * Parses a phone number to extract country code and number
 */
function parsePhoneNumber(
	phoneStr: string,
	countryCode: string,
): {
	countryCode: string;
	phoneNumber: string;
	fullPhoneNumber: string;
} | null {
	try {
		const phoneProto = parsePhoneNumberWithError(
			phoneStr,
			countryCode as CountryCode,
		);

		return {
			countryCode:
				phoneProto?.country ||
				getCountryByDialCode(phoneProto.countryCallingCode)?.code ||
				"IN",
			phoneNumber:
				phoneProto?.nationalNumber || phoneStr.replace(/[\s\-()]/g, ""),
			fullPhoneNumber:
				phoneProto?.number?.slice(1) || phoneStr.replace(/[\s\-()]/g, ""),
		};
	} catch (e) {
		console.error("Error parsing phone number:", e);
		return null;
	}
}

/**
 * Parses VCF content and extracts contact information (Google Contacts compatible)
 */
export function parseVCF(vcfContent: string): Contact[] {
	const contacts: Contact[] = [];
	const countryCode = CallerIdModule.getDialCountryCode();

	// Normalize and unfold content in one pass
	const processedContent = vcfContent
		.replace(/\r\n?/g, "\n")
		.replace(/\n[ \t]/g, "");

	const vcards = processedContent.split(/BEGIN:VCARD/i);

	for (const vcard of vcards) {
		if (!vcard.trim()) continue;

		const lines = vcard.split("\n").filter((line) => line.trim());
		const contact: Partial<Contact> = {
			name: "",
			fullPhoneNumber: "",
			phoneNumber: "",
			countryCode: "",
			appointment: "",
			location: "",
			iosRow: "",
			suffix: "",
			prefix: "",
			email: "",
			notes: "",
			website: "",
			labels: "",
			birthday: "",
			nickname: "",
			photo: "",
		};

		// Fallbacks used when no N field / no PREF-marked email or address exists
		let formattedName = "";
		let firstEmail = "";
		let firstLocation = "";

		for (const line of lines) {
			const parsed = parseContentLine(line);
			if (!parsed) continue;

			const { property, params, rawValue } = parsed;
			const value = unescapeVCFValue(rawValue);
			const isPreferred = params.includes("PREF");

			switch (property) {
				case "N": {
					const [
						lastName = "",
						firstName = "",
						middleName = "",
						prefix = "",
						suffix = "",
					] = splitStructuredValue(rawValue);
					contact.prefix = prefix;
					contact.suffix = suffix;
					if (firstName || lastName || middleName) {
						contact.name = [firstName, middleName, lastName]
							.filter(Boolean)
							.join(" ");
					}
					break;
				}

				case "FN":
					formattedName = value;
					break;

				case "TEL": {
					if (contact.fullPhoneNumber) break;
					const phone = parsePhoneNumber(value, countryCode);
					if (phone) Object.assign(contact, phone);
					break;
				}

				case "EMAIL":
					if (isPreferred && !contact.email) contact.email = value;
					else if (!firstEmail) firstEmail = value;
					break;

				case "ADR": {
					const addressParts = splitStructuredValue(rawValue);
					const location = addressParts[4] || addressParts[3] || "";
					if (isPreferred) contact.location = location;
					else if (!firstLocation) firstLocation = location;
					break;
				}

				case "TITLE":
					contact.appointment = value;
					break;

				case "URL":
					contact.website = value;
					break;

				case "NOTE":
					contact.notes = value;
					break;

				case "BDAY": {
					// Check if the value matches the accepted formats
					const validDateFormat = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
					const validPartialDateFormat = /^--\d{2}-\d{2}$/; // --MM-DD

					if (
						validDateFormat.test(value) ||
						validPartialDateFormat.test(value)
					) {
						contact.birthday = value;
					}
					break;
				}

				case "X-ANDROID-CUSTOM": {
					const [mimeType, data = ""] = splitStructuredValue(rawValue);
					if (mimeType === "vnd.android.cursor.item/nickname") {
						contact.nickname = data;
					}
					break;
				}

				case "PHOTO":
					// Handle photo field with base64 encoding (vCard 2.1 BASE64, 3.0 ENCODING=B)
					if (params.includes("BASE64") || params.includes("ENCODING=B")) {
						// TYPE may be "JPEG" or a full MIME type such as "image/jpeg"
						const typeMatch = params.match(/TYPE=(?:IMAGE\/)?([^;:]+)/);
						const imageType = typeMatch ? typeMatch[1].toLowerCase() : "jpeg";

						// Clean the base64 data (remove any whitespace/newlines)
						const cleanBase64 = rawValue.replace(/\s/g, "");

						contact.photo = `data:image/${imageType};base64,${cleanBase64}`;
					}
					break;
			}
		}

		contact.name ||= formattedName;
		contact.email ||= firstEmail;
		contact.location ||= firstLocation;

		if (contact.name && contact.fullPhoneNumber) {
			contacts.push(contact as Contact);
		}
	}

	return contacts;
}

async function saveFile(uri: string, filename: string, mimetype: string) {
	if (Platform.OS === "android") {
		const permissions =
			await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
		if (permissions.granted) {
			const base64 = await FileSystem.readAsStringAsync(uri, {
				encoding: FileSystem.EncodingType.Base64,
			});
			await FileSystem.StorageAccessFramework.createFileAsync(
				permissions.directoryUri,
				filename,
				mimetype,
			)
				.then(async (uri) => {
					await FileSystem.writeAsStringAsync(uri, base64, {
						encoding: FileSystem.EncodingType.Base64,
					});
				})
				.catch((e) => console.log(e));
		} else {
			shareAsync(uri);
		}
	} else {
		shareAsync(uri);
	}
}

/**
 * Exports contacts to a VCF file
 */
export async function exportContactsToVCF(
	contacts: Contact[],
): Promise<boolean> {
	try {
		const vcfContent = contactsToVCF(contacts);
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const fileName = `contacts_${timestamp}.vcf`;
		const fileUri = FileSystem.cacheDirectory + fileName;

		await FileSystem.writeAsStringAsync(fileUri, vcfContent, {
			encoding: FileSystem.EncodingType.UTF8,
		});

		await saveFile(fileUri, fileName, "text/vcard");

		await FileSystem.deleteAsync(fileUri, {
			idempotent: true,
		});

		return true;
	} catch (error) {
		console.error("Error exporting contacts to VCF:", error);
		return false;
	}
}

export async function shareContact(contact: Contact[]): Promise<void> {
	try {
		const vcfContent = contactsToVCF(contact);
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const fileName = `contacts_${timestamp}.vcf`;
		const fileUri = FileSystem.cacheDirectory + fileName;

		await FileSystem.writeAsStringAsync(fileUri, vcfContent, {
			encoding: FileSystem.EncodingType.UTF8,
		});

		await shareAsync(fileUri);

		await FileSystem.deleteAsync(fileUri, {
			idempotent: true,
		});
	} catch (error) {
		console.error("Error sharing contact:", error);
	}
}

/**
 * Imports contacts from a VCF file
 */
export async function importContactsFromVCF(): Promise<Contact[] | null> {
	try {
		const result = await DocumentPicker.getDocumentAsync({
			type: "text/*",
			copyToCacheDirectory: true,
			multiple: false,
		});

		if (result.canceled) {
			return null;
		}

		const fileUri = result.assets[0].uri;
		const vcfContent = await FileSystem.readAsStringAsync(fileUri, {
			encoding: FileSystem.EncodingType.UTF8,
		});

		const contacts = parseVCF(vcfContent);

		await FileSystem.deleteAsync(fileUri, {
			idempotent: true,
		});

		return contacts;
	} catch (error) {
		console.error("Error importing contacts from VCF:", error);
		return null;
	}
}
